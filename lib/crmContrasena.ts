// Contraseñas de los usuarios comerciales (CRM B0) — scrypt de node:crypto, sin
// dependencias. Corre en el runtime Node de las rutas (Vercel: Node 24).
//
// Formato guardado: scrypt$<log2 N>$<r>$<p>$<sal>$<clave>, sal de 16 bytes y clave
// de 32, en base64url sin relleno. Parámetros: N = 2^17, r = 8, p = 1 (128 MiB y
// ~250 ms por verificación en esta máquina; el mínimo que recomienda OWASP para
// scrypt). Los parámetros viajan en el hash: se pueden subir más adelante sin
// invalidar los existentes. El CHECK de crm_usuarios y crm_hash_valido() aceptan
// exactamente este formato (log2 N de 14 a 19, r = 8, p = 1).
//
// La contraseña nunca se guarda, se registra ni se devuelve: solo entra a
// hashContrasena / verificarContrasena. La política (largo, contenido) es pura y
// vive en lib/crmUsuarios.ts, porque también la usa la pantalla.

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const LOG2N = 17;
const R = 8;
const P = 1;
const LARGO_CLAVE = 32;
const LARGO_SAL = 16;
const MAXMEM = 256 * 1024 * 1024;
const HASH_RE = /^scrypt\$(1[4-9])\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

function derivar(contrasena: string, sal: Buffer, log2n: number): Promise<Buffer> {
  const opciones: ScryptOptions = { N: 2 ** log2n, r: R, p: P, maxmem: MAXMEM };
  return new Promise((ok, mal) => {
    scrypt(contrasena.normalize("NFC"), sal, LARGO_CLAVE, opciones, (err, clave) => (err ? mal(err) : ok(clave)));
  });
}

export async function hashContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const clave = await derivar(contrasena, sal, LOG2N);
  return `scrypt$${LOG2N}$${R}$${P}$${sal.toString("base64url")}$${clave.toString("base64url")}`;
}

/** true solo si el hash tiene el formato aceptado y la contraseña coincide. */
export async function verificarContrasena(contrasena: string, hash: string): Promise<boolean> {
  const m = HASH_RE.exec(hash);
  if (!m) return false;
  const esperado = Buffer.from(m[3], "base64url");
  const clave = await derivar(contrasena, Buffer.from(m[2], "base64url"), Number(m[1]));
  return clave.length === esperado.length && timingSafeEqual(clave, esperado);
}

export function hashConFormatoValido(hash: unknown): boolean {
  return typeof hash === "string" && HASH_RE.test(hash);
}

// Hash de una contraseña al azar que nadie conoce. Cuando el usuario no existe,
// el ingreso verifica contra este hash: cuesta lo mismo que una verificación real
// y la respuesta no revela si el usuario existe.
let simulado: Promise<string> | null = null;
export function hashSimulado(): Promise<string> {
  if (!simulado) simulado = hashContrasena(randomBytes(32).toString("base64url"));
  return simulado;
}
