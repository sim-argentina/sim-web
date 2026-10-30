// Entorno LOCAL aislado del CRM: una instancia de Supabase propia, separada de la base
// de pruebas compartida del repositorio (que puede tener esquemas de otras ramas, como
// Marketing). Nunca toca Producción ni la base compartida.
//
//   node scripts/pruebas/crm-local.mjs iniciar            # levanta la instancia y escribe .env.crm.local
//   node scripts/pruebas/crm-local.mjs esquema [--reset]  # aplica db/orden.txt (con --reset, vacía public antes)
//   node scripts/pruebas/crm-local.mjs suite <archivo>    # corre una suite contra la instancia
//   node scripts/pruebas/crm-local.mjs sql <archivo.sql>  # corre un SQL (p. ej. una verificación)
//   node scripts/pruebas/crm-local.mjs next <dev|build|start> [--port 3130]
//   node scripts/pruebas/crm-local.mjs detener [--borrar]
//
// Instancia: project_id "sim-web-crm-local", puertos 557xx, contenedor de base
// "supabase_db_sim-web-crm-local". La configuración se genera en .crm-local/ a partir de
// supabase/config.toml (solo cambian el project_id y los puertos) y no se versiona.
// Credenciales: .env.crm.local (ignorado por git), con claves de sesión locales al azar.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { REFS_PROHIBIDOS, CODIGO_BLOQUEADA, leerEnvArchivo } from "./entorno.mjs";

const RAIZ = process.cwd();
const PROYECTO = "sim-web-crm-local";
const CONTENEDOR = `supabase_db_${PROYECTO}`;
const DIR = resolve(RAIZ, ".crm-local");
const ENV = resolve(RAIZ, ".env.crm.local");
const PUERTOS = { 55321: 55721, 55322: 55722, 54320: 54720, 55329: 55729, 55323: 55723, 55324: 55724, 55327: 55727, 8083: 8183 };

const VARS_SENSIBLES = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_URL",
  "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWT_SECRET", "DATABASE_URL",
  "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY",
  "MP_ACCESS_TOKEN", "MERCADOPAGO_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "MP_PUBLIC_KEY", "MERCADOPAGO_PUBLIC_KEY",
  "RESEND_API_KEY", "SENDGRID_API_KEY", "SMTP_PASSWORD", "WHATSAPP_TOKEN", "TWILIO_AUTH_TOKEN", "VERCEL_TOKEN",
  "SUPABASE_ACCESS_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
];

function abortar(motivo) {
  console.error(`\n═══ ENTORNO LOCAL DEL CRM NO DISPONIBLE ═══\n${motivo}\n`);
  process.exit(CODIGO_BLOQUEADA);
}

function cli(args, opciones = {}) {
  return execFileSync("npx", ["supabase", ...args, "--workdir", DIR], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024, ...opciones,
  });
}

