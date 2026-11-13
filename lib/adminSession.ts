// Sesión del panel (admin / staff) firmada con HMAC-SHA256 (Web Crypto, sirve en edge y node).
// No incluye next/headers para poder importarse desde el middleware (edge).
//
// v2 (13/11/2026) — la sesión queda ATADA A LA CONTRASEÑA DE SU ROL:
//   clave(rol) = HMAC(ADMIN_SESSION_SECRET, "sim:panel-sesion:v2:<rol>:<sha256(contraseña del rol)>")
//   · Cambiar ADMIN_PASSWORD invalida todas las sesiones admin; cambiar STAFF_PASSWORD, las de
//     staff. No hace falta tocar ADMIN_SESSION_SECRET para cerrar sesiones.
//   · ADMIN_SESSION_SECRET no cambia: los enlaces de comprobante de Reservas post-pago, los tokens
//     de formularios de Marketing y las huellas que lo usan siguen valiendo.
//   · Los tokens v1 (firmados directo con el secreto, sin "v") dejan de valer al publicar esto.
// La contraseña nunca entra en el token: solo su huella participa de la clave de firma.

export const ADMIN_COOKIE = "sim-admin-session";
export type AdminRole = "admin" | "staff";

const SECRET = process.env.ADMIN_SESSION_SECRET || "";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 días
const VERSION = 2;
const CONTEXTO = "sim:panel-sesion:v2";

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacBytes(clave: BufferSource, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", clave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(data));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Se lee en cada llamada (no al cargar el módulo): así un cambio de contraseña rige apenas
// el despliegue nuevo la tiene, también en el middleware.
function contrasenaDe(role: AdminRole): string {
  return (role === "admin" ? process.env.ADMIN_PASSWORD : process.env.STAFF_PASSWORD) || "";
}

// Firma del payload con la clave del rol, o null si ese rol no tiene contraseña configurada
// (sin contraseña no hay sesión posible para ese rol).
async function firmar(role: AdminRole, payload: string): Promise<string | null> {
  const contrasena = contrasenaDe(role);
  if (!contrasena) return null;
  const clave = await hmacBytes(enc.encode(SECRET), `${CONTEXTO}:${role}:${await sha256Hex(contrasena)}`);
  return toB64Url(new Uint8Array(await hmacBytes(clave, payload)));
}

// Comparación en tiempo constante.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isSessionConfigured(): boolean {
  return SECRET.length >= 16;
}

export async function createSessionToken(role: AdminRole): Promise<string> {
  if (!isSessionConfigured()) {
    throw new Error("ADMIN_SESSION_SECRET no configurado");
  }
  const payloadObj = { v: VERSION, role, exp: Date.now() + MAX_AGE_MS };
  const payload = toB64Url(enc.encode(JSON.stringify(payloadObj)));
  const sig = await firmar(role, payload);
  if (!sig) throw new Error(`Falta la contraseña del rol ${role}`);
  return `${payload}.${sig}`;
}

// Verifica el token y devuelve el rol o null. Nunca confía en el valor crudo: el rol del
// payload solo elige con qué clave se verifica, y recién vale si la firma coincide.
export async function verifySessionToken(
  token: string | undefined | null
): Promise<AdminRole | null> {
  if (!token || !isSessionConfigured()) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  let data: { v?: unknown; role?: unknown; exp?: unknown };
  try {
    data = JSON.parse(dec.decode(fromB64Url(payload)));
  } catch {
    return null;
  }
  const role = data?.role;
  if (role !== "admin" && role !== "staff") return null;
  const expected = await firmar(role, payload);
  if (!expected || !timingSafeEqual(sig, expected)) return null;
  if (data.v !== VERSION) return null;
  if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
  return role;
}

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: MAX_AGE_MS / 1000,
};
