import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PERSONAS_COLECTIVO, turnosColectivo, normalizarPersonasColectivo, normalizarHoraOpcional,
  CANTIDADES_VENTA_COLECTIVO, normalizarCantidadVentaColectivo,
  esVendibleEnEvento, resumirVentasPorProducto, COLUMNAS_TURNO_COLECTIVO, COLUMNAS_VENTA_COLECTIVO,
  normalizarMovimientoCaja, calcularCajaEvento, MEDIOS_PAGO_GASTO_COLECTIVO, COLUMNAS_GASTO_COLECTIVO,
  TIPOS_CAJA, esTipoCaja, normalizarNombreCategoriaCaja, claveCategoriaCaja,
  armarInformeEvento, turnoFacturable, ventaFacturable, movimientoVigente, etiquetaMetodoCobro, SIN_DETALLE_PAGO,
  type InformeEvento,
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

// ── 5b) caja del evento: validación del movimiento ──────────────────────────
assert.deepEqual(MEDIOS_PAGO_GASTO_COLECTIVO.map((m) => m.label), ["Efectivo", "Transferencia", "Tarjeta", "Otro"]);
assert.deepEqual(TIPOS_CAJA.map((t) => t.value), ["costo", "gasto"]);
assert.ok(esTipoCaja("costo") && esTipoCaja("gasto") && !esTipoCaja("COSTO") && !esTipoCaja("") && !esTipoCaja(null));
const CAT = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";
const gastoOk = { fecha: "2026-10-14", categoria_id: CAT, concepto: "  Nafta   ida  ", monto: "45320.505", medio_pago: "efectivo", observaciones: "  ", tipo: "gasto" };
const g1 = normalizarMovimientoCaja(gastoOk);
assert.ok(g1.ok);
// El tipo que mande el cliente no se toma: sale de la categoría en el servidor.
if (g1.ok) assert.deepEqual(g1.movimiento, { fecha: "2026-10-14", categoria_id: CAT, concepto: "Nafta ida", monto: 45320.51, medio_pago: "efectivo", observaciones: null });
const malos: [Record<string, unknown>, RegExp][] = [
  [{ fecha: "" }, /fecha/], [{ fecha: "2026-02-31" }, /fecha/], [{ fecha: "14/10/2026" }, /fecha/],
  [{ categoria_id: "" }, /categoría/], [{ categoria_id: "combustible" }, /categoría/], [{ categoria_id: null }, /categoría/],
  [{ concepto: "   " }, /concepto/], [{ concepto: "x".repeat(121) }, /concepto/],
  [{ monto: 0 }, /mayor a 0/], [{ monto: -10 }, /mayor a 0/], [{ monto: "" }, /mayor a 0/], [{ monto: "abc" }, /mayor a 0/],
  [{ monto: 0.001 }, /mayor a 0/], [{ monto: 100_000_001 }, /rango/],
  [{ medio_pago: "" }, /medio de pago/], [{ medio_pago: "cheque" }, /medio de pago/],
  [{ observaciones: "x".repeat(501) }, /observaciones/],
];
for (const [cambio, re] of malos) {
  const r = normalizarMovimientoCaja({ ...gastoOk, ...cambio });
  assert.ok(!r.ok && re.test(r.error), `rechaza ${JSON.stringify(cambio).slice(0, 60)} → ${r.ok ? "aceptado" : r.error}`);
}
assert.ok(!normalizarMovimientoCaja(null).ok && !normalizarMovimientoCaja("x").ok);
console.log("OK — movimiento de caja: fecha real, categoría (id), medio de la lista, concepto, monto > 0 (2 decimales); el tipo no lo elige el cliente.");

// ── 5c) categorías de caja: nombre y duplicados ─────────────────────────────
assert.equal(normalizarNombreCategoriaCaja("  Publicidad    evento  "), "Publicidad evento");
for (const malo of ["", "   ", null, 5, "x".repeat(61)]) assert.equal(normalizarNombreCategoriaCaja(malo), null, `rechaza ${String(malo).slice(0, 10)}`);
assert.equal(claveCategoriaCaja("  ALOJAMIENTO   Hotel "), claveCategoriaCaja("alojamiento hotel"), "duplicado sin distinguir mayúsculas ni espacios");
assert.notEqual(claveCategoriaCaja("Peajes"), claveCategoriaCaja("Peaje"));
console.log("OK — categorías de caja: nombre normalizado y duplicados sin distinguir mayúsculas ni espacios.");

