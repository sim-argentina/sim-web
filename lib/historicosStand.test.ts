import { strict as assert } from "node:assert";
import {
  analizarArchivo,
  aniosEnNombre,
  aniosSeleccionables,
  ANIO_MINIMO_HISTORICO,
  construirTurnos,
  crearArchivoKey,
  crearHashTurno,
  diaDesdeHoja,
  fechaHistorica,
  mesDesdeNombre,
  validarFechaHistorica,
  validarLoteHistorico,
  validarPeriodo,
  type HojaExcel,
} from "./historicosStand";

// El proyecto no tiene runner de tests; se ejecuta con:
//   npx tsx lib/historicosStand.test.ts

const HOY = "2026-10-14";

// ── Mes: del nombre o nada (nunca el mes actual) ─────────────────────────────
assert.equal(mesDesdeNombre("Turnos Octubre.xlsx"), "10");
assert.equal(mesDesdeNombre("Plantilla Turnos Nuevo Centro Diciembre.xlsx"), "12");
assert.equal(mesDesdeNombre("turnos SETIEMBRE.xlsx"), "09");
assert.equal(mesDesdeNombre("turnos.xlsx"), null);

// ── Año: solo uno explícito de cuatro cifras ─────────────────────────────────
assert.deepEqual(aniosEnNombre("Turnos Octubre 2025.xlsx"), [2025]);
assert.deepEqual(aniosEnNombre("Turnos_2025-10.xlsx"), [2025]);
assert.deepEqual(aniosEnNombre("Turnos 20251.xlsx"), []);
assert.deepEqual(aniosEnNombre("Resumen 2026 vs 2025.xlsx"), [2025, 2026]);
assert.deepEqual(aniosEnNombre("Turnos enero.xlsx"), []);

// ── Hojas que representan un día ─────────────────────────────────────────────
assert.deepEqual(diaDesdeHoja("05"), { dia: 5, mes: null });
assert.deepEqual(diaDesdeHoja("1"), { dia: 1, mes: null });
assert.deepEqual(diaDesdeHoja("02-10"), { dia: 2, mes: "10" });
assert.deepEqual(diaDesdeHoja("31/12"), { dia: 31, mes: "12" });
assert.equal(diaDesdeHoja("0111"), null); // ambiguo: no se adivina
assert.equal(diaDesdeHoja("TOTAL"), null);
assert.equal(diaDesdeHoja("32"), null);
assert.equal(diaDesdeHoja("0"), null);

// ── Fechas de calendario ─────────────────────────────────────────────────────
assert.equal(fechaHistorica(2025, "10", 2), "2025-10-02");
assert.equal(fechaHistorica(2025, "11", 31), null);
assert.equal(fechaHistorica(2024, "02", 29), "2024-02-29");
assert.equal(fechaHistorica(2025, "02", 29), null);

// ── Período: mes y año obligatorios, nunca futuros ───────────────────────────
assert.equal(validarPeriodo(2025, "10", HOY), null);
assert.equal(validarPeriodo(2026, "10", HOY), null); // el mes en curso se puede cargar
assert.match(validarPeriodo(2026, "11", HOY)!, /todavía no ocurrió/);
assert.match(validarPeriodo(2026, "12", HOY)!, /todavía no ocurrió/);
assert.match(validarPeriodo(ANIO_MINIMO_HISTORICO - 1, "10", HOY)!, /entre/);
assert.match(validarPeriodo(2027, "01", HOY)!, /entre/);
assert.equal(validarPeriodo(null, "10", HOY), "Elegí el año.");
assert.equal(validarPeriodo(2025, null, HOY), "Elegí el mes.");
assert.equal(validarPeriodo(2025, "13", HOY), "Elegí el mes.");

assert.equal(validarFechaHistorica("2026-10-14", HOY), null);
assert.match(validarFechaHistorica("2026-10-15", HOY)!, /posterior a hoy/);
assert.match(validarFechaHistorica("2026-12-01", HOY)!, /posterior a hoy/);
assert.match(validarFechaHistorica("2025-02-29", HOY)!, /no existe/);
assert.match(validarFechaHistorica("2025-11-31", HOY)!, /no existe/);
assert.match(validarFechaHistorica("2026/10/01", HOY)!, /formato/);
assert.match(validarFechaHistorica(undefined, HOY)!, /formato/);

const anios = aniosSeleccionables(HOY);
assert.equal(anios[0], 2026);
assert.equal(anios[anios.length - 1], ANIO_MINIMO_HISTORICO);
assert.ok(!anios.includes(2027));

