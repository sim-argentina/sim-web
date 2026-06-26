import type { NextConfig } from "next";

// Cabeceras de seguridad aplicadas a todas las respuestas.
// La CSP se entrega en modo Report-Only para no romper producción: el browser
// reporta violaciones pero no bloquea. Una vez verificado que no hay reportes
// legítimos, se puede migrar la clave a "Content-Security-Policy" (enforce).
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Next inyecta estilos inline; los previews de imágenes usan data:/blob:.
  "img-src 'self' data: blob: https://*.supabase.co https://*.mlstatic.com",
  "media-src 'self' blob: https://*.supabase.co",
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-eval' lo requiere el runtime de Next en algunos navegadores.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com",
  "connect-src 'self' https://*.supabase.co https://api.mercadopago.com https://*.mercadopago.com",
  "frame-src https://*.mercadopago.com https://*.mercadolibre.com",
  "form-action 'self' https://*.mercadopago.com https://*.mercadolibre.com",
].join("; ");

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
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
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
      {
        // Respuestas del admin: nunca cachear (datos sensibles/PII).
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
