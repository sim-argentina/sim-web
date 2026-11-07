import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLACE_ID_SIM, urlFicha, redactar, normalizarNueva, normalizarLegacy, leerErrorNueva,
  indicacionPara, resenasPublicas, diagnosticarResenas, probarLegacy, fichaConfigurada, CAMPOS_NUEVA, type Intento,
} from "@/lib/googleReviews";

// Ejecutar: npx tsx lib/googleReviews.test.ts
// Reseñas de Google de la Home con respuestas SIMULADAS: fetch se reemplaza por
// un doble y ninguna consulta sale a Google. Esto NO prueba la integración real
// (key, API habilitada, facturación): eso se comprueba con una key real en
// local, Preview o Producción con GET /api/admin/resenas-google/diagnostico.
//
// Sin caché en ninguna capa (políticas de Google Maps Platform): consulta
// no-store, nada en memoria, respuesta no-store y nada de reseñas en el
// HTML/RSC de la Home.

const KEY = "AIzaPRUEBA-no-es-una-key-real-0123456789";
const intento = (p: Partial<Intento>): Intento =>
  ({ api: "places_new", http: 403, estadoGoogle: null, motivo: null, mensaje: null, ms: 1, ...p });

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

// ── 3 · Consulta completa con un doble de fetch ──────────────────────────────
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

const RESENA_5 = {
  name: "places/x/reviews/a", rating: 5, originalText: { text: "La mejor experiencia" },
  authorAttribution: { displayName: "Ana", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.googleusercontent.com/a" },
  relativePublishTimeDescription: "hace 1 mes", googleMapsUri: "https://www.google.com/maps/reviews/a",
};
const REFERER_BLOQUEADO = json(403, { error: { code: 403, status: "PERMISSION_DENIED", message: `Requests from referer <empty> are blocked. key=${KEY}`,
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] } });
const NUEVA_DESHABILITADA = json(403, { error: { code: 403, status: "PERMISSION_DENIED",
  message: "Places API (New) has not been used in project 1 before or it is disabled.",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } });
const LEGACY_DENEGADA = json(200, { status: "REQUEST_DENIED", error_message: "You're calling a legacy API, which is not enabled for your project." });

