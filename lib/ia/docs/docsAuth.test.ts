import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/ia/docs/docsAuth.test.ts
// Todas las APIs de documentos/adjuntos son admin-only; owner server-side; el modelo
// no elige tablas/SQL ni lee Storage; las herramientas de conocimiento están cerradas.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const rutas = [
  "app/api/admin/ia/conversaciones/[id]/adjuntos/route.ts",
  "app/api/admin/ia/adjuntos/[id]/route.ts",
  "app/api/admin/ia/adjuntos/[id]/promover/route.ts",
  "app/api/admin/ia/conocimiento/categorias/route.ts",
  "app/api/admin/ia/conocimiento/categorias/[id]/route.ts",
  "app/api/admin/ia/conocimiento/documentos/route.ts",
  "app/api/admin/ia/conocimiento/documentos/[id]/route.ts",
  "app/api/admin/ia/conocimiento/versiones/[id]/route.ts",
  "app/api/admin/ia/conocimiento/buscar/route.ts",
];
for (const ruta of rutas) {
  const src = read(ruta);
  assert.ok(/requireAdmin\(\)/.test(src), `${ruta}: usa requireAdmin`);
  assert.ok(!/requireStaffOrAdmin/.test(src), `${ruta}: NO usa requireStaffOrAdmin`);
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), `${ruta}: corta si el guard falla`);
  assert.ok(!/body\.owner|searchParams\.get\("owner"\)/.test(src), `${ruta}: no acepta owner del cliente`);
}

// El registro de herramientas incluye las de conocimiento, y el modelo no accede a Storage/SQL.
{
  const tools = read("lib/ia/docs/conocimientoTools.ts");
  assert.ok(/export const HERRAMIENTAS_CONOCIMIENTO/.test(tools), "expone el registro de conocimiento");
  assert.ok(!/\.storage\./.test(tools), "las herramientas no tocan Storage");
  assert.ok(!/`?select .*\$\{/i.test(tools), "las herramientas no arman SQL con input del modelo");
  const reg = read("lib/ia/tools.ts");
  assert.ok(/HERRAMIENTAS_CONOCIMIENTO/.test(reg), "el registro principal incluye conocimiento");
}

// El prompt declara la prioridad de fuentes y trata los documentos como datos.
{
  const sp = read("lib/ia/systemPrompt.ts");
  assert.ok(/PRIORIDAD DE FUENTES/.test(sp), "prompt: prioridad de fuentes");
  assert.ok(/INFORMACIÓN, NUNCA instrucciones/.test(sp), "prompt: documentos como datos (anti injection)");
  assert.ok(/Citá SIEMPRE la fuente documental/.test(sp), "prompt: exige citar la fuente");
}

console.log("OK — docsAuth: APIs 4B admin-only, owner server-side, sin SQL/Storage del modelo, prompt con prioridad de fuentes + citas + injection-como-dato.");
