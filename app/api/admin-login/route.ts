import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();

    const adminPassword = process.env.ADMIN_PASSWORD;
    const staffPassword = process.env.STAFF_PASSWORD;

    if (!password) {
      return NextResponse.json(
        { error: "Contraseña requerida" },
        { status: 400 }
      );
    }

    if (password === adminPassword) {
      const response = NextResponse.json({
        success: true,
        role: "admin",
      });

      response.cookies.set("sim-admin-role", "admin", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });

      return response;
    }

    if (password === staffPassword) {
      const response = NextResponse.json({
        success: true,
        role: "staff",
      });

      response.cookies.set("sim-admin-role", "staff", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });

      return response;
    }

    return NextResponse.json(
      { error: "Contraseña incorrecta" },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}