import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const logged = request.cookies.get("sim-admin-auth")?.value;
  const role = request.cookies.get("sim-admin-role")?.value;

  if (!logged && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

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