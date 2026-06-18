import { NextResponse } from "next/server";
import {
  createSessionToken,
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTIONS,
  isSessionConfigured,
} from "@/lib/adminSession";
import { rateLimit, clientIp } from "@/lib/rateLimit";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  // Rate limit anti fuerza bruta (por IP).
  if (!rateLimit(`login:${clientIp(req)}`, 8, 60_000)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Esperá un minuto." },
      { status: 429 }
    );
  }

  if (!isSessionConfigured()) {
    return NextResponse.json(
      { error: "Login no configurado: falta ADMIN_SESSION_SECRET" },
      { status: 500 }
    );
  }

  try {
    const { password } = await req.json();

    const adminPassword = process.env.ADMIN_PASSWORD || "";
    const staffPassword = process.env.STAFF_PASSWORD || "";

    // Comparación en tiempo constante sobre digests.
    const pw = await sha256Hex(String(password ?? ""));
    let role: "admin" | "staff" | null = null;
    if (adminPassword && safeEqual(pw, await sha256Hex(adminPassword))) role = "admin";
    else if (staffPassword && safeEqual(pw, await sha256Hex(staffPassword))) role = "staff";

    if (!role) {
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }

    const token = await createSessionToken(role);
    const response = NextResponse.json({ ok: true, role });
    response.cookies.set(ADMIN_COOKIE, token, ADMIN_COOKIE_OPTIONS);
    // Limpieza de cookies del esquema anterior (inseguro).
    response.cookies.set("sim-admin-auth", "", { path: "/", maxAge: 0 });
    response.cookies.set("sim-admin-role", "", { path: "/", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
