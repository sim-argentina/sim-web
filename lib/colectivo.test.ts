import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PERSONAS_COLECTIVO, turnosColectivo, normalizarPersonasColectivo, normalizarHoraOpcional,
  CANTIDADES_VENTA_COLECTIVO, normalizarCantidadVentaColectivo,
  esVendibleEnEvento, resumirVentasPorProducto, COLUMNAS_TURNO_COLECTIVO, COLUMNAS_VENTA_COLECTIVO,
} from "@/lib/colectivo";

// Colectivo — turnos = personas, horarios opcionales y catálogo de productos.
// Ejecutar: npx tsx lib/colectivo.test.ts
// Pura: no toca ninguna base ni la red.

// ── 1) turnos = personas, independiente de la duración ──────────────────────
assert.deepEqual([...PERSONAS_COLECTIVO], [1, 2, 3, 4, 5, 6], "el selector ofrece exactamente 1..6");
for (const p of PERSONAS_COLECTIVO) assert.equal(turnosColectivo(p), p, `${p} personas → ${p} turnos`);
// 4 personas durante 30' siguen siendo 4 turnos (no 12): la duración no entra en la cuenta.
assert.equal(turnosColectivo(4), 4);
assert.equal(turnosColectivo.length, 1, "turnosColectivo no recibe minutos");
console.log("OK — turnos = personas (1..6), la duración no cambia la cantidad de turnos.");

// ── 2) personas: 1..6; un histórico mayor solo si no cambia ─────────────────
for (const p of [1, 2, 3, 4, 5, 6]) assert.equal(normalizarPersonasColectivo(p), p);
assert.equal(normalizarPersonasColectivo("4"), 4, "acepta el valor de un select");
for (const malo of [0, -1, 7, 12, 2.5, NaN, "x", "", null, undefined, true, {}]) {
  assert.equal(normalizarPersonasColectivo(malo), null, `rechaza ${String(malo)}`);
}
assert.equal(normalizarPersonasColectivo(8, 8), 8, "un turno histórico de 8 se edita sin cambiar personas");
assert.equal(normalizarPersonasColectivo(8, 6), null, "no se puede SUBIR a 8");
assert.equal(normalizarPersonasColectivo(12, 8), null, "ni cambiar un histórico por otro valor fuera de rango");
assert.equal(normalizarPersonasColectivo(3, 8), 3, "un histórico se puede bajar a 1..6");
console.log("OK — personas 1..6; los históricos de más de 6 se conservan solo si no cambian.");

// ── 2b) cantidad de una venta: 1..20; una histórica mayor solo si no cambia ──
assert.deepEqual([...CANTIDADES_VENTA_COLECTIVO], Array.from({ length: 20 }, (_, i) => i + 1), "el selector ofrece exactamente 1..20");
for (const c of CANTIDADES_VENTA_COLECTIVO) assert.equal(normalizarCantidadVentaColectivo(c), c);
assert.equal(normalizarCantidadVentaColectivo("20"), 20, "acepta el valor de un select");
for (const malo of [0, -1, 21, 100, 1.5, NaN, "x", "", null, undefined, true, {}]) {
  assert.equal(normalizarCantidadVentaColectivo(malo), null, `rechaza ${String(malo)}`);
}
assert.equal(normalizarCantidadVentaColectivo(25, 25), 25, "una venta histórica de 25 se edita sin cambiar la cantidad");
assert.equal(normalizarCantidadVentaColectivo(25, 20), null, "no se puede SUBIR a 25");
assert.equal(normalizarCantidadVentaColectivo(30, 25), null, "ni cambiar una histórica por otro valor fuera de rango");
assert.equal(normalizarCantidadVentaColectivo(3, 25), 3, "una histórica se puede bajar a 1..20");
console.log("OK — cantidad de venta 1..20; las históricas de más de 20 se conservan solo si no cambian.");

// ── 3) subida y bajada opcionales ───────────────────────────────────────────
for (const vacia of [undefined, null, "", "   "]) assert.deepEqual(normalizarHoraOpcional(vacia), { ok: true, hora: null });
assert.deepEqual(normalizarHoraOpcional("14:05"), { ok: true, hora: "14:05" });
assert.deepEqual(normalizarHoraOpcional("09:30:59"), { ok: true, hora: "09:30" });
assert.deepEqual(normalizarHoraOpcional("00:00"), { ok: true, hora: "00:00" });
for (const mala of ["24:00", "9:30", "12:60", "abc", "12:30pm", 1230, {}]) {
  assert.deepEqual(normalizarHoraOpcional(mala), { ok: false }, `rechaza ${String(mala)}`);
}
console.log("OK — hora de subida/bajada: vacía no bloquea; una hora mal formada se rechaza.");

