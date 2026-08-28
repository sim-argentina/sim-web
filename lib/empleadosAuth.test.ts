import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/empleadosAuth.test.ts
// Prueba de cableado de autorización (server-side authority): cada handler de las
// rutas de integrantes usa el guard correcto. La lectura permite staff+admin; toda
// mutación exige admin. No se confía en la UI: la API es la autoridad.

const ROOT = process.cwd();
const routeList = readFileSync(join(ROOT, "app/api/admin/empleados/route.ts"), "utf8");
const routeId = readFileSync(join(ROOT, "app/api/admin/empleados/[id]/route.ts"), "utf8");

// Extrae el cuerpo de un handler exportado (GET/POST/PATCH) hasta el próximo export.
function cuerpoHandler(src: string, metodo: string): string {
  const re = new RegExp(`export async function ${metodo}\\b`);
  const m = src.match(re);
  assert.ok(m, `existe handler ${metodo}`);
  const start = m!.index!;
  const rest = src.slice(start + 1);
  const next = rest.search(/export async function /);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

// GET (listar) → lectura para staff + admin.
const get = cuerpoHandler(routeList, "GET");
assert.ok(/requireStaffOrAdmin\(\)/.test(get), "GET usa requireStaffOrAdmin");
assert.ok(/if \(!auth\.ok\) return auth\.response/.test(get), "GET corta si el guard falla");

// POST (crear) → solo admin.
const post = cuerpoHandler(routeList, "POST");
assert.ok(/requireAdmin\(\)/.test(post), "POST usa requireAdmin");
assert.ok(!/requireStaffOrAdmin/.test(post), "POST NO usa requireStaffOrAdmin");
assert.ok(/if \(!auth\.ok\) return auth\.response/.test(post), "POST corta si el guard falla");

// PATCH (editar/archivar/reactivar) → solo admin.
const patch = cuerpoHandler(routeId, "PATCH");
assert.ok(/requireAdmin\(\)/.test(patch), "PATCH usa requireAdmin");
assert.ok(!/requireStaffOrAdmin/.test(patch), "PATCH NO usa requireStaffOrAdmin");
assert.ok(/if \(!auth\.ok\) return auth\.response/.test(patch), "PATCH corta si el guard falla");
// Las tres acciones de mutación existen bajo el mismo guard admin.
for (const accion of ["editar", "archivar", "reactivar"]) {
  assert.ok(new RegExp(`"${accion}"`).test(patch), `PATCH maneja accion ${accion}`);
}

console.log("OK — empleados (auth wiring): GET=requireStaffOrAdmin; POST y PATCH (editar/archivar/reactivar)=requireAdmin.");
