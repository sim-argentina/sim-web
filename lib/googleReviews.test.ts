import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLACE_ID_SIM, urlFicha, redactar, normalizarNueva, normalizarLegacy, leerErrorNueva,
  indicacionPara, resenasPublicas, diagnosticarResenas, probarLegacy, fichaConfigurada, CAMPOS_NUEVA,
  atenderResenasPublicas, topeDiario, TOPE_DIARIO_PROPUESTO, type Intento, type Contador,
} from "@/lib/googleReviews";
import { resenasGooglePublicasHabilitadas } from "@/lib/featureFlags";

// Ejecutar: npx tsx lib/googleReviews.test.ts
// Reseñas de Google de la Home con respuestas SIMULADAS: fetch se reemplaza por
// un doble y ninguna consulta sale a Google. Esto NO prueba la integración real
// (key, API habilitada, facturación): eso se comprueba con una key real en
// local, Preview o Producción con GET /api/admin/resenas-google/diagnostico.
//
// Sin caché en ninguna capa (políticas de Google Maps Platform): consulta
// no-store, nada en memoria, respuesta no-store y nada de reseñas en el
// HTML/RSC de la Home. Consumo: solo con el botón «Ver reseñas», con la
// consulta pública apagada por defecto y un tope diario compartido (el
// contador real vive en la base; acá se usa uno falso con su misma semántica).

const KEY = "AIzaPRUEBA-no-es-una-key-real-0123456789";
const intento = (p: Partial<Intento>): Intento =>
  ({ api: "places_new", http: 403, estadoGoogle: null, motivo: null, mensaje: null, ms: 1, contada: true, ...p });

