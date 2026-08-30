import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/cronogramaAuth.test.ts
// Cableado de autorización del Cronograma: lectura mensual admin+staff; toda
// mutación y el historial, solo admin. La API es la autoridad (no la UI).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function cuerpoHandler(src: string, metodo: string): string {
  const m = src.match(new RegExp(`export async function ${metodo}\\b`));
  assert.ok(m, `existe handler ${metodo}`);
  const start = m!.index!;
  const rest = src.slice(start + 1);
  const next = rest.search(/export async function /);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const routeMes = read("app/api/admin/cronograma/route.ts");
const routeDia = read("app/api/admin/cronograma/dia/route.ts");
const routeConfirmar = read("app/api/admin/cronograma/confirmar/route.ts");
const routeHist = read("app/api/admin/cronograma/historial/route.ts");
const routeReabrir = read("app/api/admin/cronograma/reabrir/route.ts");
const routeDescartar = read("app/api/admin/cronograma/descartar/route.ts");

// GET mensual → staff + admin.
const get = cuerpoHandler(routeMes, "GET");
assert.ok(/requireStaffOrAdmin\(\)/.test(get), "GET mensual usa requireStaffOrAdmin");
// Y el gating de borrador para staff está presente.
assert.ok(/role !== "admin"/.test(get) && /confirmado/.test(get), "GET oculta borradores a staff");

// POST crear borrador → admin.
const post = cuerpoHandler(routeMes, "POST");
assert.ok(/requireAdmin\(\)/.test(post) && !/requireStaffOrAdmin/.test(post), "POST crear borrador = admin");

// PUT guardar día → admin.
const put = cuerpoHandler(routeDia, "PUT");
assert.ok(/requireAdmin\(\)/.test(put) && !/requireStaffOrAdmin/.test(put), "PUT guardar día = admin");

// POST confirmar → admin.
const confirmar = cuerpoHandler(routeConfirmar, "POST");
assert.ok(/requireAdmin\(\)/.test(confirmar) && !/requireStaffOrAdmin/.test(confirmar), "POST confirmar = admin");

// GET historial → admin (NUNCA staff).
const hist = cuerpoHandler(routeHist, "GET");
assert.ok(/requireAdmin\(\)/.test(hist) && !/requireStaffOrAdmin/.test(hist), "GET historial = admin");

// POST reabrir / descartar → admin.
const reabrir = cuerpoHandler(routeReabrir, "POST");
assert.ok(/requireAdmin\(\)/.test(reabrir) && !/requireStaffOrAdmin/.test(reabrir), "POST reabrir = admin");
const descartar = cuerpoHandler(routeDescartar, "POST");
assert.ok(/requireAdmin\(\)/.test(descartar) && !/requireStaffOrAdmin/.test(descartar), "POST descartar = admin");

// Todos cortan si el guard falla.
for (const [nombre, cuerpo] of [["GET", get], ["POST", post], ["PUT", put], ["confirmar", confirmar], ["historial", hist], ["reabrir", reabrir], ["descartar", descartar]] as const) {
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(cuerpo), `${nombre} corta si el guard falla`);
}

console.log("OK — cronograma (auth wiring): GET mensual=staff+admin (borrador oculto a staff); POST/PUT/confirmar/historial/reabrir/descartar=admin.");
