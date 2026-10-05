// Aplica el esquema completo a la base de PRUEBAS, en el orden de db/orden.txt.
//
// Antes de tocar nada verifica el destino con el mismo guardián que usan las suites:
// si la URL no es un loopback validado, aborta. Nunca puede apuntar a Producción.
//
//   node scripts/pruebas/aplicar-esquema.mjs           # aplica
//   node scripts/pruebas/aplicar-esquema.mjs --reset   # borra el esquema public y reaplica
//
// Se ejecuta con psql dentro del contenedor del stack local: no hace falta tener
// psql instalado en Windows y no hay credenciales de Producción en el proceso.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const RESET = process.argv.includes("--reset");
const RAIZ = process.cwd();
const ENV_TEST = resolve(RAIZ, ".env.test.local");

function leerEnv(p) {
  if (!existsSync(p)) return null;
  const out = {};
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l.trim());
    if (m && !l.trim().startsWith("#")) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

const env = leerEnv(ENV_TEST);
if (!env) {
  console.error(`\nNo existe ${ENV_TEST}.\nCorré primero:  npm run pruebas:iniciar\n`);
  process.exit(78);
}

// ── Guardián: el destino tiene que ser el Supabase local ───────────────────
const URL_TEST = env.SIM_TEST_SUPABASE_URL ?? "";
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
if (!LOOPBACK.test(URL_TEST)) {
  console.error(`\nSIM_TEST_SUPABASE_URL no es un loopback validado: "${URL_TEST}".\nEl esquema de pruebas solo se aplica a la base local.\n`);
  process.exit(78);
}
const PROHIBIDOS = ["bcmoewwhsyxsiyvroarj", "unwoaqagnbrcaohxackc"];
const todo = JSON.stringify(env);
for (const ref of PROHIBIDOS) {
  if (todo.includes(ref)) {
    console.error(`\n.env.test.local menciona el proyecto prohibido ${ref}. Abortado.\n`);
    process.exit(78);
  }
}

const CONTENEDOR = "supabase_db_sim-web-pruebas";
function psql(sql, etiqueta) {
  try {
    const out = execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? ""), etiqueta };
  }
}

// ── Comprobación previa: el stack tiene que estar vivo y ser el esperado ───
const vivo = psql("select current_database() || ' @ ' || inet_server_port() as donde;", "ping");
if (!vivo.ok) {
  console.error(`\nEl contenedor ${CONTENEDOR} no responde. ¿Corriste npm run pruebas:iniciar?\n`);
  console.error(vivo.out.split("\n").slice(0, 5).join("\n"));
  process.exit(78);
}

if (RESET) {
  console.log("reset: borrando el esquema public de la base LOCAL…");
  const r = psql("drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres;", "reset");
  if (!r.ok) { console.error(r.out); process.exit(1); }
  // El tipo range vive en public y se recrea con el esquema base.
  console.log("reset: esquema public vacío.");
}

const orden = readFileSync(resolve(RAIZ, "db/orden.txt"), "utf8")
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

let aplicados = 0;
const fallidos = [];
for (const archivo of orden) {
  const p = resolve(RAIZ, "db", archivo);
  if (!existsSync(p)) { fallidos.push({ archivo, motivo: "no existe" }); continue; }
  const sql = readFileSync(p, "utf8");
  const r = psql(sql, archivo);
  if (r.ok) { aplicados++; process.stdout.write("."); }
  else {
    process.stdout.write("x");
    const err = r.out.split("\n").filter((l) => /ERROR|FATAL/.test(l)).slice(0, 3).join(" | ");
    fallidos.push({ archivo, motivo: err || r.out.slice(0, 200) });
  }
}
console.log("");
console.log(`\nAplicados: ${aplicados}/${orden.length}`);
if (fallidos.length) {
  console.log("\nFallaron:");
  for (const f of fallidos) console.log(`  - ${f.archivo}\n      ${f.motivo}`);
}

// ── Censo final, para ver qué quedó ────────────────────────────────────────
const censo = psql(`select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tablas,
  (select count(distinct p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) as funciones,
  (select count(*) from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not tg.tgisinternal) as triggers;`, "censo");
if (censo.ok) console.log("\nEn la base local:\n" + censo.out.trim());

process.exit(fallidos.length ? 1 : 0);
