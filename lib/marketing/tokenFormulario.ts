// ============================================================================
// Marketing · token del formulario de aceptación. SOLO SERVIDOR (node:crypto).
// ----------------------------------------------------------------------------
// Cuando el servidor entrega el texto vigente (/api/promos/texto), firma el
// momento exacto y la versión mostrada. Ese momento viaja de vuelta con el alta
// y la base lo usa como fecha de origen del consentimiento (solicitado_en):
//   · una baja hecha DESPUÉS de mostrar el texto siempre gana (el alta se
//     rechaza y hay que volver a leer y confirmar: autorización nueva);
//   · un formulario viejo o reenviado no se puede "rejuvenecer" desde el
//     navegador: la fecha está firmada.
// Clave derivada de ADMIN_SESSION_SECRET con contexto propio (como
// lib/reservaPostpay.ts). Sin secreto, no hay token y las altas se cierran.
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

const CONTEXTO = "sim:marketing-formulario:v1";
/** Cuánto vale un formulario abierto. La base acepta hasta 3 h: margen para el reloj. */
export const VIGENCIA_TOKEN_MS = 2 * 60 * 60 * 1000;
const MARGEN_FUTURO_MS = 2 * 60 * 1000;

type Entorno = Record<string, string | undefined>;

function clave(entorno: Entorno): Buffer | null {
  const secreto = entorno.ADMIN_SESSION_SECRET;
  return secreto ? createHmac("sha256", secreto).update(CONTEXTO).digest() : null;
}

function firma(k: Buffer, ms: number, version: string): string {
  return createHmac("sha256", k).update(`${ms}|${version}`).digest("base64url").slice(0, 32);
}

export function emitirTokenFormulario(version: string, ahora: Date, entorno: Entorno = process.env): string | null {
  const k = clave(entorno);
  if (!k) return null;
  const ms = ahora.getTime();
  return `${ms.toString(36)}.${firma(k, ms, version)}`;
}

export type TokenVerificado =
  | { ok: true; emitidoEn: Date }
  | { ok: false; motivo: "formulario_vencido" | "token_invalido" | "sin_secreto" };

export function verificarTokenFormulario(token: unknown, version: string, ahora: Date, entorno: Entorno = process.env): TokenVerificado {
  const k = clave(entorno);
  if (!k) return { ok: false, motivo: "sin_secreto" };
  if (typeof token !== "string" || !/^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{32}$/.test(token)) return { ok: false, motivo: "token_invalido" };
  const [base36, recibida] = token.split(".");
  const ms = parseInt(base36, 36);
  if (!Number.isSafeInteger(ms)) return { ok: false, motivo: "token_invalido" };
  const esperada = Buffer.from(firma(k, ms, version));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return { ok: false, motivo: "token_invalido" };
  const edad = ahora.getTime() - ms;
  if (edad < -MARGEN_FUTURO_MS) return { ok: false, motivo: "token_invalido" };
  if (edad > VIGENCIA_TOKEN_MS) return { ok: false, motivo: "formulario_vencido" };
  return { ok: true, emitidoEn: new Date(ms) };
}
