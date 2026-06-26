import { NextResponse } from "next/server";

// Validación de Origin/Referer para endpoints MUTANTES PÚBLICOS llamados desde el
// browser. Defensa en profundidad contra CSRF / abuso cross-origin. NO reemplaza
// el rate limit ni la validación server-side: es una capa extra.
//
// Política (conservadora, para no romper flujos legítimos):
//  - Si la request trae Origin (o Referer) y NO es nuestro dominio → se rechaza.
//  - Si NO trae Origin ni Referer → se permite (server-to-server / webhooks, que
//    se validan por firma aparte). Por eso este check NO se usa en los webhooks.
//  - Same-origin (Origin host === host de la request) se permite: cubre los
//    preview deployments de Vercel y localhost en dev.

const CANONICAL_ORIGINS = [
  "https://simexperience.com.ar",
  "https://www.simexperience.com.ar",
];

function originPermitido(origin: string, req: Request): boolean {
  if (CANONICAL_ORIGINS.includes(origin)) return true;
  try {
    const host = req.headers.get("host");
    if (host && new URL(origin).host === host) return true;
  } catch {
    /* origin malformado → no permitido */
  }
  return false;
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return originPermitido(origin, req);

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return originPermitido(new URL(referer).origin, req);
    } catch {
      return false;
    }
  }

  // Sin Origin ni Referer: server-to-server (no navegador). Se permite; los
  // flujos sensibles server-to-server (webhooks MP) validan firma por separado.
  return true;
}

// Respuesta 403 genérica (sin detalles internos).
export function forbiddenOrigin(): NextResponse {
  return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
}
