// Corre las suites de IA SIM que dependen del historial, contra la base LOCAL y sobre el
// escenario histórico SINTÉTICO de agosto y septiembre de 2026.
//
//   npm run pruebas:ia-historico              # todo: reset, esquema, escenario, contrato, suites, limpieza
//   npm run pruebas:ia-historico -- --sin-reset   # reusa la base como está (más rápido)
//   npm run pruebas:ia-historico -- --dejar       # no limpia el escenario al final
//
// Pasos, en este orden:
//   1. comprobar que el destino es loopback y que el stack local responde;
//   2. vaciar la base local;
//   3. aplicar el esquema completo;
//   4. cargar la configuración mínima sintética (la que trae el propio esquema);
//   5. cargar el escenario histórico;
//   6. validar sus invariantes numéricos contra el motor real — si falla, las suites NO empiezan;
//   7. correr las cinco suites, en serie;
//   8. informar el resultado de cada una;
//   9. limpiar el escenario, incluso si una suite falló.
//
// El guardián de lib/guardiaPruebas.ts sigue siendo la barrera principal: el paso 9 es
// higiene, no seguridad.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { entornoDePruebas, abortar } from "./entorno.mjs";

const RAIZ = process.cwd();
const CONTENEDOR_DB = "supabase_db_sim-web-pruebas";
const FIXTURE = "db/fixtures-ia-historico.sql";
const CONTRATO = "scripts/pruebas/contrato-historico-ia.ts";
const TIMEOUT_SUITE_MS = 7 * 60 * 1000;

// Las cinco suites que dependían del historial real.
const SUITES = [
  "lib/ia/analisis/servidor5a.integration.ts",
  "lib/ia/analisis/servidor5b.integration.ts",
  "lib/ia/analisis/servidor5b1.integration.ts",
  "lib/ia/plan/servidor5c.integration.ts",
  "lib/ia/creditos/saldo.integration.ts",
];

const banderas = process.argv.slice(2);
const sinReset = banderas.includes("--sin-reset");
const dejar = banderas.includes("--dejar");

const paso = (n, texto) => console.log(`\n── ${n}. ${texto} ${"─".repeat(Math.max(0, 62 - texto.length))}`);

// ── 1. Destino y stack ─────────────────────────────────────────────────────
paso(1, "Destino de pruebas y stack local");
const e = entornoDePruebas(RAIZ);
if (!e.ok) abortar(e);
console.log(`   destino ${e.url}  ·  corrida ${e.runId}`);

