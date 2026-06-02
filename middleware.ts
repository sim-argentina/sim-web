import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const logged = request.cookies.get("sim-admin-auth")?.value;
  const role = request.cookies.get("sim-admin-role")?.value;

  // Dejar pasar login
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  // Si entra a /admin, redirigir según estado
  if (pathname === "/admin") {
    if (!logged) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin/metricas", request.url));
    }

    if (role === "staff") {
      return NextResponse.redirect(new URL("/admin/calendario", request.url));
    }

    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Proteger el resto del admin
  if (pathname.startsWith("/admin") && !logged) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};