// ── 4) vendible = activo en catálogo Y habilitado en el evento ──────────────
assert.equal(esVendibleEnEvento({ activo: true, habilitado: true }), true);
assert.equal(esVendibleEnEvento({ activo: true, habilitado: false }), false, "deshabilitado en el evento");
assert.equal(esVendibleEnEvento({ activo: false, habilitado: true }), false, "inactivo en el catálogo");
assert.equal(esVendibleEnEvento({ activo: false, habilitado: false }), false);
console.log("OK — vendible solo si está activo en el catálogo y habilitado en el evento.");

// ── 5) resumen por producto: dinámico, con lo que dice cada venta ───────────
const resumen = resumirVentasPorProducto([
  { producto_nombre: "Gorra", cantidad: 2, total: 40000, estado: "activa" },
  { producto_nombre: "Gorra", cantidad: 1, total: 20000, estado: "activa" },
  { producto_nombre: "Buzo", cantidad: 1, total: 50000, estado: "activa" },
  { producto_nombre: "Remera", cantidad: 4, total: 100000, estado: "activa" },
  { producto_nombre: "Sticker", cantidad: 3, total: 0, estado: "bonificada" },
  { producto_nombre: "Remera", cantidad: 9, total: 225000, estado: "anulada" },
]);
assert.deepEqual(resumen, [
  { nombre: "Remera", unidades: 4, total: 100000 },
  { nombre: "Gorra", unidades: 3, total: 60000 },
  { nombre: "Buzo", unidades: 1, total: 50000 },
  { nombre: "Sticker", unidades: 3, total: 0 },
], "cada producto vendido aparece solo; bonificadas suman unidades sin plata; anuladas no cuentan");
assert.deepEqual(resumirVentasPorProducto([]), []);
console.log("OK — resumen por producto dinámico (Gorra, Buzo, Remera, Sticker) sin nombres fijos.");

