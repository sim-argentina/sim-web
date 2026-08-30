import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/cronogramaCopiaAuth.test.ts
// Todas las rutas de copia/plantillas son EXCLUSIVAMENTE admin (la API es la autoridad).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const rutas = [
  "app/api/admin/cronograma/copia/semana/route.ts",
  "app/api/admin/cronograma/copia/mes/route.ts",
  "app/api/admin/cronograma/plantillas/route.ts",
  "app/api/admin/cronograma/plantillas/[id]/route.ts",
  "app/api/admin/cronograma/plantillas/[id]/aplicar/route.ts",
];

for (const ruta of rutas) {
  const src = read(ruta);
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.ok(handlers.length > 0, `${ruta}: tiene handlers`);
  assert.ok(/requireAdmin\(\)/.test(src), `${ruta}: usa requireAdmin`);
  assert.ok(!/requireStaffOrAdmin/.test(src), `${ruta}: NO usa requireStaffOrAdmin`);
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), `${ruta}: corta si el guard falla`);
}

console.log("OK — cronogramaCopia (auth wiring): copia semana/mes + plantillas (listar/crear/mutar/aplicar) = admin.");
