// Sesión COMERCIAL del CRM B2B (Bloque 0) — lógica pura, sin base de datos.
//
// Separada de la sesión del panel (lib/adminSession.ts) en todo:
//   · otra cookie (sim-crm-session) con Path=/comercial: el navegador no la
//     manda a /admin ni a /api/admin;
//   · otra clave (CRM_SESSION_SECRET), que además tiene que ser distinta de
//     ADMIN_SESSION_SECRET;
//   · otro formato: "crm1.<payload>.<firma>", con tipo "crm_comercial" dentro del
//     payload firmado y un prefijo de dominio en lo que se firma. Un token del
//     panel no es un token comercial ni al revés (verifySessionToken exige
//     role admin|staff y este payload no lo tiene).
//
// El token solo dice QUIÉN y CON QUÉ VERSIÓN; si sigue valiendo lo decide la base
// en cada petición (usuario activo y sesion_version vigente): lib/crmAuth.ts.
// Sin clave válida falla cerrado: no se emite ni se acepta ninguna sesión.

import { createHmac, timingSafeEqual } from "node:crypto";

export const CRM_COOKIE = "sim-crm-session";
/** Las páginas (/comercial/...) y las APIs comerciales (/comercial/api/...) viven acá. */
export const CRM_COOKIE_PATH = "/comercial";
export const CRM_SESION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const CRM_SECRETO_MIN = 32;

const PREFIJO = "crm1";
const TIPO = "crm_comercial";
const DOMINIO = "sim-crm-sesion-comercial-v1";
const TOLERANCIA_RELOJ_MS = 60_000;
const TOKEN_MAX = 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export type SesionComercial = { uid: string; sv: number; iat: number; exp: number };

/** La clave, o null si falta, es corta o es la misma del panel. Se lee en cada uso. */
function secreto(): string | null {
  const s = process.env.CRM_SESSION_SECRET ?? "";
  if (s.length < CRM_SECRETO_MIN) return null;
  const panel = process.env.ADMIN_SESSION_SECRET ?? "";
  if (panel && s === panel) return null;
  return s;
}

export function sesionComercialConfigurada(): boolean {
  return secreto() !== null;
}

function firmar(clave: string, payload: string): string {
  return createHmac("sha256", clave).update(`${DOMINIO}.${payload}`).digest("base64url");
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Firma una sesión. Lanza si la clave no está configurada (nunca firma con una vacía). */
export function crearTokenComercial(uid: string, sv: number, ahora: number = Date.now()): string {
  const clave = secreto();
  if (!clave) throw new Error("CRM_SESSION_SECRET no configurado");
  if (!UUID_RE.test(uid) || !Number.isInteger(sv) || sv < 1) throw new Error("sesión comercial inválida");
  const payload = Buffer.from(JSON.stringify({ t: TIPO, uid, sv, iat: ahora, exp: ahora + CRM_SESION_MAX_MS })).toString("base64url");
  return `${PREFIJO}.${payload}.${firmar(clave, payload)}`;
}

/** Firma, tipo, identidad, versión y vencimiento. null ante cualquier duda. */
export function verificarTokenComercial(token: string | null | undefined, ahora: number = Date.now()): SesionComercial | null {
  const clave = secreto();
  if (!clave || typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX) return null;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== PREFIJO) return null;
  const [, payload, firma] = partes;
  if (!B64URL_RE.test(payload) || !B64URL_RE.test(firma)) return null;
  if (!iguales(firma, firmar(clave, payload))) return null;
  let datos: unknown;
  try {
    datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const d = (datos && typeof datos === "object" ? datos : {}) as Record<string, unknown>;
  if (d.t !== TIPO) return null;
  if (typeof d.uid !== "string" || !UUID_RE.test(d.uid)) return null;
  if (typeof d.sv !== "number" || !Number.isInteger(d.sv) || d.sv < 1 || d.sv > 2_147_483_647) return null;
  if (typeof d.iat !== "number" || !Number.isInteger(d.iat) || typeof d.exp !== "number" || !Number.isInteger(d.exp)) return null;
  if (d.exp <= ahora) return null;
  if (d.iat > ahora + TOLERANCIA_RELOJ_MS) return null;
  if (d.exp - d.iat > CRM_SESION_MAX_MS) return null;
  return { uid: d.uid, sv: d.sv, iat: d.iat, exp: d.exp };
}

/** HttpOnly, Secure en producción, SameSite=strict y Path=/comercial. */
export function opcionesCookieComercial(): {
  httpOnly: true; secure: boolean; sameSite: "strict"; path: string; maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: CRM_COOKIE_PATH,
    maxAge: CRM_SESION_MAX_MS / 1000,
  };
}

/** Misma cookie vencida: borra la sesión del navegador (mismo Path, si no, no la pisa). */
export function opcionesCookieComercialBorrar() {
  return { ...opcionesCookieComercial(), maxAge: 0 };
}
