import { strict as assert } from "node:assert";
import { createHash } from "crypto";
import {
  huellaCodigo, claveLimiteCodigo, LIMITE_POR_CODIGO, VENTANA_POR_CODIGO_MS,
} from "@/lib/mensualidadHuella";

// Test PURO de la huella de códigos (Ajuste M4). Sin DB, sin red.
// Ejecutar: npx tsx lib/mensualidadHuella.test.ts

const env = process.env as Record<string, string | undefined>;
const CODIGO = "MEN-AB23-CD45";
const OTRO = "MEN-AB23-CD46";

function main() {
  const adminPrevio = env.ADMIN_SESSION_SECRET;
  const propioPrevio = env.MENSUALIDADES_HUELLA_SECRET;
  env.MENSUALIDADES_HUELLA_SECRET = "secreto-de-prueba-1";

  // 1 · Estable: el mismo código da siempre la misma huella. Si no, el límite
  // por código no contaría nada.
  const h = huellaCodigo(CODIGO);
  assert.equal(huellaCodigo(CODIGO), h);

  // 2 · Distingue códigos, incluso vecinos por un carácter.
  assert.notEqual(h, huellaCodigo(OTRO));

  // 3 · Forma: 128 bits en hexadecimal.
  assert.match(h, /^[0-9a-f]{32}$/);

  // 4 · No filtra el código ni ningún fragmento suyo, ni en la huella ni en la
  // clave que termina escrita en el store del rate limit.
  const PREFIJO = "mens-sesion-cod:";
  const clave = claveLimiteCodigo(CODIGO);
  assert.ok(clave.startsWith(PREFIJO), "la clave lleva su propio namespace");
  assert.equal(clave, `${PREFIJO}${h}`);
  // Se revisa lo que la clave aporta ADEMÁS del namespace fijo.
  const cuerpo = clave.slice(PREFIJO.length);
  for (const trozo of ["MEN", "AB23", "CD45", "AB23CD45", CODIGO]) {
    for (const [donde, txt] of [["la huella", h], ["la clave", cuerpo]] as const) {
      assert.ok(!txt.includes(trozo) && !txt.includes(trozo.toLowerCase()),
        `${donde} no puede contener "${trozo}"`);
    }
  }

  // 5 · Es HMAC, no un SHA-256 pelado: el código es MEN-XXXX-XXXX sobre 32
  // caracteres, así que un digest sin clave se recorre entero desde afuera.
  const pelado = createHash("sha256").update(CODIGO).digest("hex").slice(0, 32);
  const conEtiqueta = createHash("sha256")
    .update(`sim.mensualidades.huella.v1:${CODIGO}`).digest("hex").slice(0, 32);
  assert.notEqual(h, pelado, "la huella no puede ser un sha256 del código");
  assert.notEqual(h, conEtiqueta, "tampoco un sha256 con la etiqueta: hace falta el secreto");

  // 6 · El secreto entra de verdad: cambiarlo cambia la huella, y volver atrás
  // la recupera (o sea, es determinista por secreto, no por proceso).
  env.MENSUALIDADES_HUELLA_SECRET = "secreto-de-prueba-2";
  assert.notEqual(huellaCodigo(CODIGO), h, "otro secreto → otra huella");
  env.MENSUALIDADES_HUELLA_SECRET = "secreto-de-prueba-1";
  assert.equal(huellaCodigo(CODIGO), h, "el mismo secreto → la misma huella");

  // 7 · Sin ningún secreto configurado la huella SIGUE siendo no reversible
  // (clave aleatoria por instancia) y no degrada a un digest sin clave.
  delete env.MENSUALIDADES_HUELLA_SECRET;
  delete env.ADMIN_SESSION_SECRET;
  const sinSecreto = huellaCodigo(CODIGO);
  assert.match(sinSecreto, /^[0-9a-f]{32}$/);
  assert.notEqual(sinSecreto, pelado, "sin secreto tampoco puede degradar a sha256 del código");
  assert.notEqual(sinSecreto, conEtiqueta);
  assert.equal(sinSecreto, huellaCodigo(CODIGO), "y es estable dentro de la instancia");

  // 8 · Prioridad de secretos: propio > admin > clave de instancia.
  env.ADMIN_SESSION_SECRET = "admin-de-prueba";
  const conAdmin = huellaCodigo(CODIGO);
  assert.notEqual(conAdmin, sinSecreto, "con ADMIN_SESSION_SECRET usa ese");
  env.MENSUALIDADES_HUELLA_SECRET = "propio";
  assert.notEqual(huellaCodigo(CODIGO), conAdmin, "el secreto propio tiene prioridad");

  // 9 · Los límites son los que aplica la ruta de identificación.
  assert.equal(LIMITE_POR_CODIGO, 10);
  assert.equal(VENTANA_POR_CODIGO_MS, 600_000);

  if (adminPrevio !== undefined) env.ADMIN_SESSION_SECRET = adminPrevio;
  else delete env.ADMIN_SESSION_SECRET;
  if (propioPrevio !== undefined) env.MENSUALIDADES_HUELLA_SECRET = propioPrevio;
  else delete env.MENSUALIDADES_HUELLA_SECRET;

  console.log("mensualidadHuella.test.ts OK (9 escenarios)");
}

main();
