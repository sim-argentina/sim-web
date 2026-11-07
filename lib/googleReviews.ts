// Reseñas reales de Google Maps (Places API) — SOLO SERVIDOR.
//
// La API key vive únicamente en el servidor (env GOOGLE_PLACES_API_KEY, nunca
// NEXT_PUBLIC) y no se imprime en logs ni respuestas: los mensajes de Google se
// devuelven redactados. Se muestran solo reseñas de 5 estrellas con texto, y la
// Home lo AVISA (las políticas de Google piden informar cómo se filtran y
// ordenan). Nunca se inventa una reseña: si Google no responde o no hay reseñas
// para mostrar, la Home lo dice y deja el enlace a la ficha de Google Maps.
//
// Antes de este bloque cualquier falla terminaba en [] SIN dejar rastro: la
// Places API (New) devolvía un error, el respaldo legacy contestaba HTTP 200 con
// status REQUEST_DENIED (que se leía como "no hay reseñas") y la Home quedaba
// con el esqueleto "En camino" para siempre. Ahora cada intento deja su motivo
// (HTTP, estado y razón de Google) y /api/admin/resenas-google/diagnostico dice
// exactamente qué configurar.
//
// Atribuciones (https://developers.google.com/maps/documentation/places/web-service/policies):
// avatar, nombre y perfil del autor; enlace a la reseña en Google Maps
// (googleMapsUri); atribución "Google Maps" en el contenedor.

export type GoogleReview = {
  id: string;
  author: string;
  /** Perfil del autor en Google Maps (atribución). */
  authorUri: string | null;
  /** Avatar del autor (atribución). */
  authorPhoto: string | null;
  rating: 5;
  text: string;
  relativeTime: string;
  /** La reseña en Google Maps (fuente). */
  reviewUri: string | null;
};

export type ResumenLugar = { rating: number | null; total: number | null };

export type EstadoResenas = "ok" | "sin_resenas" | "error";

export type ResenasHome = {
  estado: EstadoResenas;
  reviews: GoogleReview[];
  /** Solo con respuesta de Google. */
  resumen: ResumenLugar | null;
  /** Ficha de Google Maps: SIEMPRE válida (de Google o armada con el Place ID). */
  fichaUrl: string;
};

export type Intento = {
  api: "places_new" | "places_legacy";
  /** null: no hubo respuesta (timeout o red). */
  http: number | null;
  /** error.status (New) o status (legacy). */
  estadoGoogle: string | null;
  /** ErrorInfo.reason de la Places API (New). */
  motivo: string | null;
  /** Mensaje de Google, sin la key. */
  mensaje: string | null;
  ms: number;
};

export type DiagnosticoResenas = {
  configuracion: {
    apiKey: "presente" | "ausente";
    placeId: "variable" | "predeterminado";
    /** El Place ID es público (también viaja en el enlace de la Home). */
    placeIdUsado: string;
  };
  intentos: Intento[];
  estado: EstadoResenas;
  /** Reseñas que devolvió Google (todas las estrellas). */
  recibidas: number;
  /** Las que se muestran (5★ con texto). */
  mostradas: number;
  resumen: ResumenLugar | null;
  fichaUrl: string;
  indicacion: string;
};

/** Place ID de SIM Argentina (Av. Duarte Quirós 1400, Córdoba). Verificado el 06/11/2026. */
export const PLACE_ID_SIM = "ChIJ3xfK5ruZMpQRkfHB5LldzCY";

const REVALIDATE_SECONDS = 6 * 60 * 60; // 6 h, igual que la Home (ISR)
const FETCH_TIMEOUT_MS = 6000;
const MAX_TEXT = 600;
// La Places API (New) devuelve hasta 5 reseñas (las más relevantes); el tope
// queda alto para mostrar todas las que lleguen.
const MAX_REVIEWS = 20;

const CAMPOS_NUEVA = "rating,userRatingCount,googleMapsUri,googleMapsLinks,reviews";

// ── Utilidades puras ─────────────────────────────────────────────────────────

function cleanText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT).trimEnd()}…` : t;
}

/** Solo URLs https: lo que viene de afuera termina en un href o un src. */
function https(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    return new URL(u).protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function numero(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number.NaN;
  return Number.isFinite(v) ? v : null;
}

/** Ficha pública de Google Maps armada con el Place ID (URL documentada de Maps URLs). */
export function urlFicha(placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("SIM Argentina")}&query_place_id=${encodeURIComponent(placeId)}`;
}

