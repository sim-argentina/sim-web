import { createHash, timingSafeEqual } from "node:crypto";

// Hash del paquete de jornada.
//
// ── La regla que evita el error clásico ─────────────────────────────────────────
// El hash se calcula SIEMPRE sobre los BYTES CRUDOS que llegaron por la red, nunca
// sobre un JSON re-serializado. Parsear y volver a serializar cambia espacios,
// orden de claves y escapes, y produce un hash distinto al que calculó la terminal
// — con el agravante de que el error aparecería recién en producción, con una
// jornada real que no se puede volver a generar.
//
// Por eso el route handler lee el cuerpo como texto UNA vez, hashea ESE texto, y
// recién después lo parsea para validarlo.
//
// Algoritmo (definido una sola vez, acá): SHA-256 sobre los bytes UTF-8, en
// hexadecimal MINÚSCULA. Es exactamente lo que hace SIM Control
// (`DayPackageBuilder.ComputeSha256`).

/** SHA-256 hex minúscula de un texto UTF-8. */
export function sha256Hex(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** SHA-256 hex minúscula de bytes ya leídos. */
export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** ¿Tiene forma de SHA-256 hex minúscula? */
export function esHashValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^[0-9a-f]{64}$/.test(valor);
}

/**
 * Compara dos hashes en tiempo constante.
 *
 * Un hash de payload no es un secreto, pero la misma función se usa para comparar
 * credenciales, y tener dos caminos —uno seguro y otro no— es cómo se cuela una
 * comparación insegura donde importa. Uno solo, y seguro.
 */
export function hashesIguales(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a.toLowerCase(), "utf8");
  const bufB = Buffer.from(b.toLowerCase(), "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
