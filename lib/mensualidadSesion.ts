import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Sesión pública de Mensualidades (Bloque M4). Sin cuentas ni contraseñas:
// código + teléfono a cambio de un token OPACO en una cookie HttpOnly.
//
// NO reutiliza la sesión de admin (lib/adminSession.ts), que es una cookie
// firmada y stateless con rol: esto es de clientes, es revocable y no lleva
// ningún dato adentro. Tampoco toca las de Reservas, Empresas ni Gift Cards.
//
// La base guarda SOLO el hash SHA-256 del token. Un volcado de la tabla no
// permite hacerse pasar por nadie, porque el token no está ahí.

export const COOKIE_SESION = "sim_mensualidad_session";

// 32 bytes (el mínimo pedido era 24) → 43 caracteres base64url.
const TOKEN_BYTES = 32;
// Duración ABSOLUTA: consultar no renueva la sesión.
export const DURACION_SESION_MS = 30 * 60 * 1000;

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export function nuevoTokenSesion(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// La cookie no lleva el path restringido a /mensualidades porque los endpoints
// viven en /api/mensualidades/* y no comparten prefijo: con un path acotado el
// navegador no la mandaría y la sesión sería inservible.
export function opcionesCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURACION_SESION_MS / 1000,
  };
}

export function opcionesCookieBorrada() {
  return { ...opcionesCookie(), maxAge: 0 };
}

export type SesionValida = {
  sesionId: string;
  mensualidadId: string;
};

// Lee el token del header Cookie del propio Request. Los route handlers usan
// esto en vez de cookies() de next/headers: es igual de correcto, no depende del
// scope de request de Next y deja los endpoints testeables sin levantar el server.
// (Las páginas server sí usan cookies(), que ahí siempre está disponible.)
export function tokenDeRequest(req: Request): string | null {
  const crudo = req.headers.get("cookie");
  if (!crudo) return null;
  for (const parte of crudo.split(";")) {
    const igual = parte.indexOf("=");
    if (igual < 0) continue;
    if (parte.slice(0, igual).trim() !== COOKIE_SESION) continue;
    try {
      return decodeURIComponent(parte.slice(igual + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

// Comparación en tiempo constante de dos hashes hex.
function hashesIguales(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Crea la sesión. Si el navegador venía con una sesión (tokenPrevio), se revoca
// esa y SOLO esa: las de otros dispositivos del mismo titular no se tocan.
export async function crearSesion(
  mensualidadId: string,
  tokenPrevio?: string | null,
): Promise<string | null> {
  if (tokenPrevio && TOKEN_RE.test(tokenPrevio)) {
    await revocarSesion(tokenPrevio);
  }
  const token = nuevoTokenSesion();
  const { error } = await supabaseAdmin.from("mensualidad_sesiones").insert({
    mensualidad_id: mensualidadId,
    token_hash: hashToken(token),
    expira_at: new Date(Date.now() + DURACION_SESION_MS).toISOString(),
  });
  if (error) return null;
  return token;
}

// Devuelve la sesión si el token es válido, no venció y no fue revocada.
// Registra el último uso (observabilidad); NO extiende el vencimiento.
export async function leerSesion(token: string | undefined | null): Promise<SesionValida | null> {
  const t = String(token ?? "");
  if (!TOKEN_RE.test(t)) return null;

  const hash = hashToken(t);
  const { data } = await supabaseAdmin
    .from("mensualidad_sesiones")
    .select("id, mensualidad_id, token_hash, expira_at, revocada_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!data) return null;
  if (!hashesIguales(String(data.token_hash), hash)) return null;
  if (data.revocada_at) return null;
  if (Date.parse(String(data.expira_at)) <= Date.now()) return null;

  await supabaseAdmin
    .from("mensualidad_sesiones")
    .update({ ultimo_uso_at: new Date().toISOString() })
    .eq("id", data.id);

  return { sesionId: String(data.id), mensualidadId: String(data.mensualidad_id) };
}

export async function revocarSesion(token: string | undefined | null): Promise<void> {
  const t = String(token ?? "");
  if (!TOKEN_RE.test(t)) return;
  await supabaseAdmin
    .from("mensualidad_sesiones")
    .update({ revocada_at: new Date().toISOString() })
    .eq("token_hash", hashToken(t))
    .is("revocada_at", null);
}

// Barrido de sesiones caducadas. Se llama de forma oportunista al identificarse;
// no hace falta un cron para algo tan chico.
export async function limpiarSesionesVencidas(): Promise<void> {
  await supabaseAdmin
    .from("mensualidad_sesiones")
    .delete()
    .lt("expira_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
}
