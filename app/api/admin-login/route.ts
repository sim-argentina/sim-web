import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();

    const adminPassword = process.env.ADMIN_PASSWORD;
    const staffPassword = process.env.STAFF_PASSWORD;

    let role: "admin" | "staff" | null = null;

    if (password === adminPassword) {
      role = "admin";
    }

    if (password === staffPassword) {
      role = "staff";
    }

    if (!role) {
      return NextResponse.json(
        { error: "Contraseña incorrecta" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      role,
    });

    response.cookies.set("sim-admin-auth", "true", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    response.cookies.set("sim-admin-role", role, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    );
  }
}