// ── Libros de prueba ─────────────────────────────────────────────────────────
const venta = (monto: number, extra: Record<string, unknown> = {}) => ({
  Turno: 1,
  "Cant. de Sim.": 2,
  "Tiempo (Min)": 15,
  "Cant. Turnos": 2,
  "Hora que se tomo el turno": "18:05",
  "Hora de subida": "18:10",
  "Hora de bajada": "18:25",
  Monto: monto,
  "Metodo de Pago": "efectivo",
  Escuderia: "Ferrari",
  ...extra,
});
const vacia = { Turno: 2, Monto: null, "Metodo de Pago": null };
const hoja = (nombre: string, filas: Record<string, unknown>[], fechas: Date[] = []): HojaExcel => ({ nombre, filas, fechas });

// Plantilla de octubre de 2025: hojas "DD-MM" y fechas de 2025 en AFLUENCIAS.
const plantillaOctubre = [
  hoja("RESUMEN", [{ Concepto: "Total", Valor: 100 }]),
  hoja("AFLUENCIAS", [], [new Date(2025, 9, 1, 12), new Date(2025, 9, 2, 12)]),
  hoja("02-10", [venta(15000), venta(30000, { "Hora de subida": "19:00" }), vacia]),
  hoja("03-10", [venta(15000, { "Metodo de Pago": "QR" })]),
];
const oct = analizarArchivo("Plantilla Turnos Nuevo Centro Octubre.xlsx", plantillaOctubre, HOY);
assert.equal(oct.archivoKey, "plantilla-turnos-nuevo-centro-octubre-xlsx");
assert.equal(oct.mesDetectado, "10");
assert.equal(oct.anioDetectado, 2025, "el año escrito dentro del archivo se preselecciona");
assert.match(oct.motivoAnio, /fechas dentro del archivo/);
assert.equal(oct.ventasLeidas, 3);
assert.deepEqual(oct.hojasIgnoradas, []);

// Sin año en ningún lado: NO se asume el año actual (el defecto original).
const enero = analizarArchivo("Turnos enero.xlsx", [hoja("TOTAL", []), hoja("01", [venta(15000)]), hoja("02", [venta(15000)])], HOY);
assert.equal(enero.mesDetectado, "01");
assert.equal(enero.anioDetectado, null, "sin año explícito hay que elegirlo");
assert.match(enero.motivoAnio, /no indica el año/);

// Sin mes en el nombre: se toma de las hojas DD-MM si todas coinciden; si no, null.
assert.equal(analizarArchivo("turnos.xlsx", [hoja("01-11", [venta(1)]), hoja("02-11", [venta(1)])], HOY).mesDetectado, "11");
assert.equal(analizarArchivo("turnos.xlsx", [hoja("01-11", [venta(1)]), hoja("02-12", [venta(1)])], HOY).mesDetectado, null);
assert.equal(analizarArchivo("turnos.xlsx", [hoja("01", [venta(1)])], HOY).mesDetectado, null);

// Evidencia contradictoria: no se preselecciona.
const contradictorio = analizarArchivo("Turnos Octubre 2026.xlsx", plantillaOctubre, HOY);
assert.equal(contradictorio.anioDetectado, null);
assert.match(contradictorio.motivoAnio, /varios años/);

// Año explícito pero imposible (diciembre de 2026 todavía no ocurrió): no se preselecciona.
const futuro = analizarArchivo("Turnos Diciembre 2026.xlsx", [hoja("01", [venta(1)])], HOY);
assert.equal(futuro.anioDetectado, null);
assert.match(futuro.motivoAnio, /no es válido/);

// Año del nombre, válido.
assert.equal(analizarArchivo("Turnos Marzo 2026.xlsx", [hoja("01", [venta(1)])], HOY).anioDetectado, 2026);

// Hojas con ventas que no son un día: se informan.
const raro = analizarArchivo("Plantilla Noviembre.xlsx", [hoja("0111", [venta(1)]), hoja("02-11", [venta(1)])], HOY);
assert.deepEqual(raro.hojasIgnoradas, ["0111"]);
assert.equal(raro.ventasLeidas, 1);

// ── Armado de ventas con el año confirmado ───────────────────────────────────
const r2025 = construirTurnos(oct, 2025, "10", HOY);
assert.deepEqual(r2025.errores, []);
assert.equal(r2025.turnos.length, 3);
assert.deepEqual([...new Set(r2025.turnos.map((t) => t.fecha))], ["2025-10-02", "2025-10-03"]);
for (const t of r2025.turnos) {
  assert.ok(t.hash_unico.startsWith(`${oct.archivoKey}|${t.fecha}|`), "el hash empieza por archivo_key|fecha|");
  assert.equal(t.origen, "excel");
  assert.equal(t.archivo_nombre, "Plantilla Turnos Nuevo Centro Octubre.xlsx");
}
const primera = r2025.turnos[0];
assert.equal(primera.total, 15000);
assert.equal(primera.metodo_pago, "EFECTIVO");
assert.equal(primera.cantidad_simuladores, 2);
assert.equal(primera.cantidad_turnos, 2);
assert.equal(primera.duracion, 15);
assert.equal(primera.escuderia, "Ferrari");
assert.equal(r2025.turnos[2].metodo_pago, "QR");

