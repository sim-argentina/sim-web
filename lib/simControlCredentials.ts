import { createHash, randomBytes } from "node:crypto";
import { hashesIguales } from "@/lib/simControlHash";

// Credencial de una terminal de SIM Control.
//
// ── Qué NO es ──────────────────────────────────────────────────────────────────
// No es la service_role de Supabase, ni la anon key, ni la contraseña de OWNER, ni
// el PIN de un operador, ni una credencial compartida entre las cuatro PCs. Cada
// terminal tiene la suya, y revocar una no afecta a las demás.
//
// ── Qué es ─────────────────────────────────────────────────────────────────────
// 256 bits de aleatoriedad criptográfica, generados en el servidor y mostrados UNA
// sola vez. De ahí en adelante el servidor guarda únicamente su hash; la terminal
// guarda el token cifrado con DPAPI del usuario de Windows.
//
// El hash es SHA-256 con pepper del servidor. Para una contraseña humana sería
// inaceptable —hay que usar un KDF lento—, pero acá el "secreto" tiene 256 bits de
// entropía real: no existe diccionario ni fuerza bruta contra eso, y un KDF lento
// solo agregaría latencia a cada request de sincronización.
//
// El pepper vive en una variable de entorno del servidor. Si falta, la
// autenticación de terminales queda DESHABILITADA en vez de degradarse a un hash
// sin pepper: preferimos que no ande a que ande de forma más débil de lo que dice.

/** Bytes de aleatoriedad del token. 32 bytes = 256 bits. */
const TOKEN_BYTES = 32;

/** Caracteres del prefijo que sí se guarda en claro para poder identificarlo en el panel. */
const PREFIJO_LARGO = 8;

export type CredencialGenerada = {
  /** El token en claro. Se muestra UNA vez y no se persiste en ningún lado. */
  token: string;
  tokenHash: string;
  tokenPrefix: string;
};

/** Pepper del servidor. Sin esto la autenticación de terminales no funciona, a propósito. */
export function pepperDisponible(): boolean {
  const pepper = process.env.SIM_CONTROL_CREDENTIAL_PEPPER;
  return typeof pepper === "string" && pepper.length >= 32;
}

function pepper(): string {
  const valor = process.env.SIM_CONTROL_CREDENTIAL_PEPPER;
  if (typeof valor !== "string" || valor.length < 32) {
    throw new Error("Falta SIM_CONTROL_CREDENTIAL_PEPPER (mínimo 32 caracteres) en el entorno del servidor.");
  }
  return valor;
}

/**
 * Hash de un token de terminal. Determinístico a propósito: permite buscar la
 * credencial por hash con un índice único, sin recorrer todas las filas.
 */
export function hashearToken(token: string): string {
  return createHash("sha256").update(`${pepper()}:${token}`, "utf8").digest("hex");
}

/**
 * Genera una credencial nueva.
 *
 * `randomBytes` es el CSPRNG del sistema. Nunca `Math.random()`: es predecible y
 * acá una predicción significa que alguien puede subir jornadas falsas.
 */
export function generarCredencial(): CredencialGenerada {
  const token = `sct_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return {
    token,
    tokenHash: hashearToken(token),
    tokenPrefix: token.slice(0, PREFIJO_LARGO),
  };
}

/** ¿Tiene forma de token de terminal? Filtra basura antes de tocar la base. */
export function tokenConFormaValida(token: unknown): token is string {
  return typeof token === "string" && /^sct_[A-Za-z0-9_-]{40,90}$/.test(token);
}

/** Compara el hash de un token recibido contra el guardado, en tiempo constante. */
export function tokenCoincide(tokenRecibido: string, hashGuardado: string): boolean {
  return hashesIguales(hashearToken(tokenRecibido), hashGuardado);
}

/**
 * Extrae el token de un header `Authorization: Bearer <token>`.
 * Devuelve null ante cualquier otra cosa — sin explicar qué estuvo mal.
 */
export function tokenDeAuthorization(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  return match ? match[1] : null;
}
