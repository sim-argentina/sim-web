// Cupones · retención compartida Reservas / Gift Cards — verificación SQL contra el stack LOCAL.
//
//   node scripts/pruebas/cupones-retencion.mjs
//
// Aplica db/cupones-retencion.sql (idempotente) y corre
// db/cupones-retencion.verificacion.sql, que se deshace entero. Todo por
// psql DENTRO del contenedor local: este proceso no tiene credenciales de ninguna
// base alojada. Sale con 1 si algún caso falla o aborta.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTENEDOR = "supabase_db_sim-web-pruebas";

function psql(archivo) {
  try {
    return { ok: true, salida: execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { input: readFileSync(archivo, "utf8"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const migracion = psql("db/cupones-retencion.sql");
if (!migracion.ok) {
  console.error("No se pudo aplicar db/cupones-retencion.sql en el stack local:\n" + migracion.salida);
  process.exit(1);
}

// La verificación termina SIEMPRE en RAISE: el resultado viene en el error.
const v = psql("db/cupones-retencion.verificacion.sql");
const m = /RESULTADO (CUPONES-RETENCION\|[^\n]*)/.exec(v.salida);
if (!m) {
  console.error("La verificación no devolvió resultado:\n" + v.salida);
  process.exit(1);
}
const casos = m[1].replace("CUPONES-RETENCION|", "").trim();
console.log(`Verificación cupones: ${casos}`);
if (/FALLA:|ABORTO:/.test(casos)) process.exit(1);
console.log("OK — todos los casos pasaron y la transacción se deshizo.");
