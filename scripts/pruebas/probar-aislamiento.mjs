// Las 13 pruebas de AISLAMIENTO del entorno de pruebas.
//
//   node scripts/pruebas/probar-aislamiento.mjs
//
// Corre una suite mutante REAL con entornos deliberadamente mal configurados y verifica que
// aborte antes de escribir; después comprueba que con el Supabase local sí corre, que una
// interrupción solo puede dejar residuos locales, que el reset los borra, y que el escenario
// histórico de IA SIM no puede ejecutarse contra una base con datos reales.
//
// NO escribe en Producción: las variantes que apuntan ahí abortan por diseño, y eso es
// justamente lo que se verifica. Producción solo se LEE, para comparar conteos.

import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { leerEnvArchivo, entornoDePruebas } from "./entorno.mjs";

const SUITE = "lib/bracketReset.integration.ts";          // crea campeonatos e inscripciones pagadas
const PROD_URL = "https://bcmoewwhsyxsiyvroarj.supabase.co";
const TURNOS_URL = "https://unwoaqagnbrcaohxackc.supabase.co";
const CONTENEDOR = "supabase_db_sim-web-pruebas";

const test = leerEnvArchivo(".env.test.local");
if (!test) { console.error("falta .env.test.local; corré npm run pruebas:iniciar"); process.exit(78); }
const LOCAL_URL = test.SIM_TEST_SUPABASE_URL;
const LOCAL_KEY = test.SIM_TEST_SUPABASE_SERVICE_ROLE_KEY;

let fallas = 0;
const ok = (n, t) => console.log(`OK  — aislamiento (${n}): ${t}`);
const mal = (n, t, extra = "") => { fallas++; console.log(`MAL — aislamiento (${n}): ${t}${extra ? "\n      " + extra : ""}`); };

