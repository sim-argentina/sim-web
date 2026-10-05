// Entorno del proceso de pruebas. Lo comparten el runner y los scripts auxiliares.
//
// Regla central: el proceso hijo recibe un entorno CONSTRUIDO, no el heredado. Las variables
// de Supabase se sobrescriben con las del stack local y las de Producción se borran: si una
// credencial real no está en el entorno, no hay forma de escribir en la base real ni por
// accidente ni por un import que inicialice un cliente antes de tiempo.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const ARCHIVO_ENV_TEST = ".env.test.local";
export const REFS_PROHIBIDOS = ["bcmoewwhsyxsiyvroarj", "unwoaqagnbrcaohxackc"];
export const CODIGO_BLOQUEADA = 78;

/** Variables que la aplicación podría usar para hablar con Supabase. Todas se sobrescriben. */
const VARS_SUPABASE = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWT_SECRET",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
];

/** Credenciales de proveedores externos: ninguna llega al proceso de pruebas. */
const VARS_PROVEEDORES = [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY",
  "MP_ACCESS_TOKEN", "MERCADOPAGO_ACCESS_TOKEN", "MP_WEBHOOK_SECRET",
  "MP_PUBLIC_KEY", "MERCADOPAGO_PUBLIC_KEY",
  "RESEND_API_KEY", "SENDGRID_API_KEY", "SMTP_PASSWORD",
  "WHATSAPP_TOKEN", "TWILIO_AUTH_TOKEN",
  "VERCEL_TOKEN", "SUPABASE_ACCESS_TOKEN",
];

export function leerEnvArchivo(p) {
  if (!existsSync(p)) return null;
  const out = {};
  for (const linea of readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith("#")) continue;
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/**
 * Entorno para el proceso de pruebas. Devuelve { ok, env } o { ok: false, motivo, codigo }.
 * No hereda ninguna variable de Supabase ni de proveedores del shell que lo invoca.
 */
export function entornoDePruebas(raiz = process.cwd()) {
  const p = resolve(raiz, ARCHIVO_ENV_TEST);
  const test = leerEnvArchivo(p);
  if (!test) {
    return { ok: false, codigo: "sin_env_test", motivo: `no existe ${ARCHIVO_ENV_TEST}; corré "npm run pruebas:iniciar"` };
  }

  const url = test.SIM_TEST_SUPABASE_URL ?? "";
  const clave = test.SIM_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !clave) {
    return { ok: false, codigo: "env_test_incompleto", motivo: `${ARCHIVO_ENV_TEST} no define SIM_TEST_SUPABASE_URL y SIM_TEST_SUPABASE_SERVICE_ROLE_KEY` };
  }
  // Mismo criterio de loopback que lib/guardiaPruebas.ts: host exacto, sin credenciales ni path.
  let u;
  try { u = new URL(url); } catch { return { ok: false, codigo: "url_invalida", motivo: `SIM_TEST_SUPABASE_URL no es una URL: ${url}` }; }
  const hostOk = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname.toLowerCase());
  if (!hostOk || u.username || u.password || (u.pathname !== "" && u.pathname !== "/")) {
    return { ok: false, codigo: "host_no_loopback", motivo: `SIM_TEST_SUPABASE_URL no es un loopback validado: ${url}` };
  }
  for (const ref of REFS_PROHIBIDOS) {
    if (JSON.stringify(test).includes(ref)) {
      return { ok: false, codigo: "env_test_contaminado", motivo: `${ARCHIVO_ENV_TEST} menciona el proyecto prohibido ${ref}` };
    }
  }

  // Entorno construido: se parte del heredado y se LIMPIA todo lo sensible.
  const env = { ...process.env };
  for (const k of [...VARS_SUPABASE, ...VARS_PROVEEDORES]) delete env[k];

  // Lo del archivo de pruebas manda.
  Object.assign(env, test);
  // Y además se fija explícitamente lo que la aplicación lee, por si el archivo no lo trajera.
  env.NEXT_PUBLIC_SUPABASE_URL = url;
  env.SUPABASE_URL = url;
  env.SUPABASE_SERVICE_ROLE_KEY = clave;
  env.IA_PROVIDER = "fake";
  env.SIM_TEST_RUN_ID = `pru${Date.now().toString(36)}`;

  // Última revisión: ninguna variable del entorno final puede mencionar un ref prohibido.
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    for (const ref of REFS_PROHIBIDOS) {
      if (v.includes(ref)) {
        return { ok: false, codigo: "entorno_contaminado", motivo: `la variable ${k} menciona el proyecto prohibido ${ref}` };
      }
    }
  }

  return { ok: true, env, url, runId: env.SIM_TEST_RUN_ID };
}

export function abortar(r) {
  console.error(`\n═══ ENTORNO DE PRUEBAS NO DISPONIBLE ═══\n${r.motivo} [${r.codigo}]\n`);
  process.exit(CODIGO_BLOQUEADA);
}