// ── 1 · Normalización: solo 5★ con texto, URLs https, texto original ─────────
{
  const d = normalizarNueva({
    rating: 4.9,
    userRatingCount: 129,
    googleMapsUri: "https://maps.google.com/?cid=1",
    googleMapsLinks: { reviewsUri: "https://www.google.com/maps/place//data=reviews" },
    reviews: [
      {
        name: "places/x/reviews/1", rating: 5,
        text: { text: "Traducido" }, originalText: { text: "  Muy   buena\nexperiencia " },
        authorAttribution: { displayName: "Ana", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.googleusercontent.com/a/1" },
        relativePublishTimeDescription: "hace 2 semanas", googleMapsUri: "https://www.google.com/maps/reviews/1",
      },
      { name: "r2", rating: 4, text: { text: "Bien" }, authorAttribution: { displayName: "Beto" } },
      { name: "r3", rating: 5, text: { text: "" }, authorAttribution: { displayName: "Caro" } },
      { name: "r4", rating: 5, text: { text: "Genial" }, authorAttribution: { displayName: "", uri: "https://x" } },
      {
        name: "r5", rating: 5, text: { text: "Volvería" },
        authorAttribution: { displayName: "Dani", uri: "javascript:alert(1)", photoUri: "http://inseguro/foto" },
        googleMapsUri: "data:text/html,hola",
      },
    ],
  });
  assert.equal(d.recibidas, 5);
  assert.deepEqual(d.reviews.map((r) => r.author), ["Ana", "Dani"], "solo 5★ con autor y texto");
  assert.equal(d.reviews[0].text, "Muy buena experiencia", "texto original del autor, espacios normalizados");
  assert.equal(d.reviews[0].authorPhoto, "https://lh3.googleusercontent.com/a/1");
  assert.equal(d.reviews[0].reviewUri, "https://www.google.com/maps/reviews/1");
  assert.deepEqual([d.reviews[1].authorUri, d.reviews[1].authorPhoto, d.reviews[1].reviewUri], [null, null, null],
    "nada que no sea https llega a un href o src");
  assert.deepEqual(d.resumen, { rating: 4.9, total: 129 });
  assert.equal(d.ficha, "https://www.google.com/maps/place//data=reviews", "la ficha de reseñas que da Google");
  assert.equal(normalizarNueva({}).ficha, null);
  assert.equal(normalizarNueva({ reviews: [] }).reviews.length, 0);

  const largo = normalizarNueva({ reviews: [{ rating: 5, text: { text: "x".repeat(900) }, authorAttribution: { displayName: "E" } }] });
  assert.ok(largo.reviews[0].text.length <= 601 && largo.reviews[0].text.endsWith("…"));

  const l = normalizarLegacy({
    status: "OK",
    result: {
      rating: 4.9, user_ratings_total: 129, url: "https://maps.google.com/?cid=2",
      reviews: [
        { author_name: "Fede", author_url: "https://www.google.com/maps/contrib/2", profile_photo_url: "https://lh3.googleusercontent.com/b", rating: 5, text: "Excelente", relative_time_description: "hace un mes", time: 1 },
        { author_name: "Gabi", rating: 3, text: "Normal" },
      ],
    },
  });
  assert.deepEqual(l.reviews.map((r) => [r.author, r.reviewUri]), [["Fede", null]], "legacy: sin enlace por reseña");
  assert.deepEqual([l.recibidas, l.ficha], [2, "https://maps.google.com/?cid=2"]);
}

// ── 2 · Errores de Google, redacción e indicaciones ──────────────────────────
{
  assert.deepEqual(
    leerErrorNueva({ error: { code: 403, status: "PERMISSION_DENIED", message: "Requests from referer <empty> are blocked.",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] } }),
    { estado: "PERMISSION_DENIED", motivo: "API_KEY_HTTP_REFERRER_BLOCKED", mensaje: "Requests from referer <empty> are blocked." },
  );
  assert.deepEqual(leerErrorNueva(null), { estado: null, motivo: null, mensaje: null });
  assert.deepEqual(leerErrorNueva({ reviews: [] }), { estado: null, motivo: null, mensaje: null });

  assert.equal(redactar(`La key ${KEY} no sirve`, KEY), "La key [key] no sirve");
  assert.equal(redactar("otra AIzaSyA1234567890abcdefghijklmnopqrstu", KEY), "otra [key]");
  assert.equal(redactar("", KEY), null);
  assert.ok((redactar("x".repeat(500), KEY) ?? "").length <= 301);

  const ind = (p: Partial<Intento>) => indicacionPara(intento(p), true);
  assert.match(indicacionPara(null, false), /GOOGLE_PLACES_API_KEY/);
  assert.match(ind({ motivo: "SERVICE_DISABLED" }), /habilitar «Places API \(New\)»/);
  assert.match(ind({ motivo: "API_KEY_HTTP_REFERRER_BLOCKED" }), /restringida a sitios web/);
  assert.match(ind({ motivo: "API_KEY_IP_ADDRESS_BLOCKED" }), /restringida por IP/);
  assert.match(ind({ motivo: "API_KEY_SERVICE_BLOCKED" }), /APIs permitidas/);
  assert.match(ind({ http: 400, estadoGoogle: "INVALID_ARGUMENT", motivo: "API_KEY_INVALID" }), /no es válida/);
  assert.match(ind({ motivo: "BILLING_DISABLED" }), /facturación/);
  assert.match(ind({ http: 404, estadoGoogle: "NOT_FOUND" }), /Place ID/);
  assert.match(ind({ http: 429, estadoGoogle: "RESOURCE_EXHAUSTED" }), /cuota/);
  assert.match(ind({ http: null }), /no respondió a tiempo/);
  assert.match(ind({ http: 500, estadoGoogle: "INTERNAL" }), /HTTP 500 INTERNAL/);

  assert.equal(urlFicha(PLACE_ID_SIM),
    `https://www.google.com/maps/search/?api=1&query=SIM%20Argentina&query_place_id=${PLACE_ID_SIM}`);
}

// ── 3 · Consulta completa con un doble de fetch y un contador falso ──────────
type Llamada = { url: string; headers: Record<string, string>; cache: RequestCache | undefined; next: unknown };
const llamadas: Llamada[] = [];
let respuestas: Array<() => Promise<Response>> = [];
const json = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  llamadas.push({
    url: String(input), headers: { ...((init?.headers as Record<string, string>) ?? {}) },
    cache: init?.cache, next: (init as { next?: unknown } | undefined)?.next,
  });
  const r = respuestas.shift();
  if (!r) throw new Error("fetch inesperado");
  return r();
}) as typeof fetch;