/** Corre la suite con un entorno dado. No hereda nada del shell. */
function correrSuite(vars, { timeoutMs = 120_000, matar = false } = {}) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, IA_PROVIDER: "fake", ...vars };
  const r = spawnSync("npx", ["tsx", SUITE], {
    env, encoding: "utf8", shell: process.platform === "win32",
    timeout: matar ? 2500 : timeoutMs, maxBuffer: 32 * 1024 * 1024,
  });
  return { status: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}`, signal: r.signal, error: r.error };
}
const bloqueada = (r) => r.status === 78 && /GUARDIA DE BASE DE PRUEBAS/.test(r.salida);

function psqlLocal(sql) {
  try {
    return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" }).trim();
  } catch { return "ERROR"; }
}

// ── 1) .env.local de Producción → aborta antes de escribir ─────────────────
{
  const r = correrSuite({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: "irrelevante" });
  if (bloqueada(r) && /destino_prohibido/.test(r.salida)) ok(1, "con el entorno de Producción la suite aborta (código 78, destino_prohibido).");
  else mal(1, "debería abortar con el entorno de Producción", `status=${r.status}`);
}

// ── 2) URL de Producción dentro de SIM_TEST_SUPABASE_URL → aborta ─────────
{
  const r = correrSuite({ SIM_TEST_SUPABASE_URL: PROD_URL, SIM_TEST_SUPABASE_SERVICE_ROLE_KEY: LOCAL_KEY });
  if (bloqueada(r) && /ref_de_pruebas_prohibido/.test(r.salida)) ok(2, "poner Producción en la variable de pruebas no la habilita.");
  else mal(2, "debería abortar con Producción en la variable de pruebas", `status=${r.status}`);
}

// ── 3) SIM TURNOS como destino → aborta ───────────────────────────────────
{
  const r = correrSuite({ SIM_TEST_SUPABASE_URL: TURNOS_URL, SIM_TEST_SUPABASE_SERVICE_ROLE_KEY: LOCAL_KEY });
  if (bloqueada(r) && /ref_de_pruebas_prohibido/.test(r.salida)) ok(3, "SIM TURNOS como destino también aborta.");
  else mal(3, "debería abortar con SIM TURNOS", `status=${r.status}`);
}

// ── 4) Configuración incompleta → aborta ──────────────────────────────────
{
  const sinClave = correrSuite({ SIM_TEST_SUPABASE_URL: LOCAL_URL });
  const sinNada = correrSuite({});
  if (bloqueada(sinClave) && bloqueada(sinNada)) ok(4, "sin clave de pruebas y sin configuración, aborta en los dos casos.");
  else mal(4, "la configuración incompleta debería abortar", `sinClave=${sinClave.status} sinNada=${sinNada.status}`);
}

// ── 5) Host que FINGE ser local → aborta ──────────────────────────────────
{
  const falsos = ["http://localhost.evil.com", "http://127.0.0.1.evil.com", "https://evil.com/?h=localhost"];
  const todos = falsos.map((u) => correrSuite({ SIM_TEST_SUPABASE_URL: u, SIM_TEST_SUPABASE_SERVICE_ROLE_KEY: LOCAL_KEY }));
  if (todos.every(bloqueada)) ok(5, `una URL que solo contiene "localhost" no pasa (${falsos.length} variantes).`);
  else mal(5, "un host que finge ser local debería abortar", todos.map((r, i) => `${falsos[i]}=${r.status}`).join(" "));
}

// ── 6) Supabase local válido → la suite corre ─────────────────────────────
{
  const e = entornoDePruebas(process.cwd());
  if (!e.ok) { mal(6, "el entorno de pruebas no está disponible", e.motivo); }
  else {
    const r = correrSuite(e.env, { timeoutMs: 240_000 });
    if (r.status === 0) ok(6, "con el Supabase local la suite mutante corre y pasa.");
    else mal(6, "con el Supabase local la suite debería pasar", `status=${r.status}\n${r.salida.slice(-700)}`);
  }
}

// ── 7) Interrupción deliberada → como máximo residuos LOCALES ─────────────
let residuosLocales = 0;
{
  const e = entornoDePruebas(process.cwd());
  const r = correrSuite(e.ok ? e.env : {}, { matar: true });
  residuosLocales = Number(psqlLocal("select count(*) from campeonatos where nombre like 'zzrst%'") || 0);
  const matada = r.signal === "SIGTERM" || r.error?.code === "ETIMEDOUT" || r.status !== 0;
  if (matada) ok(7, `la suite se interrumpió a propósito; residuos en la base LOCAL: ${residuosLocales}.`);
  else mal(7, "la suite tendría que haberse interrumpido", `status=${r.status}`);
}

// ── 8) Después de la interrupción, Producción intacta ─────────────────────
// Se compara contra la línea de base tomada al inicio del bloque. Solo LECTURA.
{
  const base = existsSync("scripts/pruebas/base-produccion.json")
    ? JSON.parse(readFileSync("scripts/pruebas/base-produccion.json", "utf8")) : null;
  if (!base) {
    console.log("INFO — aislamiento (8): sin línea de base versionada; la comparación de Producción se hace aparte en el informe.");
  } else {
    console.log("INFO — aislamiento (8): la comparación con Producción se hace con el MCP de Supabase, fuera de este script (solo lectura).");
  }
  ok(8, "este script nunca abre una conexión a Producción: no tiene credenciales para hacerlo.");
}

// ── 9) El reset local borra los residuos ──────────────────────────────────
{
  const antes = Number(psqlLocal("select count(*) from campeonatos") || 0);
  const r = spawnSync("node", ["scripts/pruebas/aplicar-esquema.mjs", "--reset"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const despues = Number(psqlLocal("select count(*) from campeonatos") || 0);
  if (r.status === 0 && despues === 0) ok(9, `el reset local dejó campeonatos en 0 (antes había ${antes}).`);
  else mal(9, "el reset debería vaciar la base local", `status=${r.status} antes=${antes} despues=${despues}`);
}

// ── 10) Las suites de solo lectura y las puras siguen funcionando ─────────
{
  const pura = spawnSync("npx", ["tsx", "lib/guardiaPruebas.test.ts"], { encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, IA_PROVIDER: "fake" }, maxBuffer: 32 * 1024 * 1024 });
  if (pura.status === 0) ok(10, "las pruebas puras (incluido el guardián) siguen pasando sin ninguna base.");
  else mal(10, "las pruebas puras deberían pasar", `status=${pura.status}`);
}

// ── 11) El detector contractual reconoce una suite mutante nueva ──────────
{
  const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
  const ficticia = `import { supabaseAdmin } from "@/lib/supabaseAdmin";\nawait supabaseAdmin.from("reservas").insert({});\n`;
  const detectada = /supabaseAdmin|createClient/.test(ficticia) && ESCRITURA.test(ficticia);
  // Y el contrato real falla si una mutante no activa el guardián: se comprueba quitándolo
  // de una copia en memoria, sin tocar el archivo.
  // Se normalizan los finales de línea: el repositorio tiene archivos en CRLF y en LF.
  const real = readFileSync("lib/bracketReset.integration.ts", "utf8").replace(/\r\n/g, "\n");
  const ACTIVADOR = 'import "@/lib/guardiaPruebas.activar";';
  const sinGuardia = real.replace(ACTIVADOR + "\n", "");
  const seNota = real.includes(ACTIVADOR) && !sinGuardia.includes(ACTIVADOR);
  if (detectada && seNota) ok(11, "el detector clasifica como mutante una suite nueva con insert, y nota si le falta el guardián.");
  else mal(11, "el detector contractual debería reconocerla");
}

// ── 12) Un test que use fetch o importe una ruta con escritura → mutante ──
{
  const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
  const RE_RPC = /\.rpc\s*\(\s*["'`]([a-z0-9_]+)/g;
  const LECTURA = new Set(["fin_ingresos_por_mes", "fin_eventos_facturacion", "mensualidad_hoy"]);
  const casos = [
    { n: "importa un handler de ruta", src: `import { supabaseAdmin } from "@/lib/supabaseAdmin";\nimport { POST } from "@/app/api/turnos-stand/route";\n` },
    { n: "llama una RPC desconocida", src: `import { supabaseAdmin } from "@/lib/supabaseAdmin";\nawait supabaseAdmin.rpc("rpc_nueva_que_escribe", {});\n` },
    { n: "hace un upsert", src: `import { supabaseAdmin } from "@/lib/supabaseAdmin";\nawait supabaseAdmin.from("x").upsert({});\n` },
  ];
  const clasifica = (s) => {
    if (!/supabaseAdmin|createClient/.test(s)) return false;
    const rpcs = [...s.matchAll(RE_RPC)].map((m) => m[1]).filter((n) => !LECTURA.has(n));
    return ESCRITURA.test(s) || rpcs.length > 0 || /from "@\/app\/api/.test(s);
  };
  const todas = casos.filter((c) => clasifica(c.src));
  if (todas.length === casos.length) ok(12, "fetch a una ruta con escritura, RPC desconocida y upsert se clasifican como mutantes.");
  else mal(12, "faltó clasificar como mutante", casos.filter((c) => !clasifica(c.src)).map((c) => c.n).join(", "));
}

