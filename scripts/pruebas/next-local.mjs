// Next.js contra el Supabase LOCAL de pruebas (nunca Producción).
//
//   node scripts/pruebas/next-local.mjs dev   [--port 3100]   # servidor de desarrollo
//   node scripts/pruebas/next-local.mjs build                  # build aislado
//   node scripts/pruebas/next-local.mjs start [--port 3100]   # sirve ese build
//
// Cómo garantiza el aislamiento:
//   · NODE_ENV=test: Next carga .env.test.local y NO carga .env.local (verificado en
//     @next/env: con mode "test" la lista de archivos omite .env.local).
//   · El entorno del proceso se construye con entornoDePruebas() (mismo guardián que
//     las suites): borra las variables de Supabase y de proveedores heredadas del
//     shell y exige que el destino sea un loopback validado.
//   · Antes de arrancar comprueba que el contenedor local responde.
//
// Para entrar al panel local hace falta una sesión: si .env.test.local no tiene
// ADMIN_SESSION_SECRET, ADMIN_PASSWORD y STAFF_PASSWORD, se generan al azar y se
// agregan ahí (archivo ignorado por git, solo de esta máquina). No se imprimen:
// leelas de .env.test.local para ingresar en http://localhost:<puerto>/admin/login.

import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { ARCHIVO_ENV_TEST, CODIGO_BLOQUEADA, abortar, entornoDePruebas } from "./entorno.mjs";

const RAIZ = process.cwd();
const modo = process.argv[2] ?? "dev";
if (!["dev", "build", "start"].includes(modo)) {
  console.error("Uso: node scripts/pruebas/next-local.mjs dev|build|start [--port 3100]");
  process.exit(2);
}
const iPuerto = process.argv.indexOf("--port");
const puerto = iPuerto > 0 ? process.argv[iPuerto + 1] : "3100";

// 1 · Credenciales LOCALES de sesión (si faltan).
const archivo = resolve(RAIZ, ARCHIVO_ENV_TEST);
const actual = readFileSync(archivo, "utf8");
const faltan = ["ADMIN_SESSION_SECRET", "ADMIN_PASSWORD", "STAFF_PASSWORD"].filter((k) => !new RegExp(`^${k}=.+`, "m").test(actual));
if (faltan.length) {
  const lineas = faltan.map((k) => `${k}=${randomBytes(k === "ADMIN_SESSION_SECRET" ? 32 : 9).toString("base64url")}`);
  appendFileSync(archivo, `\n# Sesión del panel en el Next LOCAL (generado por next-local.mjs; solo esta máquina)\n${lineas.join("\n")}\n`);
  console.log(`Agregadas a ${ARCHIVO_ENV_TEST}: ${faltan.join(", ")} (valores al azar, no se muestran).`);
}

// 2 · Entorno: el del guardián (sin Supabase/proveedores heredados) + NODE_ENV=test.
const e = entornoDePruebas(RAIZ);
if (!e.ok) abortar(e);
const env = { ...e.env, NODE_ENV: "test", NEXT_TELEMETRY_DISABLED: "1" };
for (const k of Object.keys(env)) if (k.startsWith("VERCEL")) delete env[k];

// 3 · El stack local tiene que estar vivo.
try {
  execFileSync("docker", ["exec", "supabase_db_sim-web-pruebas", "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select 1"], { stdio: "pipe" });
} catch {
  console.error("\nEl Supabase local no responde. Corré: npm run pruebas:iniciar\n");
  process.exit(CODIGO_BLOQUEADA);
}

// 4 · Opcional: Mercado Pago SIMULADO (lib/mercadoPagoSimulado.ts) para probar el
// checkout completo en el navegador sin dinero ni red. Las preferencias se pagan
// en /pruebas/mercadopago, que avisa al webhook real de esta misma app. La URL
// base no puede ser localhost (las rutas de pago la rechazan): se usa un dominio
// .invalid y la página simulada vuelve siempre a este mismo servidor.
if (process.argv.includes("--mp-simulado")) {
  Object.assign(env, {
    MERCADOPAGO_SIMULADO: "1",
    MERCADOPAGO_ACCESS_TOKEN: "TEST-SIMULADO-LOCAL",
    MERCADOPAGO_WEBHOOK_SECRET: randomBytes(24).toString("hex"),
    CRON_SECRET: randomBytes(24).toString("hex"),
    NEXT_PUBLIC_BASE_URL: "https://sim-pruebas.invalid",
  });
  console.log("Mercado Pago SIMULADO: los pagos se hacen en /pruebas/mercadopago (sin dinero ni red).");
}

// 5 · Opcional: campañas de Marketing en SIMULACIÓN (lib/marketing/campaniasServer.ts).
// Con el proveedor de WhatsApp FALSO y esta base loopback, el panel puede guardar,
// preparar y ejecutar campañas con datos sintéticos (scripts/pruebas/marketing-campanias-demo.mjs).
// No hay proveedor real: nada sale a WhatsApp.
if (process.argv.includes("--marketing-simulado")) {
  // La llave maestra (MARKETING_CAMPANIAS_ENABLED) se enciende solo acá: sin esta
  // opción, también el Next local responde "Deshabilitado", como Producción.
  Object.assign(env, { MARKETING_WHATSAPP_PROVIDER: "fake", MARKETING_CAMPANIAS_ENABLED: "true" });
  if (!env.CRON_SECRET) env.CRON_SECRET = randomBytes(24).toString("hex");
  console.log("Campañas en SIMULACIÓN: proveedor de WhatsApp falso, solo esta base local.");
}

console.log(`Next ${modo} contra ${e.url} (NODE_ENV=test: no se carga .env.local).`);
const args = modo === "build" ? ["build"] : [modo, "-p", puerto];
const hijo = spawn(process.execPath, [resolve(RAIZ, "node_modules/next/dist/bin/next"), ...args], { env, stdio: "inherit", cwd: RAIZ });
hijo.on("exit", (code) => process.exit(code ?? 1));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => hijo.kill(s));
