// Levanta el Supabase LOCAL de pruebas y escribe .env.test.local con sus credenciales.
//
//   node scripts/pruebas/iniciar.mjs
//
// No toca Producción ni ningún otro proyecto: usa el project_id "sim-web-pruebas" de
// supabase/config.toml, con puertos 553xx para no pisar otros stacks locales de la máquina.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { REFS_PROHIBIDOS, ARCHIVO_ENV_TEST } from "./entorno.mjs";

function cli(args, opciones = {}) {
  return execFileSync("npx", ["supabase", ...args], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024, ...opciones,
  });
}

console.log("Levantando el Supabase local de pruebas (sim-web-pruebas)…");
try {
  cli(["start"], { stdio: ["pipe", "inherit", "inherit"] });
} catch (e) {
  // `start` falla si ya está arriba; eso no es un error.
  const msg = String(e.stdout ?? "") + String(e.stderr ?? "");
  if (!/already running|container .* is running/i.test(msg)) {
    console.error("\nNo se pudo levantar el stack local.");
    console.error(msg.split("\n").slice(-12).join("\n"));
    console.error("\nRevisá que Docker Desktop esté corriendo.\n");
    process.exit(1);
  }
  console.log("(ya estaba arriba)");
}

const crudo = cli(["status", "-o", "env"]);
const v = {};
for (const l of crudo.split(/\r?\n/)) {
  const m = /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim());
  if (m) v[m[1]] = m[2];
}

const faltan = ["API_URL", "SERVICE_ROLE_KEY", "ANON_KEY"].filter((k) => !v[k]);
if (faltan.length) {
  console.error(`\nEl stack arrancó pero no publicó ${faltan.join(", ")}.`);
  console.error("Revisá que [auth] esté habilitado en supabase/config.toml: el CLI emite las claves ahí.\n");
  process.exit(1);
}

// El destino tiene que ser loopback y no puede mencionar un proyecto prohibido.
const u = new URL(v.API_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname.toLowerCase())) {
  console.error(`\nAPI_URL no es loopback: ${v.API_URL}. Abortado.\n`);
  process.exit(1);
}
for (const ref of REFS_PROHIBIDOS) {
  if (JSON.stringify(v).includes(ref)) {
    console.error(`\nEl stack local menciona el proyecto prohibido ${ref}. Abortado.\n`);
    process.exit(1);
  }
}

const contenido = `# Entorno de PRUEBAS — generado por "npm run pruebas:iniciar". NO se commitea.
# (.gitignore cubre .env*; el template versionado es .env.test.example)
#
# Todas las variables apuntan al Supabase LOCAL. Ninguna credencial de Producción
# vive acá: el proceso de pruebas nunca debe tener a mano la base real.

# Lo que lee el guardián (lib/guardiaPruebas.ts)
SIM_TEST_SUPABASE_URL=${v.API_URL}
SIM_TEST_SUPABASE_SERVICE_ROLE_KEY=${v.SERVICE_ROLE_KEY}

# Lo que lee la aplicación (lib/supabaseAdmin.ts y el cliente del navegador).
# Se sobrescriben a propósito para que supabaseAdmin hable con la base local.
NEXT_PUBLIC_SUPABASE_URL=${v.API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${v.ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${v.SERVICE_ROLE_KEY}

# Conexión directa a Postgres, para reset y verificaciones
SIM_TEST_DB_URL=${v.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres"}

# Proveedores externos: siempre falsos en pruebas. Cero consumo facturable.
IA_PROVIDER=fake
`;
writeFileSync(ARCHIVO_ENV_TEST, contenido);

console.log(`\nStack local listo.`);
console.log(`  API : ${v.API_URL}`);
console.log(`  DB  : ${v.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres"}`);
console.log(`  ${ARCHIVO_ENV_TEST} escrito (service role de ${v.SERVICE_ROLE_KEY.length} caracteres, no se muestra).`);
console.log(`\nSiguiente paso:  npm run pruebas:esquema\n`);
