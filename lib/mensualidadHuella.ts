import { createHmac, randomBytes } from "crypto";

// Huella NO REVERSIBLE de un código de mensualidad (Ajuste M4, verificado en M6).
//
// Sirve para poder limitar los intentos de identificación POR CÓDIGO sin que el
// código llegue nunca al store del rate limit (Upstash), a los logs ni a ningún
// lado fuera del proceso.
//
// Un SHA-256 pelado NO alcanzaría: el código es MEN-XXXX-XXXX sobre un alfabeto
// de 32 caracteres, así que quien viera el store podría recorrer el espacio y
// recuperar el código. Va HMAC con un secreto del servidor: sin ese secreto la
// huella no se puede recomputar desde afuera.
//
// Módulo puro: sin DB, sin red, sin PII. Nunca devuelve ni registra el código.

const ETIQUETA = "sim.mensualidades.huella.v1";

let claveDeInstancia: string | null = null;
let avisado = false;

function secreto(): string {
  const configurado =
    process.env.MENSUALIDADES_HUELLA_SECRET || process.env.ADMIN_SESSION_SECRET || "";
  if (configurado) return configurado;

  // Sin secreto configurado la huella TIENE que seguir siendo no reversible, así
  // que se usa una clave aleatoria. Es por instancia: alcanza en desarrollo —
  // donde el rate limit ya es en memoria— pero en producción haría que el límite
  // por código dejara de ser global, así que se avisa fuerte una sola vez.
  if (!claveDeInstancia) claveDeInstancia = randomBytes(32).toString("hex");
  if (process.env.NODE_ENV === "production" && !avisado) {
    avisado = true;
    console.warn(
      "[mensualidades] Falta MENSUALIDADES_HUELLA_SECRET (o ADMIN_SESSION_SECRET): " +
        "la huella del código usa una clave por instancia y el límite por código deja de ser global."
    );
  }
  return claveDeInstancia;
}

/**
 * Huella estable de un código YA normalizado. 128 bits en hexadecimal: de sobra
 * para que no haya colisiones entre códigos y corta para no inflar la clave.
 */
export function huellaCodigo(codigo: string): string {
  return createHmac("sha256", secreto())
    .update(`${ETIQUETA}:${codigo}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** Clave de rate limit por código. El código no aparece en ninguna parte. */
export function claveLimiteCodigo(codigo: string): string {
  return `mens-sesion-cod:${huellaCodigo(codigo)}`;
}

/** Intentos de identificación permitidos para un mismo código. */
export const LIMITE_POR_CODIGO = 10;
export const VENTANA_POR_CODIGO_MS = 10 * 60_000;