// Sin elegir año o mes: nada.
assert.deepEqual(construirTurnos(oct, null, "10", HOY), { turnos: [], errores: ["Elegí el año."] });
assert.deepEqual(construirTurnos(oct, 2025, null, HOY), { turnos: [], errores: ["Elegí el mes."] });

// Un mes futuro se rechaza entero (así se habría frenado la carga de mayo de 2026).
const enMayo = construirTurnos(oct, 2026, "10", "2026-05-20");
assert.equal(enMayo.turnos.length, 0);
assert.match(enMayo.errores[0], /todavía no ocurrió/);

// Mes en curso con días posteriores a hoy: no se importa a medias.
const parcial = analizarArchivo("Turnos Octubre.xlsx", [hoja("13", [venta(1)]), hoja("20", [venta(1)])], HOY);
const rParcial = construirTurnos(parcial, 2026, "10", HOY);
assert.equal(rParcial.turnos.length, 0);
assert.match(rParcial.errores.join(" "), /posterior a hoy/);

// Día inexistente con ventas.
const nov = analizarArchivo("Turnos Noviembre.xlsx", [hoja("30", [venta(1)]), hoja("31", [venta(1)])], HOY);
const rNov = construirTurnos(nov, 2025, "11", HOY);
assert.equal(rNov.turnos.length, 0);
assert.match(rNov.errores[0], /no tiene día 31/);
// Una hoja 31 VACÍA no molesta.
const novVacia = analizarArchivo("Turnos Noviembre.xlsx", [hoja("30", [venta(1)]), hoja("31", [vacia])], HOY);
assert.equal(construirTurnos(novVacia, 2025, "11", HOY).turnos.length, 1);

// Hoja de otro mes que el confirmado.
const rMes = construirTurnos(oct, 2025, "11", HOY);
assert.equal(rMes.turnos.length, 0);
assert.match(rMes.errores[0], /es de octubre, no de noviembre/);

// Filas idénticas en un mismo archivo se cuentan una vez (como antes).
const dup = analizarArchivo("Turnos Mayo.xlsx", [hoja("05", [venta(1000), venta(1000)])], HOY);
assert.equal(construirTurnos(dup, 2026, "05", HOY).turnos.length, 1);

// ── El hash y la corrección de datos ─────────────────────────────────────────
// La corrección SQL reescribe SOLO el segmento de fecha del hash. Tiene que dar
// exactamente el hash que calcula el importador con el año correcto: así
// reimportar el archivo con 2025 no duplica nada.
const r2026 = construirTurnos(oct, 2026, "10", "2026-12-31");
assert.equal(r2026.turnos.length, 3);
r2026.turnos.forEach((t, i) => {
  const reescrito = `${t.archivo_key}|${r2025.turnos[i].fecha}${t.hash_unico.slice(t.archivo_key.length + 1 + t.fecha.length)}`;
  assert.equal(reescrito, r2025.turnos[i].hash_unico);
  assert.notEqual(t.hash_unico, r2025.turnos[i].hash_unico, "otro año = otra venta");
});

// Filas en vivo del turnero: se deduplican por id, no por contenido.
assert.equal(crearHashTurno({ id: 7, fecha: "2026-09-12", total: 1 }), "stand-id:7");
assert.ok(crearHashTurno({ origen: "excel", id: 7, archivo_key: "k", fecha: "2025-10-02" }).startsWith("k|2025-10-02|"));
assert.equal(crearArchivoKey("Turnos Octubre.xlsx"), "turnos-octubre-xlsx");

// ── Validación del lote en la API ────────────────────────────────────────────
assert.equal(validarLoteHistorico(r2025.turnos, HOY), null);
assert.match(validarLoteHistorico([], HOY)!, /No se recibieron/);
assert.match(validarLoteHistorico(undefined, HOY)!, /No se recibieron/);
assert.match(validarLoteHistorico([{ ...primera, fecha: "2026-11-02" }], HOY)!, /posterior a hoy/);
assert.match(validarLoteHistorico([{ ...primera, fecha: "2025-10-03" }], HOY)!, /hash no corresponde/);
assert.match(validarLoteHistorico([{ ...primera, archivo_key: "" }], HOY)!, /necesita/);
assert.match(validarLoteHistorico([{ ...primera, fecha: "2025-11-31", hash_unico: `${primera.archivo_key}|2025-11-31|x` }], HOY)!, /no existe/);

console.log("historicosStand: OK");
