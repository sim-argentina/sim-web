// Corre la regresión SEGURA: las suites que no escriben en la base.
//
//   node scripts/pruebas/correr-seguras.mjs
//
// Dos grupos:
//   · sin base   → en paralelo, no tocan Supabase (puras).
//   · solo lectura → en serie contra Producción con .env.local, porque leen datos reales.
//     Son de lectura comprobada: el contrato de lib/guardiaPruebas.test.ts falla si alguna
//     empieza a escribir.
//
// Esta corrida NUNCA ejecuta una suite mutante.

import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const PARALELO = 6;
const TIMEOUT_MS = 7 * 60 * 1000;
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

const sinBase = [], soloLectura = [];
for (const f of walk("lib").sort()) {
  const s = readFileSync(f, "utf8");
  // Si la suite IMPORTA el activador, exige la base de pruebas: no corre acá, ni siquiera
  // si es de solo lectura. Se busca el import, no una mención: lib/guardiaPruebas.test.ts
  // nombra el archivo para inspeccionarlo y es una prueba pura.
  if (/^\s*import\s+["'`]@\/lib\/guardiaPruebas\.activar["'`]/m.test(s)) continue;
  if (!/supabaseAdmin|createClient/.test(s)) { sinBase.push(f); continue; }
  const rpcsMut = [...s.matchAll(RE_RPC)].map((m) => m[1]).filter((n) => !RPC_DE_LECTURA.has(n));
  const mutante = ESCRITURA.test(s) || rpcsMut.length > 0 || /from "@\/app\/api/.test(s);
  if (!mutante) soloLectura.push(f);
}

console.log(`Sin base: ${sinBase.length} (en paralelo)  ·  solo lectura: ${soloLectura.length} (en serie)\n`);

function correr(f, args) {
  const t0 = Date.now();
  const r = spawnSync("npx", ["tsx", ...args, f], {
    env: { ...process.env, IA_PROVIDER: "fake" },
    encoding: "utf8", timeout: TIMEOUT_MS, shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024,
  });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const estado = r.status === 0 ? "OK" : /GUARDIA DE BASE DE PRUEBAS/.test(salida) ? "BLOQUEADA" : "FALLA";
  return { suite: f, estado, ms: Date.now() - t0, salida: estado === "OK" ? "" : salida.slice(-2500) };
}

const resultados = [];

// Grupo 1: las que no referencian la base directamente, en paralelo por tandas.
//
// Van con .env.local, igual que antes. Dos razones:
//  · varios módulos leen la configuración al importarse (lib/supabaseAdmin.ts lanza si
//    falta la URL), así que necesitan un entorno VÁLIDO;
//  · "no referencia supabaseAdmin" no quiere decir "no lee la base": por ejemplo
//    lib/ia/toolsUnits.integration.ts no la nombra pero la lee a través de
//    @/lib/ia/tools, y verifica totales de datos reales. Apuntarlas a la base local
//    vacía las haría fallar por una razón que no tiene que ver con lo que verifican.
//
// Leer Producción desde una prueba está permitido; lo que no puede pasar es ESCRIBIR,
// y de eso se encarga el guardián: cualquier suite que escriba tiene que activarlo y
// entonces no corre acá, corre contra la base local.
for (let i = 0; i < sinBase.length; i += PARALELO) {
  const tanda = sinBase.slice(i, i + PARALELO);
  const hechos = tanda.map((f) => correr(f, ["--env-file=.env.local"]));
  for (const r of hechos) { resultados.push(r); process.stdout.write(r.estado === "OK" ? "." : "x"); }
}
console.log("");

// Grupo 2: lectura contra Producción, en serie.
if (!existsSync(".env.local")) {
  console.log("\n(sin .env.local: se omiten las de solo lectura contra Producción)");
} else {
  for (const f of soloLectura) {
    const r = correr(f, ["--env-file=.env.local"]);
    resultados.push(r);
    process.stdout.write(r.estado === "OK" ? "." : "x");
  }
  console.log("");
}

const fallan = resultados.filter((r) => r.estado !== "OK");
console.log(`\n═══ REGRESIÓN SEGURA ═══\ncorridas: ${resultados.length}  ·  OK: ${resultados.length - fallan.length}  ·  no pasaron: ${fallan.length}`);
for (const r of fallan) console.log(`  - ${r.suite} (${r.estado})`);
process.exit(fallan.length ? 1 : 0);