async function rutaPublica(
  preparar: (env: { key?: string; place?: string }, ...r: Array<() => Promise<Response>>) => void,
  llamadas: Llamada[],
  ok: () => Promise<Response>,
) {
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const { GET } = await import("@/app/api/resenas/route");
  const pedido = (ip: string, q = "") => new Request(`https://simexperience.com.ar/api/resenas${q}`, { headers: { "x-vercel-forwarded-for": ip } });

  preparar({ key: KEY }, ok);
  let res = await GET(pedido("203.0.113.1", "?place=ChIJotro&fields=*"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(res.headers.get("cdn-cache-control"), "no-store");
  assert.equal(res.headers.get("vercel-cdn-cache-control"), "no-store");
  const cuerpo = await res.json() as { estado: string; reviews: unknown[] };
  assert.deepEqual([cuerpo.estado, cuerpo.reviews.length], ["ok", 1]);
  assert.ok(llamadas[0].url.includes(`/places/${PLACE_ID_SIM}?`) && llamadas[0].headers["X-Goog-FieldMask"] === CAMPOS_NUEVA,
    "los parámetros del cliente no cambian la consulta a Google");

  // Límite por IP: 6 por minuto; el 7.º no consulta a Google y deja el enlace.
  preparar({ key: KEY }, ok, ok, ok, ok, ok);
  for (let i = 0; i < 5; i++) assert.equal((await GET(pedido("203.0.113.1"))).status, 200);
  const antes = llamadas.length;
  res = await GET(pedido("203.0.113.1"));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(await res.json(), { estado: "limitado", reviews: [], resumen: null, fichaUrl: fichaConfigurada() });
  assert.equal(llamadas.length, antes, "pasado el límite no se llama a Google");
  // Otra IP sigue pudiendo.
  preparar({ key: KEY }, ok);
  assert.equal((await GET(pedido("203.0.113.2"))).status, 200);
}

async function consultas() {
const avisos: string[] = [];
const warnReal = console.warn;
console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

try {
  // a) Sin key: ni se consulta a Google; enlace válido a la ficha de SIM.
  preparar({});
  let h = await resenasPublicas();
  assert.deepEqual([h.estado, h.reviews.length, h.resumen, llamadas.length], ["error", 0, null, 0]);
  assert.equal(h.fichaUrl, urlFicha(PLACE_ID_SIM));
  let d = await diagnosticarResenas();
  assert.deepEqual(d.configuracion, { apiKey: "ausente", placeId: "predeterminado", placeIdUsado: PLACE_ID_SIM });
  assert.match(d.indicacion, /Falta la variable GOOGLE_PLACES_API_KEY/);

  // b) Places API (New) responde: reseñas reales, una sola consulta, máscara de campos.
  preparar({ key: KEY }, json(200, {
    rating: 4.9, userRatingCount: 129, googleMapsLinks: { reviewsUri: "https://www.google.com/maps/reviews-sim" },
    reviews: [RESENA_5, { ...RESENA_5, name: "b", rating: 4 }],
  }));
  h = await resenasPublicas();
  assert.deepEqual([h.estado, h.reviews.length, h.fichaUrl], ["ok", 1, "https://www.google.com/maps/reviews-sim"]);
  assert.deepEqual(h.resumen, { rating: 4.9, total: 129 });
  assert.equal(llamadas.length, 1);
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
  preparar({ key: KEY, place: "ChIJotroLugar" }, json(200, { rating: 3.1, userRatingCount: 7, reviews: [{ ...RESENA_5, rating: 3 }] }));
  d = await diagnosticarResenas();
  assert.deepEqual([d.estado, d.recibidas, d.mostradas, d.configuracion.placeId], ["sin_resenas", 1, 0, "variable"]);
  assert.ok(llamadas[0].url.includes("/places/ChIJotroLugar?"), "GOOGLE_PLACE_ID manda si está");
  assert.equal(d.fichaUrl, urlFicha("ChIJotroLugar"), "sin enlace de Google: la ficha armada con el Place ID");

  // d) EL DEFECTO ORIGINAL: New sin habilitar y legacy contesta 200 REQUEST_DENIED.
  //    Antes eso se leía como "no hay reseñas" sin dejar rastro.
  preparar({ key: KEY }, NUEVA_DESHABILITADA, LEGACY_DENEGADA);
  avisos.length = 0;
  h = await resenasPublicas();
  assert.deepEqual([h.estado, h.reviews.length], ["error", 0], "un REQUEST_DENIED es un error, no ausencia de reseñas");
  assert.equal(avisos.length, 1, "deja rastro en el log del servidor");
  assert.match(avisos[0], /places_new HTTP 403 PERMISSION_DENIED SERVICE_DISABLED \| places_legacy HTTP 200 REQUEST_DENIED/);
  assert.match(avisos[0], /habilitar «Places API \(New\)»/);
  assert.ok(!avisos[0].includes(KEY), "el log no imprime la key");
  assert.ok(llamadas[1].url.startsWith("https://maps.googleapis.com/maps/api/place/details/json?"));
  assert.equal(llamadas[1].cache, "no-store", "el respaldo tampoco se cachea");

  // d') Otra falla (restricción de la key): NO se gasta una consulta legacy que fallaría igual.
  preparar({ key: KEY }, REFERER_BLOQUEADO);
  d = await diagnosticarResenas();
  assert.equal(llamadas.length, 1, "sin consulta de respaldo");
  assert.deepEqual(d.intentos.map((i) => [i.api, i.http, i.estadoGoogle, i.motivo]), [
    ["places_new", 403, "PERMISSION_DENIED", "API_KEY_HTTP_REFERRER_BLOCKED"],
  ]);
  assert.match(d.indicacion, /restringida a sitios web/);
  assert.ok(!JSON.stringify(d).includes(KEY), "el diagnóstico no devuelve la key");
  assert.equal(probarLegacy({ ...d.intentos[0] }), false);
  assert.equal(probarLegacy({ api: "places_new", http: 403, estadoGoogle: "PERMISSION_DENIED", motivo: "SERVICE_DISABLED", mensaje: null, ms: 1 }), true);

  // e) New deshabilitada, legacy habilitada: se muestran igual (respaldo).
  preparar({ key: KEY }, NUEVA_DESHABILITADA,
    json(200, { status: "OK", result: { rating: 4.9, user_ratings_total: 129, url: "https://maps.google.com/?cid=9",
      reviews: [{ author_name: "Fede", rating: 5, text: "Excelente", time: 1 }] } }));
  h = await resenasPublicas();
  assert.deepEqual([h.estado, h.reviews.map((r) => r.author), h.fichaUrl], ["ok", ["Fede"], "https://maps.google.com/?cid=9"]);

  // f) Google no responde (timeout/red) o no devuelve JSON: error, nunca una excepción.
  preparar({ key: KEY }, () => Promise.reject(new DOMException("abortado", "AbortError")));
  d = await diagnosticarResenas();
  assert.deepEqual([d.intentos.map((i) => i.http), d.estado, llamadas.length], [[null], "error", 1]);
  assert.match(d.indicacion, /no respondió a tiempo/);
  preparar({ key: KEY }, () => Promise.resolve(new Response("<html>502</html>", { status: 502 })));
  d = await diagnosticarResenas();
  assert.deepEqual([d.intentos.map((i) => i.http), d.estado], [[502], "error"]);

  // g) Sin memoria entre requests: dos pedidos seguidos son dos consultas a Google.
  const OK = json(200, { reviews: [RESENA_5] });
  preparar({ key: KEY }, OK, OK);
  await resenasPublicas();
  await resenasPublicas();
  assert.equal(llamadas.length, 2, "nada queda guardado en el proceso");

  // h) /api/resenas: respuesta sin caché, sin parámetros del cliente, con límites.
  await rutaPublica(preparar, llamadas, OK);
} finally {
  globalThis.fetch = fetchReal;
  console.warn = warnReal;
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACE_ID;
}
}

// ── 4 · Capas sin caché y la Home sin reseñas en su HTML ─────────────────────
{
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const sinComentarios = (x: string) => x.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Consulta y proceso.
  const lib = sinComentarios(leer("lib/googleReviews.ts"));
  assert.ok(!/NEXT_PUBLIC/.test(lib), "la key nunca se expone al navegador");
  assert.ok(lib.includes('cache: "no-store"') && !/revalidate|next:\s*\{|force-cache|unstable_cache|"use cache"|cacheLife/.test(lib),
    "fetch sin caché y sin otra caché de Next");
  assert.ok(!/^(let|const|var)\s+\w+\s*=\s*new (Map|WeakMap|Set)\b/m.test(lib) && !/^let\s/m.test(lib), "sin estado de módulo que guarde respuestas");

  // Respuesta HTTP.
  const ruta = sinComentarios(leer("app/api/resenas/route.ts"));
  assert.ok(/export const dynamic = "force-dynamic"/.test(ruta) && ruta.includes('"private, no-store, max-age=0"'));
  assert.ok(ruta.includes("rateLimit(") && !/searchParams|req\.url/.test(ruta), "con límites y sin parámetros del cliente");
  const diag = sinComentarios(leer("app/api/admin/resenas-google/diagnostico/route.ts"));
  assert.ok(diag.includes("requireAdmin()") && diag.includes("no-store"));

  // HTML/RSC de la Home: el servidor no consulta a Google; solo pasa la ficha.
  const home = sinComentarios(leer("app/page.tsx"));
  assert.ok(home.includes("<ResenasGoogle fichaUrl={fichaConfigurada()} />"));
  assert.ok(!/resenasPublicas|diagnosticarResenas|ReviewsCarousel|await\s+\w*[Rr]esen/.test(home), "la Home no trae reseñas al renderizar");
  const seccion = leer("components/ResenasGoogle.tsx");
  assert.ok(/^"use client"/.test(seccion) && seccion.includes('fetch("/api/resenas", { cache: "no-store"'), "las pide el navegador, sin caché");
  assert.ok(seccion.includes("IntersectionObserver") && seccion.includes("ESPERA_MAXIMA_MS = 12_000"), "carga al llegar a la sección y con tope");
  assert.ok(seccion.includes("<noscript>"), "sin JavaScript: el enlace, no un esqueleto");
  assert.ok(seccion.includes("Mostramos solo reseñas de 5 estrellas"), "aviso de cómo se filtran");
  assert.ok(seccion.includes("<AtribucionGoogleMaps />"));
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
  console.log("OK — Reseñas de Google (simuladas): normalización y atribuciones, errores con motivo (incluido el REQUEST_DENIED que antes se tragaba), respaldo legacy solo con la API nueva deshabilitada, sin key, sin 5★, timeout, la key nunca en logs ni respuestas; sin caché en consulta, proceso y respuesta; /api/resenas con límites y sin parámetros; la Home sin reseñas en su HTML.");
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