/** Saca la key (y cualquier cosa con forma de key) de un texto de Google. */
export function redactar(mensaje: unknown, apiKey: string): string | null {
  if (typeof mensaje !== "string" || !mensaje.trim()) return null;
  let s = mensaje;
  if (apiKey) s = s.split(apiKey).join("[key]");
  s = s.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key]");
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

// ── Places API (New) ─────────────────────────────────────────────────────────

interface NewApiReview {
  name?: string;
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
  relativePublishTimeDescription?: string;
  googleMapsUri?: string;
}
interface NewApiPlace {
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  googleMapsLinks?: { reviewsUri?: string; placeUri?: string };
  reviews?: NewApiReview[];
}
interface GoogleApiError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ "@type"?: string; reason?: string }>;
  };
}

export function normalizarNueva(data: NewApiPlace): {
  reviews: GoogleReview[]; recibidas: number; resumen: ResumenLugar; ficha: string | null;
} {
  const lista = Array.isArray(data.reviews) ? data.reviews : [];
  const reviews: GoogleReview[] = [];
  lista.forEach((r, i) => {
    const author = (r.authorAttribution?.displayName ?? "").trim();
    // El texto original del autor (con languageCode=es, `text` puede ser una traducción).
    const text = (r.originalText?.text ?? r.text?.text ?? "").trim();
    if (Number(r.rating) !== 5 || !author || !text) return; // solo 5★ con texto
    reviews.push({
      id: r.name || `${author}-${i}`,
      author,
      authorUri: https(r.authorAttribution?.uri),
      authorPhoto: https(r.authorAttribution?.photoUri),
      rating: 5,
      text: cleanText(text),
      relativeTime: (r.relativePublishTimeDescription ?? "").trim(),
      reviewUri: https(r.googleMapsUri),
    });
  });
  return {
    reviews: reviews.slice(0, MAX_REVIEWS),
    recibidas: lista.length,
    resumen: { rating: numero(data.rating), total: numero(data.userRatingCount) },
    ficha: https(data.googleMapsLinks?.reviewsUri) ?? https(data.googleMapsUri) ?? https(data.googleMapsLinks?.placeUri),
  };
}

/** Estado y razón de un error de la Places API (New) (formato google.rpc.Status). */
export function leerErrorNueva(body: unknown): { estado: string | null; motivo: string | null; mensaje: unknown } {
  const e = (body as GoogleApiError | null)?.error;
  if (!e || typeof e !== "object") return { estado: null, motivo: null, mensaje: null };
  const info = Array.isArray(e.details) ? e.details.find((d) => typeof d?.reason === "string") : undefined;
  return { estado: typeof e.status === "string" ? e.status : null, motivo: info?.reason ?? null, mensaje: e.message };
}

// ── Places API (legacy), respaldo ────────────────────────────────────────────

interface LegacyReview {
  author_name?: string;
  author_url?: string;
  profile_photo_url?: string;
  rating?: number;
  text?: string;
  relative_time_description?: string;
  time?: number;
}
interface LegacyResponse {
  status?: string;
  error_message?: string;
  result?: { reviews?: LegacyReview[]; rating?: number; user_ratings_total?: number; url?: string };
}

export function normalizarLegacy(data: LegacyResponse): {
  reviews: GoogleReview[]; recibidas: number; resumen: ResumenLugar; ficha: string | null;
} {
  const lista = Array.isArray(data.result?.reviews) ? data.result!.reviews! : [];
  const reviews: GoogleReview[] = [];
  lista.forEach((r, i) => {
    const author = (r.author_name ?? "").trim();
    const text = (r.text ?? "").trim();
    if (Number(r.rating) !== 5 || !author || !text) return;
    reviews.push({
      id: r.time ? `${r.time}-${i}` : `${author}-${i}`,
      author,
      authorUri: https(r.author_url),
      authorPhoto: https(r.profile_photo_url),
      rating: 5,
      text: cleanText(text),
      relativeTime: (r.relative_time_description ?? "").trim(),
      reviewUri: null, // la API legacy no da el enlace de cada reseña: se usa la ficha
    });
  });
  return {
    reviews: reviews.slice(0, MAX_REVIEWS),
    recibidas: lista.length,
    resumen: { rating: numero(data.result?.rating), total: numero(data.result?.user_ratings_total) },
    ficha: https(data.result?.url),
  };
}