function psql(sql) {
  try {
    return { ok: true, out: execFileSync("docker", ["exec", "-i", CONTENEDOR_DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() };
  } catch (err) { return { ok: false, out: String(err.stderr ?? err.stdout ?? err.message) }; }
}
function psqlArchivo(ruta) {
  try {
    execFileSync("docker", ["exec", "-i", CONTENEDOR_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
      { input: readFileSync(resolve(RAIZ, ruta), "utf8"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, out: "" };
  } catch (err) { return { ok: false, out: String(err.stderr ?? err.stdout ?? err.message) }; }
}

if (!psql("select 1").ok) {
  console.error(`\nEl contenedor ${CONTENEDOR_DB} no responde.\nCorré:  npm run pruebas:iniciar\n`);
  process.exit(78);
}
if (!existsSync(resolve(RAIZ, FIXTURE))) {
  console.error(`\nFalta ${FIXTURE}.\nGeneralo con:  node scripts/pruebas/generar-historico-ia.mjs\n`);
  process.exit(78);
}
console.log("   stack local arriba");

// ── 2, 3, 4. Base limpia con el esquema y la configuración ─────────────────
if (sinReset) {
  paso("2, 3 y 4", "Reset, esquema y configuración — OMITIDOS (--sin-reset)");
} else {
  paso("2, 3 y 4", "Vaciar la base local, aplicar el esquema y la configuración mínima");
  const r = spawnSync("node", ["scripts/pruebas/aplicar-esquema.mjs", "--reset"], { stdio: "inherit", env: e.env });
  if (r.status !== 0) { console.error("\nNo se pudo reconstruir la base local.\n"); process.exit(1); }
}
const tablas = Number(psql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'").out || 0);
if (tablas < 100) {
  console.error(`\nLa base local tiene ${tablas} tablas: falta el esquema.\nCorré:  npm run pruebas:esquema\n`);
  process.exit(78);
}
console.log(`   ${tablas} tablas en public`);

// ── 5. Escenario histórico ─────────────────────────────────────────────────
paso(5, "Cargar el escenario histórico sintético");
const carga = psqlArchivo(FIXTURE);
if (!carga.ok) {
  console.error(`\nNo se pudo cargar ${FIXTURE}:\n${carga.out}\n`);
  process.exit(1);
}
const censo = psql(`select
  (select count(*) from turnos_stand) || ' turnos del stand, ' ||
  (select count(*) from reservas) || ' reservas, ' ||
  (select count(*) from campeonato_inscripciones) || ' inscripciones, ' ||
  (select count(*) from fin_movimientos) || ' movimientos, ' ||
  (select count(*) from cronograma_jornadas) || ' jornadas'`);
console.log(`   ${censo.out}`);

// ── 6. Contrato del escenario ──────────────────────────────────────────────
paso(6, "Validar los invariantes del escenario contra el motor real");
const contrato = spawnSync("npx", ["tsx", "--env-file=.env.test.local", CONTRATO], {
  stdio: "inherit", env: { ...e.env, IA_PROVIDER: "fake" }, shell: process.platform === "win32",
});
if (contrato.status !== 0) {
  console.error("\nEl escenario no cumple su contrato numérico: las suites NO se corren.");
  console.error("Regeneralo con:  node scripts/pruebas/generar-historico-ia.mjs\n");
  limpiar();
  process.exit(1);
}

// ── 7, 8. Las cinco suites ─────────────────────────────────────────────────
paso(7, "Correr las cinco suites, en serie");
const resultados = [];
for (const [i, f] of SUITES.entries()) {
  process.stdout.write(`   [${i + 1}/${SUITES.length}] ${f} … `);
  const t0 = Date.now();
  const r = spawnSync("npx", ["tsx", "--env-file=.env.test.local", f], {
    env: { ...e.env, IA_PROVIDER: "fake", SIM_TEST_SUITE: f },
    encoding: "utf8", timeout: TIMEOUT_SUITE_MS, shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const bloqueada = r.status === 78 || /GUARDIA DE BASE DE PRUEBAS/.test(salida);
  const estado = bloqueada ? "BLOQUEADA" : r.status === 0 ? "OK" : r.signal === "SIGTERM" || r.error?.code === "ETIMEDOUT" ? "TIMEOUT" : "FALLA";
  console.log(`${estado} (${(ms / 1000).toFixed(0)}s)`);
  resultados.push({ suite: f, estado, ms, salida: estado === "OK" ? "" : salida.slice(-4000) });
}

paso(8, "Resultado");
for (const r of resultados) console.log(`   ${r.estado.padEnd(9)} ${r.suite}`);
const noPasaron = resultados.filter((r) => r.estado !== "OK");
console.log(`\n   ${resultados.length - noPasaron.length}/${resultados.length} en verde`);
for (const r of noPasaron) console.log(`\n##### ${r.suite} — ${r.estado}\n${r.salida}`);

// ── 9. Limpieza ────────────────────────────────────────────────────────────
function limpiar() {
  if (dejar) { console.log("\n── 9. Limpieza — OMITIDA (--dejar). El escenario queda cargado."); return; }
  paso(9, "Limpiar el escenario");
  // El propio fixture arranca borrando su familia: se reusa ese bloque, cortado antes del
  // primer insert. Así la limpieza no puede divergir de lo que el escenario crea.
  // El `commit;` se agrega acá: el corte se queda del lado del `begin;` del fixture y, sin
  // cerrar la transacción, psql la revierte al salir y la limpieza no borra nada.
  const sql = readFileSync(resolve(RAIZ, FIXTURE), "utf8");
  const marca = "-- ── Turnero del stand";
  const corte = sql.indexOf(marca);
  if (corte < 0) { console.error("   no se encontró el bloque de limpieza en el fixture"); return; }
  const borrados = `${sql.slice(0, corte)}\ncommit;\n`;
  try {
    execFileSync("docker", ["exec", "-i", CONTENEDOR_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
      { input: borrados, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    console.error(`   no se pudo limpiar: ${String(err.stderr ?? err.message).slice(0, 300)}`);
    return;
  }
  // Y se COMPRUEBA: una limpieza que no borró nada no puede informar que sí.
  const quedan = Number(psql("select (select count(*) from turnos_stand) + (select count(*) from reservas) + (select count(*) from campeonato_inscripciones) + (select count(*) from cronograma_meses)").out || 0);
  if (quedan === 0) console.log("   escenario borrado; 0 filas de negocio en la base local");
  else console.error(`   LA LIMPIEZA NO DEJÓ LA BASE VACÍA: quedan ${quedan} filas de negocio. Corré npm run pruebas:reset.`);
}
limpiar();

process.exit(noPasaron.length ? 1 : 0);
