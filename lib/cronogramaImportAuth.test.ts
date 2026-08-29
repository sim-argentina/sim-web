import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/cronogramaImportAuth.test.ts
// Todas las rutas de importación son EXCLUSIVAMENTE admin (la API es la autoridad).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const rutas = [
  "app/api/admin/cronograma/importar/analizar/route.ts",
  "app/api/admin/cronograma/importar/[id]/route.ts",
  "app/api/admin/cronograma/importar/[id]/aplicar/route.ts",
  "app/api/admin/cronograma/importar/[id]/descartar/route.ts",
];

for (const ruta of rutas) {
  const src = read(ruta);
  // Cada handler exportado usa requireAdmin y NUNCA requireStaffOrAdmin.
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.ok(handlers.length > 0, `${ruta}: tiene handlers`);
  assert.ok(/requireAdmin\(\)/.test(src), `${ruta}: usa requireAdmin`);
  assert.ok(!/requireStaffOrAdmin/.test(src), `${ruta}: NO usa requireStaffOrAdmin`);
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), `${ruta}: corta si el guard falla`);
}

// La ruta de análisis debe correr en runtime Node.js (pdfjs), no Edge.
assert.ok(/export const runtime = "nodejs"/.test(read("app/api/admin/cronograma/importar/analizar/route.ts")), "analizar usa runtime nodejs");

console.log("OK — cronogramaImport (auth wiring): analizar/[id] GET·PUT/aplicar/descartar = admin; análisis en runtime nodejs.");