function psql(sql) {
  try {
    const out = execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

function generarConfig() {
  let toml = readFileSync(resolve(RAIZ, "supabase/config.toml"), "utf8");
  toml = toml.replace(/^project_id = ".*"$/m, `project_id = "${PROYECTO}"`);
  for (const [de, a] of Object.entries(PUERTOS)) toml = toml.replace(new RegExp(`(port|shadow_port|inspector_port) = ${de}\\b`, "g"), `$1 = ${a}`);
  mkdirSync(resolve(DIR, "supabase"), { recursive: true });
  writeFileSync(resolve(DIR, "supabase/config.toml"), toml);
  writeFileSync(resolve(DIR, ".gitignore"), "*\n");
}

/** Entorno CONSTRUIDO para un proceso hijo: nada sensible heredado, solo la instancia local. */
function entorno() {
  if (existsSync(resolve(RAIZ, ".env.local"))) abortar("Existe .env.local en este directorio: podría cargar credenciales de Producción. Abortado.");
  const v = leerEnvArchivo(ENV);
  if (!v) abortar(`No existe ${ENV}. Corré: node scripts/pruebas/crm-local.mjs iniciar`);
  const u = new URL(v.SIM_TEST_SUPABASE_URL ?? "http://invalido");
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "55721") abortar(`Destino inesperado: ${u.origin}`);
  const env = { ...process.env };
  for (const k of VARS_SENSIBLES) delete env[k];
  Object.assign(env, v, { IA_PROVIDER: "fake", NEXT_TELEMETRY_DISABLED: "1" });
  for (const [k, val] of Object.entries(env)) {
    if (typeof val !== "string") continue;
    for (const ref of REFS_PROHIBIDOS) if (val.includes(ref)) abortar(`La variable ${k} menciona el proyecto prohibido ${ref}.`);
  }
  return env;
}

const [, , orden, ...resto] = process.argv;

if (orden === "iniciar") {
  generarConfig();
  console.log(`Levantando ${PROYECTO} (puertos 557xx)…`);
  try {
    cli(["start"], { stdio: ["pipe", "ignore", "pipe"] });
  } catch (e) {
    const msg = String(e.stdout ?? "") + String(e.stderr ?? "");
    if (!/already running|is running/i.test(msg)) abortar(`No se pudo levantar la instancia. ¿Docker Desktop está corriendo?\n${msg.split("\n").slice(-8).join("\n")}`);
  }
  const crudo = cli(["status", "-o", "env"]);
  const s = {};
  for (const l of crudo.split(/\r?\n/)) {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim());
    if (m) s[m[1]] = m[2];
  }
  const previo = leerEnvArchivo(ENV) ?? {};
  const azar = (n) => randomBytes(n).toString("base64url");
  const contenido = [
    "# Entorno LOCAL aislado del CRM (scripts/pruebas/crm-local.mjs). NO se commitea.",
    `SIM_TEST_SUPABASE_URL=${s.API_URL}`,
    `SIM_TEST_SUPABASE_SERVICE_ROLE_KEY=${s.SERVICE_ROLE_KEY}`,
    `NEXT_PUBLIC_SUPABASE_URL=${s.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${s.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${s.SERVICE_ROLE_KEY}`,
    `SIM_TEST_CONTENEDOR_DB=${CONTENEDOR}`,
    `ADMIN_SESSION_SECRET=${previo.ADMIN_SESSION_SECRET || azar(32)}`,
    `ADMIN_PASSWORD=${previo.ADMIN_PASSWORD || azar(9)}`,
    `STAFF_PASSWORD=${previo.STAFF_PASSWORD || azar(9)}`,
    `CRM_SESSION_SECRET=${previo.CRM_SESSION_SECRET || azar(32)}`,
    "",
  ].join("\n");
  writeFileSync(ENV, contenido);
  console.log(`Listo: ${s.API_URL} · ${ENV} escrito (valores no se muestran).`);
} else if (orden === "esquema") {
  entorno();
  if (resto.includes("--reset")) {
    const r = psql("drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres;");
    if (!r.ok) abortar(r.out);
    console.log("reset: public vacío en la instancia del CRM.");
  }
  const archivos = readFileSync(resolve(RAIZ, "db/orden.txt"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const fallos = [];
  for (const a of archivos) {
    const r = psql(readFileSync(resolve(RAIZ, "db", a), "utf8"));
    if (!r.ok) fallos.push(`${a}: ${r.out.split("\n").filter((l) => /ERROR/.test(l)).slice(0, 2).join(" | ")}`);
  }
  console.log(`Aplicados ${archivos.length - fallos.length}/${archivos.length} archivos de db/orden.txt.`);
  if (fallos.length) { console.log(fallos.join("\n")); process.exit(1); }
} else if (orden === "suite") {
  const env = entorno();
  const r = spawnSync("npx", ["tsx", ...resto], { env, stdio: "inherit", shell: process.platform === "win32" });
  process.exit(r.status ?? 1);
} else if (orden === "sql") {
  entorno();
  const r = psql(readFileSync(resolve(RAIZ, resto[0]), "utf8"));
  const salida = r.out.match(/RESULTADO[^\n"]*/)?.[0] ?? r.out.split("\n").slice(-5).join("\n");
  console.log(salida);
  process.exit(r.ok || /RESULTADO .*\|OK/.test(r.out) ? 0 : 1);
} else if (orden === "next") {
  const env = entorno();
  const modo = resto[0] ?? "dev";
  const iPuerto = resto.indexOf("--port");
  const puerto = iPuerto >= 0 ? resto[iPuerto + 1] : "3130";
  env.NODE_ENV = modo === "dev" ? "development" : "production";
  for (const k of Object.keys(env)) if (k.startsWith("VERCEL")) delete env[k];
  const args = modo === "build" ? ["build"] : [modo, "-p", puerto];
  const hijo = spawn(process.execPath, [resolve(RAIZ, "node_modules/next/dist/bin/next"), ...args], { env, stdio: "inherit", cwd: RAIZ });
  hijo.on("exit", (code) => process.exit(code ?? 1));
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => hijo.kill(s));
} else if (orden === "detener") {
  if (!existsSync(DIR)) abortar("No hay instancia del CRM configurada.");
  cli(["stop", ...(resto.includes("--borrar") ? ["--no-backup"] : [])], { stdio: ["pipe", "inherit", "inherit"] });
} else {
  console.error("Uso: node scripts/pruebas/crm-local.mjs iniciar | esquema [--reset] | suite <archivo> | sql <archivo.sql> | next <dev|build|start> [--port N] | detener [--borrar]");
  process.exit(2);
}