// ── 5d) caja del evento: ingresos − costos − gastos = neto ──────────────────
const caja = calcularCajaEvento({
  turnos: [
    { total: 20000, estado: "activo", metodo_pago: "efectivo" },
    { total: "30000", estado: "activo", metodo_pago: "mixto" },
    { total: 0, estado: "activo", metodo_pago: "gratis" },
    { total: 99999, estado: "cancelado", metodo_pago: "efectivo" },
  ],
  ventas: [
    { total: 40000, estado: "activa" },
    { total: 20000, estado: "bonificada" },
    { total: 50000, estado: "anulada" },
  ],
  movimientos: [
    { monto: "15000.50", tipo: "costo" },
    { monto: 4999.5, tipo: "costo" },
    { monto: 30000, tipo: "gasto" },
    { monto: 70000, tipo: "costo", eliminado_at: "2026-10-14T18:00:00Z" },
    { monto: 9000, tipo: "gasto", eliminado_at: "2026-10-14T18:00:00Z" },
  ],
});
assert.deepEqual(caja, {
  ingresosTurnos: 50000, ingresosProductos: 40000, ingresos: 90000,
  costos: 20000, cantidadCostos: 2, gastos: 30000, cantidadGastos: 1, cantidadMovimientos: 3, neto: 40000,
}, "sin turnos cancelados ni gratis, sin ventas bonificadas ni anuladas, sin movimientos eliminados; neto = ingresos − costos − gastos");
// Ejemplo del pedido: 2.580.000 − 600.000 − 150.000 = 1.830.000.
const ejemplo = calcularCajaEvento({ turnos: [{ total: 2580000, estado: "activo" }], ventas: [], movimientos: [{ monto: 600000, tipo: "costo" }, { monto: 150000, tipo: "gasto" }] });
assert.equal(ejemplo.neto, 1830000);
assert.equal(calcularCajaEvento({ turnos: [], ventas: [], movimientos: [{ monto: 1000, tipo: "costo" }] }).neto, -1000, "el neto puede ser negativo");
assert.deepEqual(calcularCajaEvento({ turnos: [], ventas: [], movimientos: [] }), {
  ingresosTurnos: 0, ingresosProductos: 0, ingresos: 0, costos: 0, cantidadCostos: 0, gastos: 0, cantidadGastos: 0, cantidadMovimientos: 0, neto: 0,
});
assert.ok(!/eliminado/.test(COLUMNAS_GASTO_COLECTIVO), "la API no devuelve las marcas de eliminación");
assert.ok(/\btipo\b/.test(COLUMNAS_GASTO_COLECTIVO) && /categoria_nombre/.test(COLUMNAS_GASTO_COLECTIVO) && /categoria_id/.test(COLUMNAS_GASTO_COLECTIVO), "la API devuelve tipo y nombre guardados");
assert.ok(!/(^|, )categoria(,|$)/.test(COLUMNAS_GASTO_COLECTIVO), "la columna vieja `categoria` ya no se usa");
console.log("OK — caja: ingresos = turnos y ventas válidos, costos y gastos por el tipo guardado en cada movimiento, neto = ingresos − costos − gastos.");

// ── 5e) informe del evento ──────────────────────────────────────────────────
const sumaL = (l: { total: number }[]) => Math.round(l.reduce((a, x) => a + x.total, 0) * 100) / 100;
// Identidades que tiene que cumplir cualquier informe (contra la caja y entre sí).
function verificarCoherencia(inf: InformeEvento, caja: ReturnType<typeof calcularCajaEvento>, ctx: string) {
  const r = inf.resumen;
  assert.deepEqual(r, caja, `${ctx}: el informe usa exactamente el resumen de la caja`);
  assert.equal(Math.round((r.ingresosTurnos + r.ingresosProductos) * 100) / 100, r.ingresos, `${ctx}: turnos + productos = ingresos`);
  assert.equal(sumaL(inf.ingresosPorMetodo), r.ingresos, `${ctx}: Σ métodos de cobro = ingresos`);
  assert.equal(sumaL(inf.costosPorCategoria), r.costos, `${ctx}: Σ categorías de costos = costos`);
  assert.equal(sumaL(inf.gastosPorCategoria), r.gastos, `${ctx}: Σ categorías de gastos = gastos`);
  assert.equal(inf.egresos, Math.round((r.costos + r.gastos) * 100) / 100, `${ctx}: costos + gastos = egresos`);
  assert.equal(sumaL(inf.egresosPorMedio), inf.egresos, `${ctx}: Σ medios de pago de egresos = egresos`);
  assert.equal(Math.round((r.ingresos - inf.egresos) * 100) / 100, r.neto, `${ctx}: ingresos − egresos = neto`);
  assert.equal(inf.turnos.facturacion, r.ingresosTurnos, `${ctx}: facturación de turnos = caja`);
  assert.equal(inf.productos.facturacion, r.ingresosProductos, `${ctx}: facturación de productos = caja`);
  assert.equal(sumaL(inf.productos.items), r.ingresosProductos, `${ctx}: Σ productos = facturación de productos`);
  if (r.ingresos > 0) assert.equal(inf.margen, Math.round((r.neto / r.ingresos) * 1000) / 10, `${ctx}: margen`);
  else assert.equal(inf.margen, null, `${ctx}: sin ingresos no hay margen`);
}

