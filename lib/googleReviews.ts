// Reseñas reales de Google Places — SOLO server-side.
//
// La API key vive únicamente en el servidor (env GOOGLE_PLACES_API_KEY, nunca
// NEXT_PUBLIC). Se devuelven exclusivamente reseñas de 5 estrellas, normalizadas
// y con los campos mínimos necesarios para el cliente. Ante cualquier error,
// timeout o falta de envs, se devuelve [] para que la Home muestre el fallback
// sin romperse. La respuesta de Google se cachea 6h vía el Data Cache de Next.

export type GoogleReview = {
  id: string;
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
};

const REVALIDATE_SECONDS = 6 * 60 * 60; // 6h
const FETCH_TIMEOUT_MS = 6000;
const MAX_TEXT = 600;
// Máximo de reseñas a mostrar. Google Places suele devolver pocas por request;
// dejamos el tope en 20 para mostrar automáticamente todas las disponibles.
const MAX_REVIEWS = 20;

function cleanText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT).trimEnd()}…` : t;
}

// ── Tipos parciales de las respuestas de Google ──────────────────────────────
interface NewApiReview {
  name?: string;
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string };
  relativePublishTimeDescription?: string;
}
interface NewApiResponse {
  reviews?: NewApiReview[];
}
interface LegacyReview {
  author_name?: string;
  rating?: number;
  text?: string;
  relative_time_description?: string;
  time?: number;
}
interface LegacyResponse {
  result?: { reviews?: LegacyReview[] };
  status?: string;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeNew(data: NewApiResponse): GoogleReview[] {
  const out: GoogleReview[] = [];
  (data.reviews ?? []).forEach((r, i) => {
    const author = (r.authorAttribution?.displayName ?? "").trim();
    const text = (r.text?.text ?? r.originalText?.text ?? "").trim();
    if (Number(r.rating) !== 5 || !author || !text) return; // descartar < 5★
    out.push({
      id: r.name || `${author}-${i}`,
      author,
      rating: 5,
      text: cleanText(text),
      relativeTime: (r.relativePublishTimeDescription ?? "").trim(),
    });
  });
  return out;
}

function normalizeLegacy(data: LegacyResponse): GoogleReview[] {
  const out: GoogleReview[] = [];
  (data.result?.reviews ?? []).forEach((r, i) => {
    const author = (r.author_name ?? "").trim();
    const text = (r.text ?? "").trim();
    if (Number(r.rating) !== 5 || !author || !text) return; // descartar < 5★
    out.push({
      id: r.time ? String(r.time) : `${author}-${i}`,
      author,
      rating: 5,
      text: cleanText(text),
      relativeTime: (r.relative_time_description ?? "").trim(),
    });
  });
  return out;
}

/**
 * Devuelve hasta 20 reseñas de 5★ del lugar configurado. [] si no hay envs,
 * si Google falla o si no hay reseñas de 5★. Nunca lanza.
 */
export async function getGoogleReviews(): Promise<GoogleReview[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (!apiKey || !placeId) return []; // envs ausentes → fallback (no rompe build)

  // 1) Places API (New) — preferida. Pedimos solo los subcampos necesarios.
  const newApi = await fetchJson(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "reviews.name,reviews.rating,reviews.text,reviews.originalText,reviews.authorAttribution.displayName,reviews.relativePublishTimeDescription",
      },
    }
  );
  if (newApi) return normalizeNew(newApi as NewApiResponse).slice(0, MAX_REVIEWS);

  // 2) Fallback: Places Details (legacy), por si la key tiene habilitada la API vieja.
  const legacy = await fetchJson(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
      placeId
    )}&fields=reviews&language=es&reviews_no_translations=true&key=${encodeURIComponent(apiKey)}`,
    {}
  );
  if (legacy) return normalizeLegacy(legacy as LegacyResponse).slice(0, MAX_REVIEWS);

  // Ambas APIs fallaron: log server-side genérico (sin exponer nada al cliente).
  console.warn(
    "[googleReviews] No se pudieron obtener reseñas (revisar GOOGLE_PLACES_API_KEY, GOOGLE_PLACE_ID y APIs habilitadas)."
  );
  return [];
}

/** Link público a todas las reseñas en Google (atribución). null si no hay place id. */
export function getGooglePlaceUrl(): string | null {
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (!placeId) return null;
  return `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`;
}
