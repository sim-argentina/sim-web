import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/adminSession";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  const ADMIN_ONLY = ["/admin/codigos"];
  if (
    role !== "admin" &&
    ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.redirect(new URL("/admin/calendario", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
