// Sesión de admin firmada con HMAC-SHA256 (Web Crypto, sirve en edge y node).
// No incluye next/headers para poder importarse desde el middleware (edge).

export const ADMIN_COOKIE = "sim-admin-session";
export type AdminRole = "admin" | "staff";

const SECRET = process.env.ADMIN_SESSION_SECRET || "";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

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

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toB64Url(new Uint8Array(sig));
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
  const payloadObj = { role, exp: Date.now() + MAX_AGE_MS };
  const payload = toB64Url(enc.encode(JSON.stringify(payloadObj)));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

// Verifica el token y devuelve el rol o null. Nunca confía en el valor crudo.
export async function verifySessionToken(
  token: string | undefined | null
): Promise<AdminRole | null> {
  if (!token || !isSessionConfigured()) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = await hmac(payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(dec.decode(fromB64Url(payload)));
    if (typeof data?.exp !== "number" || Date.now() > data.exp) return null;
    if (data.role !== "admin" && data.role !== "staff") return null;
    return data.role as AdminRole;
  } catch {
    return null;
  }
}

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: MAX_AGE_MS / 1000,
};
