import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const role = request.cookies.get("sim-admin-role")?.value;

  const pathname = request.nextUrl.pathname;

  // Permitir login
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  // Proteger rutas admin
  if (pathname.startsWith("/admin")) {
    // Sin login
    if (!role) {
      return NextResponse.redirect(
        new URL("/admin/login", request.url)
      );
    }

    // Staff NO puede entrar al admin principal
    if (
      role === "staff" &&
      pathname === "/admin"
    ) {
      return NextResponse.redirect(
        new URL("/admin/calendario", request.url)
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};