// ── Qué configurar ───────────────────────────────────────────────────────────

/** Indicación concreta a partir del primer intento fallido (la API New es la preferida). */
export function indicacionPara(i: Intento | null, apiKeyPresente: boolean): string {
  if (!apiKeyPresente) {
    return "Falta la variable GOOGLE_PLACES_API_KEY en Vercel (entorno Production). Cargarla y redeployar.";
  }
  if (!i) return "Sin intentos registrados.";
  if (i.http === null) {
    return "Google no respondió a tiempo (timeout o red). Reintentar; si persiste, revisar el estado de Google Maps Platform.";
  }
  const m = `${i.motivo ?? ""} ${i.estadoGoogle ?? ""} ${i.mensaje ?? ""}`;
  if (/SERVICE_DISABLED|has not been used|is disabled|not authorized to use this API|legacy API/i.test(m)) {
    return "La API no está habilitada para la key: habilitar «Places API (New)» en el proyecto de Google Cloud al que pertenece GOOGLE_PLACES_API_KEY.";
  }
  if (/API_KEY_HTTP_REFERRER_BLOCKED|referer/i.test(m)) {
    return "La key está restringida a sitios web (referer) y la consulta sale del servidor, sin referer: usar una key de servidor sin restricción de sitio web, restringida por API a «Places API (New)».";
  }
  if (/API_KEY_IP_ADDRESS_BLOCKED/i.test(m)) {
    return "La key está restringida por IP y Vercel no tiene IP fija: quitar la restricción por IP y restringirla por API a «Places API (New)».";
  }
  if (/API_KEY_SERVICE_BLOCKED|API_KEY_ANDROID_APP_BLOCKED|API_KEY_IOS_APP_BLOCKED/i.test(m)) {
    return "Las restricciones de la key no permiten esta API: agregar «Places API (New)» a las APIs permitidas de la key.";
  }
  if (/API_KEY_INVALID|API key not valid|provided API key is invalid/i.test(m)) {
    return "Google dice que la key no es válida: revisar que GOOGLE_PLACES_API_KEY esté completa y que la key no se haya borrado.";
  }
  if (/BILLING|billing/i.test(m)) {
    return "El proyecto de Google Cloud no tiene facturación activa: Places API exige una cuenta de facturación vinculada.";
  }
  if (i.http === 404 || /NOT_FOUND/i.test(m)) {
    return "Google no encuentra el Place ID: revisar GOOGLE_PLACE_ID (o borrarla para usar el de SIM Argentina).";
  }
  if (i.http === 429 || /RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT/i.test(m)) {
    return "Se alcanzó la cuota de Places API: revisar cuotas y límites en Google Cloud.";
  }
  if (i.http === 400 || /INVALID_ARGUMENT|INVALID_REQUEST/i.test(m)) {
    return "Google rechazó la consulta como inválida: revisar GOOGLE_PLACE_ID.";
  }
  return `Google respondió HTTP ${i.http}${i.estadoGoogle ? ` ${i.estadoGoogle}` : ""}${i.motivo ? ` (${i.motivo})` : ""}: revisar la key y la API en la consola de Google Cloud.`;
}

// ── Consulta ─────────────────────────────────────────────────────────────────

type Modo = "isr" | "sin_cache";

