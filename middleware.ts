import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/adminSession";
import { esAreaComercial } from "@/lib/areaComercial";

// Área comercial del CRM: acá NO se autoriza nada (lo hacen sus páginas y rutas
// en el servidor). Solo se la aísla de la analítica pública: si el router de Next
// pide una página comercial desde una página que NO es comercial —que pudo haber
// cargado Google Tag Manager—, se responde sin contenido y el router hace una
// navegación de documento completo (Next 16: fetchServerResponse →
// doMpaNavigation), antes de tocar el historial. El documento comercial nace
// limpio, sin GTM.
//   · Next le quita al middleware la cabecera "rsc", pero deja "next-url" (la
//     ruta en la que está el router; falta en refresh y en algunos prefetch) y el
//     navegador manda "sec-fetch-dest" y el Referer completo del mismo origen
//     (Referrer-Policy strict-origin-when-cross-origin, next.config.ts).
//   · Pasan siempre: documentos (entrada directa, recarga, enlace <a>), las APIs
//     de /comercial/api y las peticiones del router hechas DESDE el área.
//   · Si no se puede saber de dónde viene una petición del router, se trata como
//     de afuera: el peor caso es una recarga completa, nunca heredar GTM.
function esDocumento(request: NextRequest): boolean {
  const destino = request.headers.get("sec-fetch-dest");
  if (destino) return destino === "document" || destino === "iframe";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** true: el router está en el área; false: está afuera; null: no se sabe. */
function routerDesdeElArea(request: NextRequest): boolean | null {
  const desde = request.headers.get("next-url");
  if (desde !== null) return esAreaComercial(desde);
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return u.origin === request.nextUrl.origin && esAreaComercial(u.pathname);
  } catch {
    return false;
  }
}

function aislarAreaComercial(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/comercial/api/")) return NextResponse.next();
  if (esDocumento(request)) return NextResponse.next();
  const delArea = routerDesdeElArea(request);
  if (delArea === true) return NextResponse.next();
  if (delArea === null && request.headers.get("sec-fetch-dest") !== "empty") return NextResponse.next();
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (esAreaComercial(pathname)) return aislarAreaComercial(request);

  // Dejar pasar login
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  // Validar sesión firmada (no se confía en el valor crudo de la cookie)
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const role = await verifySessionToken(token);

  // Si entra a /admin, redirigir según estado
  if (pathname === "/admin") {
    if (!role) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin/metricas", request.url));
    }
    return NextResponse.redirect(new URL("/admin/calendario", request.url));
  }

  // Proteger el resto del admin (la autorización real está en cada API route)
  if (pathname.startsWith("/admin") && !role) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Páginas solo-admin: el staff no debe verlas (datos protegidos igual por las
  // APIs con requireAdmin, esto evita mostrar la cáscara y aplica mínimo privilegio).
  const ADMIN_ONLY = ["/admin/codigos", "/admin/bloqueos", "/admin/finanzas", "/admin/colectivo/productos", "/admin/colectivo/categorias-caja", "/admin/interacciones/analisis", "/admin/crm"];
  if (
    role !== "admin" &&
    ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.redirect(new URL("/admin/calendario", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/comercial", "/comercial/:path*"],
};
