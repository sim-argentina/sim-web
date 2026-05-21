import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const logged = request.cookies.get("sim-admin-auth")?.value;
  const role = request.cookies.get("sim-admin-role")?.value;

  // Dejar pasar siempre el login
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  // Si no está logueado y quiere entrar al admin, mandarlo al login
  if (!logged && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Redirección según rol cuando entra a /admin
  if (pathname === "/admin") {
    if (role === "staff") {
      return NextResponse.redirect(new URL("/admin/calendario", request.url));
    }

    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin/metricas", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};