const datosInforme = {
  turnos: [
    { total: 20000, estado: "activo", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 20000 }], cantidad_turnos: 2, cantidad_personas: 2, cantidad_minutos: 10 },
    // pago dividido
    { total: 40000, estado: "activo", metodo_pago: "mixto", pagos_detalle: [{ metodo_pago: "qr", monto: 25000 }, { metodo_pago: "transferencia", monto: 15000 }], cantidad_turnos: 4, cantidad_personas: 4, cantidad_minutos: 20 },
    // pagos como texto JSON (filas viejas)
    { total: 10000, estado: "activo", metodo_pago: "debito", pagos_detalle: JSON.stringify([{ metodo_pago: "debito", monto: 10000 }]), cantidad_turnos: 1, cantidad_personas: 1, cantidad_minutos: 10 },
    { total: 0, estado: "activo", metodo_pago: "gratis", pagos_detalle: [], cantidad_turnos: 1, cantidad_personas: 1, cantidad_minutos: 10 },
    { total: 99999, estado: "cancelado", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 99999 }], cantidad_turnos: 5, cantidad_personas: 5, cantidad_minutos: 30 },
  ],
  ventas: [
    { total: 40000, estado: "activa", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 40000 }], producto_nombre: "Gorra", cantidad: 2 },
    { total: 50000, estado: "activa", metodo_pago: "mixto", pagos_detalle: [{ metodo_pago: "credito", monto: 30000 }, { metodo_pago: "efectivo", monto: 20000 }], producto_nombre: "Buzo", cantidad: 1 },
    { total: 20000, estado: "bonificada", metodo_pago: null, pagos_detalle: [], producto_nombre: "Gorra", cantidad: 1 },
    { total: 50000, estado: "anulada", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 50000 }], producto_nombre: "Buzo", cantidad: 1 },
  ],
  movimientos: [
    { monto: 30000, tipo: "costo", categoria_nombre: "Combustible", medio_pago: "efectivo" },
    { monto: "12500.50", tipo: "costo", categoria_nombre: "Peajes", medio_pago: "tarjeta" },
    { monto: 8000, tipo: "costo", categoria_nombre: "Combustible", medio_pago: "transferencia" },
    // nombre y tipo históricos: hoy la categoría puede llamarse distinto o ser gasto
    { monto: 15000, tipo: "costo", categoria_nombre: "Alojamiento", medio_pago: "efectivo" },
    { monto: 9000, tipo: "gasto", categoria_nombre: "Publicidad evento", medio_pago: "transferencia" },
    { monto: 2000, tipo: "gasto", categoria_nombre: "Otros", medio_pago: "otro" },
    { monto: 70000, tipo: "gasto", categoria_nombre: "Otros", medio_pago: "efectivo", eliminado_at: "2026-10-14T10:00:00Z" },
  ],
};
const inf = armarInformeEvento(datosInforme);
verificarCoherencia(inf, calcularCajaEvento(datosInforme), "escenario");
assert.deepEqual([inf.resumen.ingresosTurnos, inf.resumen.ingresosProductos, inf.resumen.ingresos], [70000, 90000, 160000], "sin gratis, cancelados, bonificadas ni anuladas");
assert.deepEqual([inf.resumen.costos, inf.resumen.gastos, inf.egresos, inf.resumen.neto], [65500.5, 11000, 76500.5, 83499.5]);
assert.equal(inf.margen, 52.2, "83.499,50 / 160.000 = 52,2 %");
assert.deepEqual(inf.ingresosPorMetodo.map((l) => [l.etiqueta, l.total]), [
  ["Efectivo", 80000], ["QR / MP", 25000], ["Crédito", 30000], ["Transferencia", 15000], ["Débito", 10000],
].sort((a, b) => (b[1] as number) - (a[1] as number)), "pagos divididos repartidos por método; JSON en texto incluido");
assert.deepEqual(inf.costosPorCategoria.map((l) => [l.etiqueta, l.total, l.cantidad]), [["Combustible", 38000, 2], ["Alojamiento", 15000, 1], ["Peajes", 12500.5, 1]]);
assert.deepEqual(inf.gastosPorCategoria.map((l) => [l.etiqueta, l.total]), [["Publicidad evento", 9000], ["Otros", 2000]], "el movimiento eliminado no cuenta");
assert.deepEqual(inf.egresosPorMedio.map((l) => [l.etiqueta, l.total]), [["Efectivo", 45000], ["Transferencia", 17000], ["Tarjeta", 12500.5], ["Otro", 2000]]);
assert.deepEqual(inf.turnos, { facturacion: 70000, cantidad: 8, gratis: 1, personas: 8, minutos: 120, porDuracion: [{ minutos: 10, turnos: 4 }, { minutos: 20, turnos: 4 }] },
  "actividad sin cancelados (el gratis se jugó); minutos = minutos × turnos");