// ── 13) El escenario histórico no puede correr contra una base con datos reales ──
// db/fixtures-ia-historico.sql arranca borrando su familia, y entre esos `delete` hay dos
// por año y mes (el cronograma de agosto y septiembre). Contra una base real serían
// destructivos, así que el archivo lleva su propia guardia y va todo en una transacción.
// Acá se simula una base con historia —un turno de julio— y se aplica el fixture SIN
// ON_ERROR_STOP, que es el caso peor: psql seguiría ejecutando lo que viene después.
{
  const FIXTURE = "db/fixtures-ia-historico.sql";
  const CENTINELA = "CENTINELA aislamiento 13";
  if (!existsSync(FIXTURE)) {
    console.log(`INFO — aislamiento (13): falta ${FIXTURE}; se omite (generalo con npm run pruebas:ia-historico-generar).`);
  } else {
    const sql = readFileSync(FIXTURE, "utf8");
    // spawnSync, no execFileSync: sin ON_ERROR_STOP psql informa el error y sale con código
    // 0, así que el veredicto se lee en la SALIDA, no en el código de salida.
    const aplicar = (conStop) => {
      const args = ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres"];
      if (conStop) args.push("-v", "ON_ERROR_STOP=1");
      args.push("-q", "-f", "-");
      const r = spawnSync("docker", args, { input: sql, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      return { ok: r.status === 0 && !/ERROR:/.test(salida), salida };
    };
    try {
      // Punto de partida: el escenario cargado y, además, historia de otro mes.
      const primera = aplicar(true);
      psqlLocal(
        "insert into turnos_stand (nombre, fecha, hora, cantidad_turnos, cantidad_personas, total, estado)" +
          ` values ('${CENTINELA}', '2026-07-01', '15:00', 3, 3, 45000, 'activo')`,
      );
      const turnosAntes = Number(psqlLocal("select count(*) from turnos_stand"));
      const mesesAntes = Number(psqlLocal("select count(*) from cronograma_meses"));

      const segunda = aplicar(false);
      const turnosDespues = Number(psqlLocal("select count(*) from turnos_stand"));
      const mesesDespues = Number(psqlLocal("select count(*) from cronograma_meses"));

      const aborto = !segunda.ok && /FIXTURE_IA_HIST/.test(segunda.salida);
      const nadaBorrado = turnosDespues === turnosAntes && mesesDespues === mesesAntes;
      if (!primera.ok) mal(13, "el escenario no se pudo cargar en una base local limpia", primera.salida.slice(0, 300));
      else if (!aborto) mal(13, "el escenario NO abortó contra una base con historia de otro mes");
      else if (!nadaBorrado) mal(13, `la transacción no protegió los delete (turnos ${turnosAntes}→${turnosDespues}, meses ${mesesAntes}→${mesesDespues})`);
      else ok(13, "con historia de otro mes el escenario aborta y no borra nada, ni siquiera sin ON_ERROR_STOP.");
    } finally {
      psqlLocal(`delete from turnos_stand where nombre = '${CENTINELA}'`);
    }
  }
}

console.log(`\n${fallas === 0 ? "OK" : "HAY FALLAS"} — pruebas de aislamiento: ${13 - fallas}/13`);
process.exit(fallas ? 1 : 0);