async function pedir(url: string, headers: Record<string, string>, modo: Modo): Promise<{
  http: number | null; body: unknown; ms: number;
}> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Next guarda en su Data Cache SOLO respuestas 200: un error nunca queda
    // retenido 6 h y la revalidación siguiente vuelve a preguntar.
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      ...(modo === "isr" ? { next: { revalidate: REVALIDATE_SECONDS } } : { cache: "no-store" as const }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { http: res.status, body, ms: Date.now() - t0 };
  } catch {
    return { http: null, body: null, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function consultar(modo: Modo): Promise<{ resenas: ResenasHome; diagnostico: DiagnosticoResenas }> {
  const apiKey = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  const placeEnv = (process.env.GOOGLE_PLACE_ID ?? "").trim();
  const placeId = placeEnv || PLACE_ID_SIM;
  const configuracion = {
    apiKey: apiKey ? ("presente" as const) : ("ausente" as const),
    placeId: placeEnv ? ("variable" as const) : ("predeterminado" as const),
    placeIdUsado: placeId,
  };
  const intentos: Intento[] = [];
  const cerrar = (
    estado: EstadoResenas,
    datos: { reviews: GoogleReview[]; recibidas: number; resumen: ResumenLugar; ficha: string | null } | null,
  ) => {
    const fichaUrl = datos?.ficha ?? urlFicha(placeId);
    const reviews = estado === "ok" && datos ? datos.reviews : [];
    const indicacion =
      estado === "ok"
        ? `La integración funciona: ${reviews.length} reseña(s) de 5★ para la Home.`
        : estado === "sin_resenas"
          ? `La integración funciona, pero Google devolvió ${datos?.recibidas ?? 0} reseña(s) y ninguna de 5★ con texto: la Home muestra el enlace a Google Maps.`
          : indicacionPara(intentos[0] ?? null, !!apiKey);
    return {
      resenas: { estado, reviews, resumen: datos?.resumen ?? null, fichaUrl },
      diagnostico: {
        configuracion,
        intentos,
        estado,
        recibidas: datos?.recibidas ?? 0,
        mostradas: reviews.length,
        resumen: datos?.resumen ?? null,
        fichaUrl,
        indicacion,
      },
    };
  };

  if (!apiKey) return cerrar("error", null);

  // 1) Places API (New): GET places/{id} con máscara de campos.
  const nueva = await pedir(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es&regionCode=AR`,
    { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": CAMPOS_NUEVA },
    modo,
  );
  if (nueva.http === 200 && nueva.body && typeof nueva.body === "object" && !("error" in nueva.body)) {
    intentos.push({ api: "places_new", http: 200, estadoGoogle: "OK", motivo: null, mensaje: null, ms: nueva.ms });
    const datos = normalizarNueva(nueva.body as NewApiPlace);
    return cerrar(datos.reviews.length > 0 ? "ok" : "sin_resenas", datos);
  }
  const err = leerErrorNueva(nueva.body);
  intentos.push({
    api: "places_new", http: nueva.http, estadoGoogle: err.estado, motivo: err.motivo,
    mensaje: redactar(err.mensaje, apiKey), ms: nueva.ms,
  });

  // 2) Respaldo: Place Details (legacy), por si la key solo tiene la API vieja.
  //    Contesta HTTP 200 también ante errores: lo que decide es `status`.
  const legacy = await pedir(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}` +
      `&fields=reviews,rating,user_ratings_total,url&language=es&reviews_no_translations=true&key=${encodeURIComponent(apiKey)}`,
    {},
    modo,
  );
  const lb = (legacy.body ?? null) as LegacyResponse | null;
  if (legacy.http === 200 && lb?.status === "OK") {
    intentos.push({ api: "places_legacy", http: 200, estadoGoogle: "OK", motivo: null, mensaje: null, ms: legacy.ms });
    const datos = normalizarLegacy(lb);
    return cerrar(datos.reviews.length > 0 ? "ok" : "sin_resenas", datos);
  }
  intentos.push({
    api: "places_legacy", http: legacy.http, estadoGoogle: lb?.status ?? null, motivo: null,
    mensaje: redactar(lb?.error_message, apiKey), ms: legacy.ms,
  });
  return cerrar("error", null);
}

/** Lo que muestra la Home (cacheado con la Home). Nunca lanza. */
export async function resenasParaHome(): Promise<ResenasHome> {
  try {
    const { resenas, diagnostico } = await consultar("isr");
    if (resenas.estado === "error") {
      const resumen = diagnostico.intentos
        .map((i) => `${i.api} HTTP ${i.http ?? "sin respuesta"} ${i.estadoGoogle ?? ""} ${i.motivo ?? ""}`.trim())
        .join(" | ");
      console.warn(
        `[googleReviews] Sin reseñas: ${resumen || `GOOGLE_PLACES_API_KEY ${diagnostico.configuracion.apiKey}`}. ${diagnostico.indicacion}`,
      );
    }
    return resenas;
  } catch {
    return { estado: "error", reviews: [], resumen: null, fichaUrl: urlFicha((process.env.GOOGLE_PLACE_ID ?? "").trim() || PLACE_ID_SIM) };
  }
}

/** Diagnóstico para el panel (sin caché, solo admin). Nunca lanza ni devuelve la key. */
export async function diagnosticarResenas(): Promise<DiagnosticoResenas> {
  return (await consultar("sin_cache")).diagnostico;
}
