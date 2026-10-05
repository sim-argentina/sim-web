// Corre las suites MUTANTES contra el Supabase LOCAL, en serie.
//
//   node scripts/pruebas/correr-mutantes.mjs                 # todas
//   node scripts/pruebas/correr-mutantes.mjs lib/x.integration.ts  # una o varias
//
// Antes de la primera suite:
//   · comprueba que el stack local está arriba y es el esperado (project ref del contenedor);
//   · construye el entorno de pruebas y borra del proceso hijo toda credencial de Producción;
//   · verifica que la base local tiene el esquema aplicado.
//
// En serie a propósito: dos suites en paralelo se pisan los fixtures. Cada suite trae su propio
// identificador de corrida, así que no dependen del orden entre archivos.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, sep, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { entornoDePruebas, abortar } from "./entorno.mjs";

const RAIZ = process.cwd();
const CONTENEDOR_DB = "supabase_db_sim-web-pruebas";
const TIMEOUT_SUITE_MS = 7 * 60 * 1000;

// ── 1. Entorno ─────────────────────────────────────────────────────────────
const e = entornoDePruebas(RAIZ);
if (!e.ok) abortar(e);
console.log(`Destino de pruebas: ${e.url}  ·  corrida ${e.runId}`);

// ── 2. El stack local tiene que estar vivo y ser el de este repositorio ────
function psql(sql) {
  try {
    return { ok: true, out: execFileSync("docker", ["exec", "-i", CONTENEDOR_DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() };
  } catch (err) { return { ok: false, out: String(err.stderr ?? err.stdout ?? err.message) }; }
}
const ping = psql("select 1");
if (!ping.ok) {
  console.error(`\nEl contenedor ${CONTENEDOR_DB} no responde.\nCorré:  npm run pruebas:iniciar\n`);
  process.exit(78);
}
const tablas = psql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
const nTablas = Number(tablas.out || 0);
if (nTablas < 100) {
  console.error(`\nLa base local tiene ${nTablas} tablas: falta el esquema.\nCorré:  npm run pruebas:esquema\n`);
  process.exit(78);
}
console.log(`Stack local verificado: ${nTablas} tablas en public.`);

// ── 2b. El escenario histórico de IA SIM ───────────────────────────────────
// Cinco suites verifican cifras de agosto y septiembre de 2026 (ver
// docs/pruebas-entorno-aislado.md). El escenario es idempotente, trae su propia guardia
// contra bases reales y se midió corriendo las 53 suites con él cargado: el resultado fue
// idéntico al de antes salvo esas cinco, que pasan. No altera Mensualidades, Campeonatos,
// Cronograma ni ningún otro módulo. Con --sin-historico se omite.
const FIXTURE_HIST = "db/fixtures-ia-historico.sql";
if (process.argv.includes("--sin-historico")) {
  console.log("Escenario histórico de IA SIM: OMITIDO (--sin-historico).");
} else if (!existsSync(resolve(RAIZ, FIXTURE_HIST))) {
  console.log(`Escenario histórico de IA SIM: falta ${FIXTURE_HIST} (generalo con npm run pruebas:ia-historico-generar).`);
} else {
  try {
    execFileSync("docker", ["exec", "-i", CONTENEDOR_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
      { input: readFileSync(resolve(RAIZ, FIXTURE_HIST), "utf8"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    console.log("Escenario histórico de IA SIM: cargado.");
  } catch (err) {
    console.error(`
No se pudo cargar ${FIXTURE_HIST}:
${String(err.stderr ?? err.message)}
`);
    process.exit(1);
  }
}

// ── 3. Qué suites correr ───────────────────────────────────────────────────
const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
const RPC_DE_LECTURA = new Set(["fin_ingresos_por_mes", "fin_comisiones_web_por_mes", "fin_eventos_facturacion", "mensualidad_hoy", "mensualidad_normalizar_telefono", "mensualidad_horario_valido", "ia_costo_interno_acumulado", "mensualidad_resumen_altas_mes"]);
const RE_RPC = /\.rpc\s*\(\s*["'`]([a-z0-9_]+)/g;

function walk(d, out = []) {
  for (const it of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, it.name);
    if (it.isDirectory()) walk(p, out);
    else if (/\.(test|integration)\.ts$/.test(it.name)) out.push(p.split(sep).join("/"));
  }
  return out;
}
// Una suite corre acá si ESCRIBE, o si ella misma declara que necesita la base de pruebas
// activando el guardián. Lo segundo cubre las de SOLO LECTURA que igual tienen que correr
// contra la base local: `ejecutorPlan.integration.ts` lee cifras de agosto y septiembre de
// 2026 y las toma del escenario sintético, no de Producción.
// El IMPORT del activador, no una mención: lib/guardiaPruebas.test.ts nombra el archivo
// para inspeccionarlo y es una prueba pura que corre sin ninguna base.
const RE_ACTIVADOR = /^\s*import\s+["'`]@\/lib\/guardiaPruebas\.activar["'`]/m;
function pideBaseDePruebas(s) {
  return RE_ACTIVADOR.test(s);
}
function esMutante(f) {
  const s = readFileSync(f, "utf8");
  if (pideBaseDePruebas(s)) return true;
  if (!/supabaseAdmin|createClient/.test(s)) return false;
  const rpcsMut = [...s.matchAll(RE_RPC)].map((m) => m[1]).filter((n) => !RPC_DE_LECTURA.has(n));
  return ESCRITURA.test(s) || rpcsMut.length > 0 || /from "@\/app\/api/.test(s);
}

const pedidas = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const suites = (pedidas.length ? pedidas : walk("lib").filter(esMutante)).sort();
if (!suites.length) { console.error("No hay suites para correr."); process.exit(1); }
console.log(`Suites mutantes: ${suites.length}\n`);

// ── 4. En serie ────────────────────────────────────────────────────────────
const resultados = [];
for (const [i, f] of suites.entries()) {
  const etiqueta = `[${String(i + 1).padStart(2, "0")}/${suites.length}] ${f}`;
  process.stdout.write(`${etiqueta} … `);
  const t0 = Date.now();
  const r = spawnSync("npx", ["tsx", "--env-file=.env.test.local", f], {
    env: { ...e.env, SIM_TEST_SUITE: f },
    encoding: "utf8", timeout: TIMEOUT_SUITE_MS, shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const bloqueada = r.status === 78 || /GUARDIA DE BASE DE PRUEBAS/.test(salida);
  const estado = bloqueada ? "BLOQUEADA" : r.status === 0 ? "OK" : r.signal === "SIGTERM" || r.error?.code === "ETIMEDOUT" ? "TIMEOUT" : "FALLA";
  console.log(`${estado} (${(ms / 1000).toFixed(0)}s)`);
  resultados.push({ suite: f, estado, ms, salida: estado === "OK" ? "" : salida.slice(-4000) });
}

// ── 5. Resumen ─────────────────────────────────────────────────────────────
const por = (x) => resultados.filter((r) => r.estado === x);
console.log(`\n═══ RESULTADO ═══`);
console.log(`OK        : ${por("OK").length}`);
console.log(`FALLA     : ${por("FALLA").length}`);
console.log(`TIMEOUT   : ${por("TIMEOUT").length}`);
console.log(`BLOQUEADA : ${por("BLOQUEADA").length}  (si no es 0, el guardián rechazó el destino)`);

const detalle = resolve(RAIZ, "..", "pruebas-mutantes-detalle.txt");
const salidaDetalle = resultados.filter((r) => r.estado !== "OK")
  .map((r) => `##### ${r.suite} — ${r.estado} (${(r.ms / 1000).toFixed(0)}s)\n${r.salida}\n`).join("\n");
try { writeFileSync(detalle, salidaDetalle || "sin fallas\n"); console.log(`\nDetalle de lo que no pasó: ${detalle}`); } catch { /* opcional */ }

if (por("FALLA").length || por("TIMEOUT").length) {
  console.log("\nNo pasaron:");
  for (const r of [...por("FALLA"), ...por("TIMEOUT")]) console.log(`  - ${r.suite} (${r.estado})`);
}
process.exit(por("FALLA").length || por("TIMEOUT").length || por("BLOQUEADA").length ? 1 : 0);