// ── 6) contratos de fuente ──────────────────────────────────────────────────
const leer = (p: string) => readFileSync(p, "utf8");
function archivos(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const fuentesColectivo = [
  ...archivos("app/admin/(panel)/colectivo"),
  ...archivos("app/api/admin/colectivo"),
  "lib/colectivo.ts",
  "lib/colectivoProductos.ts",
];
assert.ok(fuentesColectivo.length >= 12, "encontró las fuentes del Colectivo");

// Sin productos fijos en el código: el catálogo vive en la base.
for (const f of fuentesColectivo) {
  assert.ok(!/gorra|buzo/i.test(leer(f)), `${f} no nombra productos fijos`);
}

// Ni el turnero ni la venta de productos piden o muestran datos de la persona:
// turnos sin cliente, teléfono ni hora estimada; ventas sin comprador ni teléfono.
const paginaEvento = leer("app/admin/(panel)/colectivo/eventos/[eventoId]/page.tsx");
const seccion = (desde: string, hasta: string) => {
  const a = paginaEvento.indexOf(desde), b = paginaEvento.indexOf(hasta);
  assert.ok(a >= 0 && b > a, `sección ${desde}`);
  return paginaEvento.slice(a, b);
};
const turnero = seccion("// ═════════ Formulario de turno", "// ═════════ Venta de productos");
const tipoTurno = /type Turno = \{[\s\S]*?\};/.exec(paginaEvento)?.[0] ?? "";
assert.ok(tipoTurno, "tipo Turno");
for (const prohibido of [/hora_estimada/, /Hora estimada/i, /Sin identificar/i, /\bCliente\b/i, /Teléfono/i, /\btelefono\b/, /\bnombre\b/, /\bsetNombre\b/]) {
  assert.ok(!prohibido.test(turnero), `el turnero (formulario, tabla y resumen del día) no contiene ${prohibido}`);
  assert.ok(!prohibido.test(tipoTurno), `el tipo Turno no contiene ${prohibido}`);
}
const ventasUi = seccion("// ═════════ Venta de productos", "// ═════════ Resumen general del evento");
const tipoVenta = /type Venta = \{[\s\S]*?\};/.exec(paginaEvento)?.[0] ?? "";
assert.ok(tipoVenta, "tipo Venta");
for (const prohibido of [/Comprador/i, /Teléfono/i, /\bcliente\b/i, /\btelefono\b/, /setCliente|setTelefono/, /Sin identificar/i]) {
  assert.ok(!prohibido.test(ventasUi), `la venta de productos (formulario, edición y tabla) no contiene ${prohibido}`);
  assert.ok(!prohibido.test(tipoVenta), `el tipo Venta no contiene ${prohibido}`);
}
for (const f of ["app/api/admin/colectivo/eventos/[id]/turnos/route.ts", "app/api/admin/colectivo/turnos/[id]/route.ts"]) {
  const s = leer(f);
  assert.ok(!/hora_estimada_subida:|\bnombre:|\btelefono:/.test(s), `${f} no escribe columnas legacy de turnos`);
}
for (const f of ["app/api/admin/colectivo/eventos/[id]/ventas/route.ts", "app/api/admin/colectivo/ventas/[id]/route.ts"]) {
  const s = leer(f);
  assert.ok(!/\bcliente:|\btelefono:|body\.cliente|body\.telefono/.test(s), `${f} no acepta ni escribe comprador/teléfono`);
  assert.ok(/normalizarCantidadVentaColectivo\(body\.cantidad/.test(s) && !/Number\(body\.cantidad\)/.test(s), `${f} valida la cantidad 1..20 en el servidor`);
}
assert.ok(/normalizarCantidadVentaColectivo\(body\.cantidad, Number\(venta\.cantidad\)/.test(leer("app/api/admin/colectivo/ventas/[id]/route.ts")),
  "la edición compara contra la cantidad guardada (compatibilidad histórica)");
// Cantidad: selector 1..20 (no input numérico) que recalcula el subtotal.
const campoCantidad = /<Campo label="Cantidad">[\s\S]*?<\/Campo>/.exec(ventasUi)?.[0] ?? "";
assert.ok(/<select value=\{cantidad\} onChange=\{\(e\) => cambiarCantidad\(Number\(e\.target\.value\)\)\}/.test(campoCantidad), "Cantidad es un select");
assert.ok(/opcionesCantidad\.map/.test(campoCantidad) && !/type="number"/.test(campoCantidad), "Cantidad usa las opciones 1..20, sin input numérico");
assert.ok(/const total = useMemo\(\(\) => Math\.round\(cantidad \* precio\), \[cantidad, precio\]\)/.test(ventasUi), "subtotal = cantidad × precio unitario");
assert.ok(/Pagos \(deben sumar \{dinero\(total\)\}\)/.test(ventasUi), "lo que deben sumar los pagos es ese subtotal");
assert.ok(!/nombre|telefono|hora_estimada/.test(COLUMNAS_TURNO_COLECTIVO), "la API de turnos no devuelve columnas legacy");
assert.ok(!/cliente|telefono/.test(COLUMNAS_VENTA_COLECTIVO), "la API de ventas no devuelve comprador ni teléfono");

// turnos = personas en el servidor: las dos rutas que escriben lo imponen e ignoran cantidad_turnos del cliente.
for (const f of ["app/api/admin/colectivo/eventos/[id]/turnos/route.ts", "app/api/admin/colectivo/turnos/[id]/route.ts"]) {
  const s = leer(f);
  assert.ok(/cantidad_turnos: turnosColectivo\(personas\)/.test(s), `${f} guarda turnos = personas`);
  assert.ok(!/body\.cantidad_turnos/.test(s), `${f} no lee cantidad_turnos del cliente`);
}

// Permisos: catálogo y disponibilidad por evento exigen admin en el servidor.
const rutaCatalogo = leer("app/api/admin/colectivo/productos/route.ts");
assert.ok(!/requireStaffOrAdmin/.test(rutaCatalogo), "el catálogo no admite staff");
assert.equal((rutaCatalogo.match(/await requireAdmin\(\)/g) ?? []).length, 4, "GET, POST, PATCH y DELETE del catálogo exigen admin");
const rutaEvento = leer("app/api/admin/colectivo/eventos/[id]/productos/route.ts");
assert.ok(/export async function PATCH[\s\S]*?await requireAdmin\(\)/.test(rutaEvento), "habilitar/deshabilitar en un evento exige admin");
assert.ok(/export async function GET[\s\S]*?await requireStaffOrAdmin\(\)/.test(rutaEvento), "el staff puede leer los productos vendibles");

// Finanzas SIM no conoce al Colectivo.
const fuentesFinanzas = [
  ...archivos("app/api/admin/finanzas"),
  ...archivos("app/admin/(panel)/finanzas"),
  ...readdirSync("lib").filter((n) => /^(finanzas|facturacion)/i.test(n) && !/\.(test|integration)\.ts$/.test(n)).map((n) => join("lib", n)),
];
assert.ok(fuentesFinanzas.length > 0, "encontró las fuentes de Finanzas");
for (const f of fuentesFinanzas) {
  // Un literal con el nombre de una tabla (los comentarios que aclaran la separación no cuentan).
  assert.ok(!/["'`]colectivo_\w+/i.test(leer(f)), `${f} no consulta tablas colectivo_*`);
}
console.log(`OK — contratos de fuente: sin productos fijos, turnero y ventas sin datos de la persona, turnos = personas en el servidor, permisos de admin y Finanzas sin colectivo_* (${fuentesColectivo.length} + ${fuentesFinanzas.length} archivos).`);
