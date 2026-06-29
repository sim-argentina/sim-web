import type { NextConfig } from "next";

// Cabeceras de seguridad aplicadas a todas las respuestas.
// CSP: las MISMAS directivas en ambos modos. ENFORCE solo en preview
// (VERCEL_ENV=preview) o si CSP_MODE=enforce explícito; PRODUCCIÓN queda en
// Report-Only por defecto (no bloquea nada) salvo CSP_MODE=enforce con
// confirmación manual. Así se prueba enforce sin tocar producción.
// Vercel Live / Toolbar (feedback) se inyecta SOLO en previews. Se permiten sus
// dominios (vercel.live + Pusher para realtime) SOLO cuando VERCEL_ENV=preview;
// NUNCA en producción (ahí el toolbar no existe), para no debilitar la CSP de prod.
const isPreview = process.env.VERCEL_ENV === "preview";
const live = (domains: string) => (isPreview ? " " + domains : "");

const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Next inyecta estilos inline; los previews de imágenes usan data:/blob:.
  `img-src 'self' data: blob: https://*.supabase.co https://*.mlstatic.com${live("https://vercel.live https://vercel.com")}`,
  "media-src 'self' blob: https://*.supabase.co",
  `style-src 'self' 'unsafe-inline'${live("https://vercel.live")}`,
  // 'unsafe-eval' lo requiere el runtime de Next en algunos navegadores.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com${live("https://vercel.live")}`,
  `connect-src 'self' https://*.supabase.co https://api.mercadopago.com https://*.mercadopago.com${live("https://vercel.live wss://ws-us3.pusher.com")}`,
  `frame-src https://*.mercadopago.com https://*.mercadolibre.com${live("https://vercel.live")}`,
  "form-action 'self' https://*.mercadopago.com https://*.mercadolibre.com",
  // font-src solo en preview (fuentes del toolbar de Vercel); prod usa system fonts.
  ...(isPreview
    ? ["font-src 'self' https://vercel.live https://assets.vercel.com"]
    : []),
].join("; ");

// enforce ⇔ CSP_MODE=enforce, o (sin CSP_MODE=report-only) cuando VERCEL_ENV es
// "preview". En producción (VERCEL_ENV=production) y en dev queda Report-Only.
const cspEnforce =
  process.env.CSP_MODE === "enforce" ||
  (process.env.CSP_MODE !== "report-only" &&
    process.env.VERCEL_ENV === "preview");
const cspHeaderKey = cspEnforce
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: cspHeaderKey, value: cspDirectives },
];

// Endpoints autenticados (fuera de /api/admin/*) que devuelven PII o datos
// internos → nunca cachear. NO incluye /api/campeonatos/public (cache
// intencional s-maxage) ni otros endpoints públicos cacheables.
const NO_STORE_HEADER = { key: "Cache-Control", value: "no-store, max-age=0" };
const SENSITIVE_API_SOURCES = [
  "/api/admin/:path*",
  "/api/clientes",
  "/api/promociones/:path*",
  "/api/codigos-descuento/:path*",
  "/api/campeonatos/pilotos",
  "/api/turnos-historicos",
  "/api/turnos-stand/:path*",
  "/api/reservas/:path*",
];

const nextConfig: NextConfig = {
  images: {
    // Next 16 exige declarar las calidades permitidas para next/image.
    // 90 para fotos de producto HD (Simulador F1 en la tienda); 75 es el default
    // que usan el resto de las imágenes.
    qualities: [75, 90],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      ...SENSITIVE_API_SOURCES.map((source) => ({
        source,
        headers: [NO_STORE_HEADER],
      })),
    ];
  },
};

export default nextConfig;