assert.deepEqual(inf.productos, {
  items: [{ nombre: "Buzo", unidades: 1, bonificadas: 0, total: 50000 }, { nombre: "Gorra", unidades: 2, bonificadas: 1, total: 40000 }],
  unidades: 3, bonificadas: 1, facturacion: 90000,
}, "bonificadas aparte y sin ingreso; anuladas fuera");

// Ejemplo del pedido: 2.580.000 − 600.000 − 150.000 = 1.830.000, margen 70,9 %.
const infEj = armarInformeEvento({ turnos: [{ total: 2580000, estado: "activo", metodo_pago: "efectivo", pagos_detalle: [] }], ventas: [],
  movimientos: [{ monto: 600000, tipo: "costo", categoria_nombre: "Personal", medio_pago: "transferencia" }, { monto: 150000, tipo: "gasto", categoria_nombre: "Publicidad", medio_pago: "efectivo" }] });
assert.equal(infEj.resumen.neto, 1830000); assert.equal(infEj.margen, 70.9);
assert.deepEqual(infEj.ingresosPorMetodo.map((l) => [l.clave, l.total]), [["efectivo", 2580000]], "sin pagos registrados: el total va al método principal");
// Sin ingresos: margen "—" (null), nunca división por cero; neto negativo.
const sinIngresos = { turnos: [], ventas: [], movimientos: [{ monto: 5000, tipo: "costo", categoria_nombre: "Combustible", medio_pago: "efectivo" }] };
const infCero = armarInformeEvento(sinIngresos);
assert.equal(infCero.margen, null); assert.equal(infCero.resumen.neto, -5000);
verificarCoherencia(infCero, calcularCajaEvento(sinIngresos), "sin ingresos");
// Pagos que no cierran con el total: el total manda y va a "sin detalle" (la suma sigue cerrando).
const infRaro = armarInformeEvento({ turnos: [{ total: 10000, estado: "activo", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 7000 }] }], ventas: [], movimientos: [] });
assert.deepEqual(infRaro.ingresosPorMetodo.map((l) => [l.clave, l.total]), [[SIN_DETALLE_PAGO, 10000]]);
assert.equal(etiquetaMetodoCobro("qr"), "QR / MP"); assert.equal(etiquetaMetodoCobro("cheque"), "cheque", "un método no previsto se muestra tal cual");
assert.ok(turnoFacturable({ estado: "activo", metodo_pago: "qr" }) && !turnoFacturable({ estado: "activo", metodo_pago: "gratis" }) && !turnoFacturable({ estado: "cancelado", metodo_pago: "qr" }));
assert.ok(ventaFacturable({ estado: "activa" }) && !ventaFacturable({ estado: "bonificada" }) && !ventaFacturable({ estado: "anulada" }));
assert.ok(movimientoVigente({}) && !movimientoVigente({ eliminado_at: "2026-10-14T00:00:00Z" }));