function preparar(env: { key?: string; place?: string }, ...r: Array<() => Promise<Response>>) {
  llamadas.length = 0;
  respuestas = r;
  if (env.key === undefined) delete process.env.GOOGLE_PLACES_API_KEY; else process.env.GOOGLE_PLACES_API_KEY = env.key;
  if (env.place === undefined) delete process.env.GOOGLE_PLACE_ID; else process.env.GOOGLE_PLACE_ID = env.place;
}

/** Contador falso con la MISMA semántica que la RPC: sin forzar respeta el tope; forzado cuenta siempre. */
function contadorFalso(o: { tope?: number; llamadas?: number; operativo?: boolean; lanza?: boolean; reservaCaida?: boolean } = {}) {
  const c = { tope: o.tope ?? 30, llamadas: o.llamadas ?? 0, reservas: 0, forzadas: 0 };
  const contador: Contador = {
    tope: c.tope,
    async reservar(forzar) {
      if (o.lanza) throw new Error("red caída");
      if (o.operativo === false || o.reservaCaida) return { ok: false, motivo: "no_operativo" };
      if (!forzar && c.llamadas >= c.tope) return { ok: false, motivo: "tope" };
      c.llamadas++; c.reservas++; if (forzar) c.forzadas++;
      return { ok: true, llamada: c.llamadas };
    },
    async leer() {
      return o.operativo === false
        ? { operativo: false, fecha: "2026-11-07", llamadas: null, tope: c.tope }
        : { operativo: true, fecha: "2026-11-07", llamadas: c.llamadas, tope: c.tope };
    },
  };
  return { contador, c };
}

const RESENA_5 = {
  name: "places/x/reviews/a", rating: 5, originalText: { text: "La mejor experiencia" },
  authorAttribution: { displayName: "Ana", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.googleusercontent.com/a" },
  relativePublishTimeDescription: "hace 1 mes", googleMapsUri: "https://www.google.com/maps/reviews/a",
  flagContentUri: "https://www.google.com/local/review/rap/report?a",
};
const REFERER_BLOQUEADO = json(403, { error: { code: 403, status: "PERMISSION_DENIED", message: `Requests from referer <empty> are blocked. key=${KEY}`,
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] } });
const NUEVA_DESHABILITADA = json(403, { error: { code: 403, status: "PERMISSION_DENIED",
  message: "Places API (New) has not been used in project 1 before or it is disabled.",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } });
const LEGACY_DENEGADA = json(200, { status: "REQUEST_DENIED", error_message: "You're calling a legacy API, which is not enabled for your project." });
const LEGACY_OK = json(200, { status: "OK", result: { rating: 4.9, user_ratings_total: 129, url: "https://maps.google.com/?cid=9",
  reviews: [{ author_name: "Fede", rating: 5, text: "Excelente", time: 1 }] } });
const OK = json(200, { rating: 4.9, userRatingCount: 129, googleMapsLinks: { reviewsUri: "https://www.google.com/maps/reviews-sim" },
  reviews: [RESENA_5, { ...RESENA_5, name: "b", rating: 4 }] });

