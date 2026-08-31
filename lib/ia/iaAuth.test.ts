import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/ia/iaAuth.test.ts
// Todas las APIs de IA son admin-only. El owner es server-side (nunca del cliente).
// La API key jamás se devuelve/loguea. El modelo no elige tablas ni escribe SQL.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const rutasAdmin = [
  "app/api/admin/ia/config/route.ts",
  "app/api/admin/ia/conversaciones/route.ts",
  "app/api/admin/ia/conversaciones/[id]/route.ts",
  "app/api/admin/ia/conversaciones/[id]/mensajes/route.ts",
  "app/api/admin/ia/conversaciones/[id]/restaurar/route.ts",
  "app/api/admin/ia/papelera/route.ts",
  "app/api/admin/ia/feedback/route.ts",
  "app/api/admin/ia/consumo/route.ts",
];

for (const ruta of rutasAdmin) {
  const src = read(ruta);
  assert.ok(/requireAdmin\(\)/.test(src), `${ruta}: usa requireAdmin`);
  assert.ok(!/requireStaffOrAdmin/.test(src), `${ruta}: NO usa requireStaffOrAdmin`);
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), `${ruta}: corta si el guard falla`);
  // El owner NUNCA viene del cliente.
  assert.ok(!/body\.owner|searchParams\.get\("owner"\)|body\?\.owner/.test(src), `${ruta}: no acepta owner del cliente`);
  assert.ok(/IA_OWNER_ADMIN/.test(src) || ruta.endsWith("config/route.ts"), `${ruta}: usa la identidad interna del admin`);
}

// Purga: protegida (secreto de cron o admin), nunca pública.
{
  const src = read("app/api/admin/ia/purga/route.ts");
  assert.ok(/CRON_SECRET/.test(src), "purga: verifica secreto de cron");
  assert.ok(/getCurrentAdminRole\(\)|requireAdmin/.test(src), "purga: alternativa admin manual");
  assert.ok(/status: 401/.test(src), "purga: 401 sin autorización");
}

// Config: no devuelve ni lee crudo la API key (delega en helpers).
{
  const src = read("app/api/admin/ia/config/route.ts");
  assert.ok(!/process\.env\.ANTHROPIC_API_KEY/.test(src), "config: no toca la key directamente");
}

// Providers/servidor: la API key nunca se loguea ni se serializa.
{
  const anth = read("lib/ia/providerAnthropic.ts");
  assert.ok(!/console\.[a-z]+\([^)]*apiKey/.test(anth), "anthropic: no loguea la key");
  assert.ok(!/JSON\.stringify\([^)]*apiKey/.test(anth), "anthropic: no serializa la key");
  const server = read("lib/ia/server.ts");
  assert.ok(!/ANTHROPIC_API_KEY/.test(server), "server: no maneja la key");
}

// Herramientas: registro CERRADO; el modelo no elige tablas ni escribe SQL.
{
  const tools = read("lib/ia/tools.ts");
  assert.ok(/export const HERRAMIENTAS/.test(tools), "tools: registro cerrado");
  assert.ok(/ToolParamError/.test(tools), "tools: valida parámetros");
  // No hay SQL crudo construido con input del modelo.
  assert.ok(!/`?select .*\$\{/i.test(tools), "tools: no arma SQL con input del modelo");
}

console.log("OK — IA (auth wiring): admin-only en todas las APIs; owner server-side; API key nunca expuesta/logueada; purga protegida; herramientas cerradas sin SQL del modelo.");