// Propiedad: con cualquier combinación de registros las identidades se cumplen.
let semilla = 20261014;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const elegir = <T,>(l: readonly T[]) => l[Math.floor(azar() * l.length)];
const metodos = ["efectivo", "qr", "debito", "credito", "transferencia"] as const;
const pagosAzar = (total: number) => {
  if (total === 0) return [];
  if (azar() < 0.4) { const a = Math.round(total * azar() * 100) / 100; return [{ metodo_pago: elegir(metodos), monto: a }, { metodo_pago: elegir(metodos), monto: Math.round((total - a) * 100) / 100 }].filter((p) => p.monto > 0); }
  return [{ metodo_pago: elegir(metodos), monto: total }];
};
for (let i = 0; i < 300; i++) {
  const turnos = Array.from({ length: Math.floor(azar() * 8) }, () => {
    const gratis = azar() < 0.15; const total = gratis ? 0 : Math.round(azar() * 80) * 1000;
    return { total, estado: azar() < 0.1 ? "cancelado" : "activo", metodo_pago: gratis ? "gratis" : elegir(metodos), pagos_detalle: pagosAzar(total), cantidad_turnos: 1 + Math.floor(azar() * 6), cantidad_personas: 1 + Math.floor(azar() * 6), cantidad_minutos: elegir([10, 20, 30]) };
  });
  const ventas = Array.from({ length: Math.floor(azar() * 6) }, () => {
    const estado = elegir(["activa", "activa", "bonificada", "anulada"]); const total = Math.round(azar() * 100) * 500;
    return { total, estado, metodo_pago: "efectivo", pagos_detalle: estado === "bonificada" ? [] : pagosAzar(total), producto_nombre: elegir(["Gorra", "Buzo", "Remera"]), cantidad: 1 + Math.floor(azar() * 5) };
  });
  const movimientos = Array.from({ length: Math.floor(azar() * 7) }, () => ({
    monto: Math.round(azar() * 5000000) / 100, tipo: elegir(["costo", "gasto"]), categoria_nombre: elegir(["Combustible", "Peajes", "Otros", "Publicidad"]),
    medio_pago: elegir(["efectivo", "transferencia", "tarjeta", "otro"]), eliminado_at: azar() < 0.15 ? "2026-10-14T00:00:00Z" : null,
  }));
  const d = { turnos, ventas, movimientos };
  verificarCoherencia(armarInformeEvento(d), calcularCajaEvento(d), `caso ${i}`);
}
console.log("OK — informe: = caja; turnos + productos = ingresos = Σ métodos (pagos divididos); Σ categorías = costos/gastos; Σ medios = egresos; margen y '—' sin ingresos; 300 eventos al azar coherentes.");

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
  "lib/colectivoCaja.ts",
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
// Caja: rutas para admin y staff, separada de Finanzas y con su aviso.
const rutasCaja = ["app/api/admin/colectivo/eventos/[id]/caja/route.ts", "app/api/admin/colectivo/gastos/[id]/route.ts"];
for (const f of rutasCaja) {
  const s = leer(f);
  assert.ok(/requireStaffOrAdmin/.test(s) && !/requireAdmin\b/.test(s), `${f}: admin y staff`);
  assert.ok(/no forma parte de Finanzas SIM/.test(s), `${f}: declara que la caja no es Finanzas`);
  assert.ok(!/fin_[a-z]/.test(s.replace(/fin_\*/g, "")), `${f}: no toca tablas ni funciones fin_*`);
}
assert.ok(/eliminado_at: ahora, eliminado_por: auth\.role/.test(leer(rutasCaja[1])) && !/\.delete\(\)/.test(leer(rutasCaja[1])), "eliminar un movimiento es lógico");
// El tipo sale de la categoría: el alta lo toma del catálogo; la edición lo
// conserva salvo que cambie la categoría. Ninguna ruta lee body.tipo.
assert.ok(/tipo: cat\.valor\.tipo/.test(leer(rutasCaja[0])) && /categoria_nombre: cat\.valor\.nombre/.test(leer(rutasCaja[0])), "el alta guarda tipo y nombre de la categoría");
assert.ok(/r\.movimiento\.categoria_id !== m\.mov\.categoria_id/.test(leer(rutasCaja[1])), "la edición conserva tipo y nombre si no cambia la categoría");
for (const f of rutasCaja) assert.ok(!/body\.tipo/.test(leer(f)), `${f}: el cliente no elige costo/gasto`);
// Categorías: solo admin en el servidor, y separadas de Finanzas.
const rutaCategorias = leer("app/api/admin/colectivo/caja-categorias/route.ts");
assert.ok(!/requireStaffOrAdmin/.test(rutaCategorias), "las categorías de caja no admiten staff");
assert.equal((rutaCategorias.match(/await requireAdmin\(\)/g) ?? []).length, 4, "GET, POST, PATCH y DELETE de categorías exigen admin");
assert.ok(!/fin_[a-z]/.test(rutaCategorias.replace(/fin_\*/g, "").replace(/fin_categorias/g, "")) && !/from\("fin_/.test(rutaCategorias), "las categorías de caja no tocan Finanzas");
// Sin categorías fijas en el código: viven en la base (la siembra es solo la migración).
for (const f of fuentesColectivo) {
  assert.ok(!/Combustible|Peajes|Estacionamiento|Insumos/.test(leer(f)), `${f} no nombra categorías de caja fijas`);
}
const cajaUi = seccion("// ═════════ Caja del evento", "// ─── UI compartida");
for (const texto of ["Caja del evento", "Uso interno del Colectivo. No impacta en Finanzas SIM.", ">Ingresos<", ">Costos<", ">Gastos<", ">Neto<", "Ingresos − costos − gastos",
  "Registrar costo / gasto", "Movimientos de caja", "Total costos", "Total gastos", "Resultado final", "Movimientos registrados", "Todas las categorías"]) {
  assert.ok(cajaUi.includes(texto), `la caja muestra «${texto}»`);
}
assert.ok(!/Gastos cargados|Agregar gasto|Registrar gasto/.test(cajaUi), "la caja ya no habla solo de gastos");
assert.ok(/\{ value: "caja", label: "Caja" \}/.test(paginaEvento) && /\{ value: "turnero", label: "Turnero" \}/.test(paginaEvento) && /\{ value: "productos", label: "Productos" \}/.test(paginaEvento), "pestañas Turnero, Productos y Caja");
assert.ok(/colectivo_gastos/.test(leer("app/api/admin/colectivo/eventos/[id]/route.ts")), "un evento con gastos vigentes no se puede eliminar");

// Informe: solo lectura, admin y staff, mismas reglas que la caja, sin Finanzas.
const rutaInforme = leer("app/api/admin/colectivo/eventos/[id]/informe/route.ts");
assert.ok(/requireStaffOrAdmin/.test(rutaInforme) && /armarInformeEvento/.test(rutaInforme), "informe: admin y staff, armado con la función central");
assert.ok(!/\.(insert|update|upsert|delete)\(/.test(rutaInforme), "informe: solo lectura");
assert.ok(/no forma parte de Finanzas SIM/.test(rutaInforme) && !/fin_[a-z]/.test(rutaInforme.replace(/fin_\*/g, "")), "informe: sin Finanzas");
assert.ok(/\.is\("eliminado_at", null\)/.test(rutaInforme), "informe: sin movimientos eliminados");
// Una sola definición de las reglas de facturación: nadie más las reescribe.
const libColectivo = leer("lib/colectivo.ts");
assert.equal((libColectivo.match(/t\.estado !== "cancelado" && t\.metodo_pago !== "gratis"/g) ?? []).length, 1, "la regla del turno facturable existe una sola vez");
assert.ok(/\.filter\(turnoFacturable\)/.test(libColectivo) && /\.filter\(ventaFacturable\)/.test(libColectivo) && /\.filter\(movimientoVigente\)/.test(libColectivo));
assert.ok(/const resumen = calcularCajaEvento\(datos\)/.test(libColectivo), "el informe toma sus totales de la caja");
const informeUi = seccion("// ═════════ Informe del evento", "// ─── UI compartida");
for (const texto of ["Informe del evento", "Informe interno del Colectivo. No forma parte de Finanzas SIM.", ">Ingresos<", ">Costos<", ">Gastos<", ">Resultado neto<", ">Margen del evento<",
  "Por origen", "Por método de pago", "Costos por categoría", "Gastos por categoría", "Egresos por medio de pago", "Total egresos", "Detalle de costos y gastos"]) {
  assert.ok(informeUi.includes(texto), `el informe muestra «${texto}»`);
}
assert.ok(!/Editar|Eliminar|method: "(POST|PATCH|DELETE)"/.test(informeUi), "el informe no edita nada");
assert.ok(/\{ value: "informe", label: "Informe" \}/.test(paginaEvento), "pestaña Informe");

console.log(`OK — contratos de fuente: sin productos fijos, turnero y ventas sin datos de la persona, caja e informe internos (admin y staff, sin fin_*, informe solo lectura con las reglas de la caja), turnos = personas en el servidor, permisos de admin y Finanzas sin colectivo_* (${fuentesColectivo.length} + ${fuentesFinanzas.length} archivos).`);