async function consultas() {
const avisos: string[] = [];
const warnReal = console.warn;
console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

try {
  // a) Sin key: ni se reserva ni se consulta a Google; enlace válido a la ficha de SIM.
  let k = contadorFalso();
  preparar({});
  let h = await resenasPublicas(k.contador);
  assert.deepEqual([h.estado, h.reviews.length, h.resumen, llamadas.length, k.c.reservas], ["error", 0, null, 0, 0]);
  assert.equal(h.fichaUrl, urlFicha(PLACE_ID_SIM));
  let d = await diagnosticarResenas(k.contador, false);
  assert.deepEqual(d.configuracion, { apiKey: "ausente", placeId: "predeterminado", placeIdUsado: PLACE_ID_SIM });
  assert.match(d.indicacion, /Falta la variable GOOGLE_PLACES_API_KEY en el entorno donde corre la web: \.env\.local en local, o Vercel/);
  assert.equal(d.consultaPublica, "deshabilitada");

  // b) Places API (New) responde: una consulta, una reserva, máscara mínima, sin caché.
  k = contadorFalso();
  preparar({ key: KEY }, OK);
  h = await resenasPublicas(k.contador);
  assert.deepEqual([h.estado, h.reviews.length, h.fichaUrl], ["ok", 1, "https://www.google.com/maps/reviews-sim"]);
  assert.deepEqual(h.resumen, { rating: 4.9, total: 129 });
  assert.equal(h.reviews[0].reportUri, "https://www.google.com/local/review/rap/report?a");
  assert.deepEqual([llamadas.length, k.c.reservas, k.c.forzadas], [1, 1, 0], "cada consulta real a Google, contada");
  assert.ok(llamadas[0].url.startsWith(`https://places.googleapis.com/v1/places/${PLACE_ID_SIM}?`));
  assert.ok(llamadas[0].url.includes("languageCode=es"));
  assert.ok(!llamadas[0].url.includes(KEY), "la key va en el header, no en la URL");
  assert.equal(llamadas[0].headers["X-Goog-Api-Key"], KEY);
  assert.equal(llamadas[0].headers["X-Goog-FieldMask"], CAMPOS_NUEVA);
  assert.equal(CAMPOS_NUEVA,
    "rating,userRatingCount,googleMapsLinks.reviewsUri,reviews.name,reviews.rating,reviews.text,reviews.originalText," +
    "reviews.authorAttribution,reviews.relativePublishTimeDescription,reviews.googleMapsUri,reviews.flagContentUri",
    "solo lo que se muestra: sin wildcard ni campos enteros");
  assert.deepEqual([llamadas[0].cache, llamadas[0].next], ["no-store", undefined], "la consulta no entra al Data Cache de Next");

  // c) Responde pero sin 5★ con texto: "sin_resenas", no "error".
  k = contadorFalso();
  preparar({ key: KEY, place: "ChIJotroLugar" }, json(200, { rating: 3.1, userRatingCount: 7, reviews: [{ ...RESENA_5, rating: 3 }] }));
  d = await diagnosticarResenas(k.contador, false);
  assert.deepEqual([d.estado, d.recibidas, d.mostradas, d.configuracion.placeId], ["sin_resenas", 1, 0, "variable"]);
  assert.ok(llamadas[0].url.includes("/places/ChIJotroLugar?"), "GOOGLE_PLACE_ID manda si está");
  assert.equal(d.fichaUrl, urlFicha("ChIJotroLugar"), "sin enlace de Google: la ficha armada con el Place ID");

  // d) EL DEFECTO ORIGINAL: New sin habilitar y legacy contesta 200 REQUEST_DENIED.
  //    Antes se leía como "no hay reseñas" sin rastro. El respaldo TAMBIÉN se cuenta.
  k = contadorFalso();
  preparar({ key: KEY }, NUEVA_DESHABILITADA, LEGACY_DENEGADA);
  avisos.length = 0;
  h = await resenasPublicas(k.contador);
  assert.deepEqual([h.estado, h.reviews.length], ["error", 0], "un REQUEST_DENIED es un error, no ausencia de reseñas");
  assert.deepEqual([llamadas.length, k.c.reservas], [2, 2], "el intento de respaldo también reserva cupo");
  assert.equal(avisos.length, 1, "deja rastro en el log del servidor");
  assert.match(avisos[0], /places_new HTTP 403 PERMISSION_DENIED SERVICE_DISABLED \| places_legacy HTTP 200 REQUEST_DENIED/);
  assert.match(avisos[0], /habilitar «Places API \(New\)»/);
  assert.ok(!avisos[0].includes(KEY), "el log no imprime la key");
  assert.ok(llamadas[1].url.startsWith("https://maps.googleapis.com/maps/api/place/details/json?"));
  assert.equal(llamadas[1].cache, "no-store", "el respaldo tampoco se cachea");

  // d') Otra falla (restricción de la key): NO se gasta una consulta legacy que fallaría igual.
  k = contadorFalso();
  preparar({ key: KEY }, REFERER_BLOQUEADO);
  d = await diagnosticarResenas(k.contador, false);
  assert.deepEqual([llamadas.length, k.c.reservas], [1, 1], "sin consulta de respaldo");
  assert.deepEqual(d.intentos.map((i) => [i.api, i.http, i.estadoGoogle, i.motivo, i.contada]), [
    ["places_new", 403, "PERMISSION_DENIED", "API_KEY_HTTP_REFERRER_BLOCKED", true],
  ]);
  assert.match(d.indicacion, /quitar la restricción por sitio web/);
  assert.ok(!/usar una key|crear/i.test(d.indicacion), "corrige la key existente: no propone otra");
  assert.ok(!JSON.stringify(d).includes(KEY), "el diagnóstico no devuelve la key");
  assert.equal(probarLegacy({ ...d.intentos[0] }), false);

  // e) New deshabilitada, legacy habilitada: se muestran igual (respaldo), dos llamadas contadas.
  k = contadorFalso();
  preparar({ key: KEY }, NUEVA_DESHABILITADA, LEGACY_OK);
  h = await resenasPublicas(k.contador);
  assert.deepEqual([h.estado, h.reviews.map((r) => r.author), h.fichaUrl, k.c.reservas], ["ok", ["Fede"], "https://maps.google.com/?cid=9", 2]);

  // f) Google no responde o no devuelve JSON: error, nunca una excepción.
  k = contadorFalso();
  preparar({ key: KEY }, () => Promise.reject(new DOMException("abortado", "AbortError")));
  d = await diagnosticarResenas(k.contador, false);
  assert.deepEqual([d.intentos.map((i) => i.http), d.estado, llamadas.length], [[null], "error", 1]);
  assert.match(d.indicacion, /no respondió a tiempo/);
  preparar({ key: KEY }, () => Promise.resolve(new Response("<html>502</html>", { status: 502 })));
  d = await diagnosticarResenas(contadorFalso().contador, false);
  assert.deepEqual([d.intentos.map((i) => i.http), d.estado], [[502], "error"]);

  // g) Sin memoria entre requests: dos pedidos seguidos son dos consultas y dos reservas.
  k = contadorFalso();
  preparar({ key: KEY }, OK, OK);
  await resenasPublicas(k.contador);
  await resenasPublicas(k.contador);
  assert.deepEqual([llamadas.length, k.c.reservas], [2, 2], "nada queda guardado en el proceso");

  // ── TOPE DIARIO COMPARTIDO ────────────────────────────────────────────────
  // h) Tope ya alcanzado: no se consulta a Google; queda solo el enlace.
  k = contadorFalso({ tope: 3, llamadas: 3 });
  preparar({ key: KEY }, OK);
  h = await resenasPublicas(k.contador);
  assert.deepEqual([h.estado, h.reviews.length, llamadas.length, k.c.llamadas], ["limitado", 0, 0, 3], "sin cupo, sin consulta");
  assert.equal(h.fichaUrl, urlFicha(PLACE_ID_SIM));

  // i) El cupo se acaba ENTRE la API nueva y el respaldo: el respaldo no sale.
  k = contadorFalso({ tope: 1 });
  preparar({ key: KEY }, NUEVA_DESHABILITADA, LEGACY_OK);
  h = await resenasPublicas(k.contador);
  assert.deepEqual([h.estado, llamadas.length, k.c.llamadas], ["limitado", 1, 1], "la llamada nueva contó; el respaldo no se hizo");

  // j) Contador sin responder (falta la migración, base caída) o que lanza: cerrado.
  for (const o of [{ operativo: false }, { lanza: true }]) {
    k = contadorFalso(o);
    preparar({ key: KEY }, OK);
    h = await resenasPublicas(k.contador);
    assert.deepEqual([h.estado, llamadas.length], ["limitado", 0], `contador ${JSON.stringify(o)}: sin consulta`);
  }

  // k) Diagnóstico admin: consulta controlada que el tope NO frena, pero queda contada.
  k = contadorFalso({ tope: 3, llamadas: 3 });
  preparar({ key: KEY }, OK);
  d = await diagnosticarResenas(k.contador, true);
  assert.deepEqual([d.estado, llamadas.length, k.c.llamadas, k.c.forzadas, d.intentos[0].contada], ["ok", 1, 4, 1, true]);
  assert.deepEqual(d.contador, { operativo: true, fecha: "2026-11-07", llamadas: 4, tope: 3, origenTope: "predeterminado" });
  assert.equal(d.consultaPublica, "habilitada");

  // l) Diagnóstico con el contador sin responder: consulta igual y avisa que NO quedó contada.
  k = contadorFalso({ operativo: false });
  preparar({ key: KEY }, OK);
  d = await diagnosticarResenas(k.contador, false);
  assert.deepEqual([d.estado, llamadas.length, d.intentos[0].contada, d.contador.operativo], ["ok", 1, false, false]);
  assert.match(d.indicacion, /esta consulta NO quedó contada/);
  // l') La tabla se lee pero la RPC de reserva no responde (visto en la base local): tampoco es "operativo".
  k = contadorFalso({ reservaCaida: true });
  preparar({ key: KEY }, OK);
  d = await diagnosticarResenas(k.contador, false);
  assert.deepEqual([d.estado, d.intentos[0].contada, d.contador.operativo], ["ok", false, false]);
  assert.match(d.indicacion, /NO quedó contada/);
  // Con todo contado, sin aviso.
  d = await (async () => { preparar({ key: KEY }, OK); return diagnosticarResenas(contadorFalso().contador, false); })();
  assert.ok(d.contador.operativo && !/NO quedó contada/.test(d.indicacion));

  // ── 4 · /api/resenas (lógica): apagada por defecto, límite por IP, sin parámetros ──
  const pedido = (q = "") => new Request(`https://simexperience.com.ar/api/resenas${q}`);
  let creados = 0;
  const deps = (habilitada: boolean, ipOk = true) => {
    const kk = contadorFalso();
    return { kk, d: { habilitada, contador: () => { creados++; return kk.contador; }, limitePorIp: async () => ipOk } };
  };
  // Apagada: 404, ni contador ni Google.
  creados = 0;
  let x = deps(false);
  preparar({ key: KEY }, OK);
  let res = await atenderResenasPublicas(pedido(), x.d);
  assert.deepEqual([res.status, res.cuerpo.estado, res.cuerpo.fichaUrl, llamadas.length, creados], [404, "desactivado", fichaConfigurada(), 0, 0]);
  // Prendida, límite por IP superado: 429, sin contador ni Google.
  x = deps(true, false);
  preparar({ key: KEY }, OK);
  res = await atenderResenasPublicas(pedido(), x.d);
  assert.deepEqual([res.status, res.cuerpo.estado, llamadas.length, creados], [429, "limitado", 0, 0]);
  // Prendida: una consulta contada; los parámetros del cliente no cambian nada.
  x = deps(true);
  preparar({ key: KEY }, OK);
  res = await atenderResenasPublicas(pedido("?place=ChIJotro&fields=*"), x.d);
  assert.deepEqual([res.status, res.cuerpo.estado, x.kk.c.reservas], [200, "ok", 1]);
  assert.ok(llamadas[0].url.includes(`/places/${PLACE_ID_SIM}?`) && llamadas[0].headers["X-Goog-FieldMask"] === CAMPOS_NUEVA,
    "los parámetros del cliente no cambian la consulta a Google");
} finally {
  globalThis.fetch = fetchReal;
  console.warn = warnReal;
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACE_ID;
}
}

// ── 5 · Tope configurable y llave apagada por defecto ───────────────────────
{
  assert.equal(TOPE_DIARIO_PROPUESTO, 30);
  assert.deepEqual(topeDiario({}), { tope: 30, origen: "predeterminado" });
  assert.deepEqual(topeDiario({ GOOGLE_PLACES_TOPE_DIARIO: "50" }), { tope: 50, origen: "variable" });
  assert.deepEqual(topeDiario({ GOOGLE_PLACES_TOPE_DIARIO: " 0 " }), { tope: 0, origen: "variable" });
  for (const malo of ["-1", "abc", "1e3", "10.5", "9999999"]) {
    assert.deepEqual(topeDiario({ GOOGLE_PLACES_TOPE_DIARIO: malo }), { tope: 0, origen: "invalido" }, `"${malo}" cierra`);
  }
  assert.equal(resenasGooglePublicasHabilitadas({}), false, "apagada por defecto");
  assert.equal(resenasGooglePublicasHabilitadas({ RESENAS_GOOGLE_PUBLICAS: "1" }), false);
  assert.equal(resenasGooglePublicasHabilitadas({ RESENAS_GOOGLE_PUBLICAS: "true" }), true);
}

// ── 6 · Capas sin caché, sin carga automática y la Home sin reseñas en su HTML ─
{
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const sinComentarios = (x: string) => x.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Consulta y proceso.
  const lib = sinComentarios(leer("lib/googleReviews.ts"));
  assert.ok(!/NEXT_PUBLIC/.test(lib), "la key nunca se expone al navegador");
  assert.ok(lib.includes('cache: "no-store"') && !/revalidate|next:\s*\{|force-cache|unstable_cache|"use cache"|cacheLife/.test(lib),
    "fetch sin caché y sin otra caché de Next");
  assert.ok(!/^(let|const|var)\s+\w+\s*=\s*new (Map|WeakMap|Set)\b/m.test(lib) && !/^let\s/m.test(lib), "sin estado de módulo que guarde respuestas");
  assert.ok(!/supabaseAdmin|createClient/.test(lib), "la lógica no toca la base: el contador se inyecta");
  assert.equal((lib.match(/await pedir\(/g) ?? []).length, 2, "dos consultas posibles (nueva y respaldo)…");
  assert.equal((lib.match(/await reservar\("places_(new|legacy)"\)/g) ?? []).length, 2, "…y cada una reserva cupo antes");

  // Contador real (Supabase).
  const consumo = sinComentarios(leer("lib/googlePlacesConsumo.ts"));
  assert.ok(consumo.includes('"google_places_reservar_llamada"') && consumo.includes("p_forzar: forzar"));
  assert.ok(/motivo: "no_operativo"/.test(consumo), "falla cerrado");
  const sql = leer("db/google-places-consumo.sql");
  assert.ok(sql.includes("on conflict (fecha) do update") && sql.includes("where coalesce(p_forzar, false) or c.llamadas < p_tope"), "reserva atómica con tope");
  assert.ok(sql.includes("(now() at time zone 'America/Argentina/Buenos_Aires')::date") && !/current_date/i.test(sql), "fecha de negocio de Argentina");
  assert.ok(/^google-places-consumo\.sql$/m.test(leer("db/orden.txt")), "en el esquema local");

  // Respuesta HTTP.
  const ruta = sinComentarios(leer("app/api/resenas/route.ts"));
  assert.ok(/export const dynamic = "force-dynamic"/.test(ruta) && ruta.includes('"private, no-store, max-age=0"'));
  assert.ok(ruta.includes("habilitada: resenasGooglePublicasHabilitadas()") && ruta.includes("contadorGooglePlaces()"));
  assert.ok(ruta.includes("rateLimit(") && !/searchParams|req\.url/.test(ruta), "con límite por IP y sin parámetros del cliente");
  const diag = sinComentarios(leer("app/api/admin/resenas-google/diagnostico/route.ts"));
  assert.ok(diag.includes("requireAdmin()") && diag.includes("no-store") && diag.includes("diagnosticarResenas(contadorGooglePlaces()"));

  // HTML/RSC de la Home: resumen ESTÁTICO de SIM; ni el servidor ni el navegador piden reseñas.
  const home = sinComentarios(leer("app/page.tsx"));
  assert.ok(home.includes("<ResenasDestacadas fichaUrl={fichaConfigurada()} />"));
  assert.ok(!/resenasPublicas|diagnosticarResenas|ReviewsCarousel|ResenasGoogle|resenasGooglePublicasHabilitadas|await\s+\w*[Rr]esen/.test(home),
    "la Home no trae reseñas al renderizar ni monta la consulta pública");
  const destacadasFuente = leer("components/ResenasDestacadas.tsx");
  const destacadas = sinComentarios(destacadasFuente);
  assert.ok(!/^"use client"/.test(destacadasFuente) && !/useState|useEffect|fetch\(|\/api\/resenas|googleapis/.test(destacadas),
    "contenido estático del servidor: no consulta /api/resenas ni a Google");
  const titulos = ["Sensación de Fórmula 1", "Un plan para compartir", "Variedad y buena atención"].map((t) => destacadas.indexOf(t));
  assert.ok(titulos.every((i, n) => i > 0 && (n === 0 || i > titulos[n - 1])), "las tres tarjetas, en este orden");
  assert.equal((destacadas.match(/<a\b/g) ?? []).length, 1, "un único enlace…");
  assert.ok(destacadas.includes("href={fichaUrl}") && destacadas.includes("Ver todas las reseñas en Google Maps"), "…a la ficha de Google Maps");
  assert.ok(!/En camino|verificadas|<img|★/i.test(destacadas), "sin esqueleto, fotos ni estrellas");

  // Sección en vivo (hoy sin montar en la Home): se conserva su contrato.
  const seccion = sinComentarios(leer("components/ResenasGoogle.tsx"));
  assert.ok(/^"use client"/.test(leer("components/ResenasGoogle.tsx")));
  assert.ok(!/IntersectionObserver/.test(seccion), "sin carga automática al acercarse");
  assert.equal((seccion.match(/fetch\(/g) ?? []).length, 1);
  const iFetch = seccion.indexOf('fetch("/api/resenas", { cache: "no-store"');
  const iBoton = seccion.indexOf("const verResenas = () => {");
  const iFinBoton = seccion.indexOf("const datos = ");
  assert.ok(iBoton > 0 && iFetch > iBoton && iFetch < iFinBoton, "el único fetch está dentro del clic en «Ver reseñas»");
  assert.ok(seccion.includes("onClick={verResenas}") && seccion.includes("Ver reseñas") && seccion.includes("consultaHabilitada && estado.fase === \"inicial\""));
  assert.ok(seccion.includes("ESPERA_MAXIMA_MS = 12_000") && seccion.includes("<noscript>"), "carga con tope y sin JS solo el enlace");
  assert.ok(seccion.includes("Mostramos solo reseñas de 5 estrellas") && seccion.includes("<AtribucionGoogleMaps />"));
  assert.ok(!/En camino|verificadas/i.test(seccion + home), "sin el esqueleto «Reseñas verificadas · En camino»");

  // Atribuciones.
  const atribucion = leer("components/AtribucionGoogleMaps.tsx");
  assert.ok(atribucion.includes('translate="no"') && atribucion.includes("Google Maps") && atribucion.includes("Roboto"));
  const carrusel = leer("components/ReviewsCarousel.tsx");
  assert.ok(carrusel.includes("r.authorUri") && carrusel.includes("r.authorPhoto") && carrusel.includes("r.reviewUri ?? fichaUrl") && carrusel.includes("r.reportUri"),
    "avatar, perfil del autor, enlace a la reseña y para reportarla");
  assert.ok(!/GoogleG/.test(carrusel));
}

consultas().then(() => {
  console.log("OK — Reseñas de Google (simuladas): atribuciones, errores con motivo, respaldo legacy solo con la API nueva deshabilitada; tope diario compartido reservado antes de cada consulta (incluido el respaldo), cerrado si el contador no responde, diagnóstico forzado y contado; /api/resenas apagada por defecto, con límite por IP y sin parámetros; sin caché ni carga automática; la Home sin reseñas en su HTML.");
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
