import { strict as assert } from "node:assert";
import {
  combinar,
  comparar,
  cumple,
  diaSemanaDe,
  diasEntre,
  enRango,
  escribirParametros,
  escribirSeleccion,
  esFecha,
  esperaDe,
  filtrar,
  hallazgos,
  leerParametros,
  leerSeleccion,
  minutoEnSim,
  minutosDeHora,
  ocurrenciasDiaSemana,
  operacionesDeFilas,
  paginaDetalle,
  POR_PAGINA,
  rangoComparacion,
  rangoDePreset,
  resumir,
  sumarDiasFecha,
  totalesDe,
  type FilaExcel,
  type FilaTurnero,
  type OperacionStand,
} from "./metricasStandDashboard";

// El proyecto no tiene runner de tests; se ejecuta con:
//   npx tsx lib/metricasStandDashboard.test.ts

const HOY = "2026-10-28";
// Primer día de octubre calculado: la fecha del corte de modalidad solo se escribe en su fuente única (guarda B0).
const PRIMERO_OCT = sumarDiasFecha("2026-09-30", 1);
const AHORA = 15 * 60 + 40; // 15:40 ART

// ── Fechas y horas ───────────────────────────────────────────────────────────
assert.equal(diaSemanaDe(PRIMERO_OCT), 3, "el 1 de octubre de 2026 es jueves (lunes = 0)");
assert.equal(diaSemanaDe("2026-10-26"), 0, "26/10/2026 es lunes");
assert.equal(diaSemanaDe("2026-10-25"), 6, "25/10/2026 es domingo");
assert.equal(diasEntre(PRIMERO_OCT, "2026-10-28"), 28);
assert.deepEqual(ocurrenciasDiaSemana(PRIMERO_OCT, "2026-10-28"), [4, 4, 4, 4, 4, 4, 4]);
assert.deepEqual(ocurrenciasDiaSemana(PRIMERO_OCT, "2026-10-03"), [0, 0, 0, 1, 1, 1, 0], "jue, vie, sáb");
assert.equal(minutosDeHora("18:05"), 18 * 60 + 5);
assert.equal(minutosDeHora("9:07:30"), 9 * 60 + 7);
assert.equal(minutosDeHora("24:00"), null);
assert.equal(minutosDeHora(""), null);
assert.equal(minutosDeHora(null), null);
assert.ok(esFecha("2026-02-28") && !esFecha("2026-02-30") && !esFecha("28/02/2026"));
// 28/10/2026 18:40 UTC = 15:40 en Argentina (UTC−3, sin horario de verano).
assert.equal(minutoEnSim(new Date(Date.UTC(2026, 9, 28, 18, 40))), AHORA);

// ── Normalización ────────────────────────────────────────────────────────────
const tur = (id: number, x: Partial<FilaTurnero> = {}): FilaTurnero => ({
  id,
  fecha: "2026-10-03",
  hora: "18:00",
  hora_subida: "18:05",
  cantidad_personas: 2,
  cantidad_minutos: 10,
  cantidad_turnos: 2,
  total: 20000,
  metodo_pago: "qr",
  pagos_detalle: [{ monto: 20000, metodo_pago: "qr" }],
  estado: "activo",
  modalidad: "v2_10",
  ...x,
});
const exc = (id: number, x: Partial<FilaExcel> = {}): FilaExcel => ({
  id,
  fecha: "2025-11-08",
  archivo_key: "plantilla-noviembre-xlsx",
  archivo_nombre: "Plantilla Noviembre.xlsx",
  hora_tomado: "17:00",
  hora_subida: "17:10",
  hora_bajada: "17:25",
  metodo_pago: "EFECTIVO",
  total: 15000,
  cantidad_simuladores: 1,
  cantidad_turnos: 1,
  duracion: 15,
  escuderia: "Ferrari",
  origen: "excel",
  ...x,
});

const ops = operacionesDeFilas(
  [
    tur(1),
    tur(1), // mismo id: una sola operación
    tur(2, { metodo_pago: "mixto", total: 46000, cantidad_personas: 3, cantidad_minutos: 20, pagos_detalle: [{ monto: 30000, metodo_pago: "qr" }, { monto: 16000, metodo_pago: "efectivo" }] }),
    tur(3, { metodo_pago: "gratis", total: 0, cantidad_personas: 1, pagos_detalle: [{ monto: 0, metodo_pago: "gratis" }] }),
    tur(4, { estado: "anulado" }),
    tur(5, { fecha: "2026-10-04", hora: "20:00", hora_subida: "19:50", cantidad_minutos: 30, cantidad_personas: 4, total: 120000, pagos_detalle: null }),
    tur(6, { fecha: "2026-10-04", hora: "11:00", hora_subida: null, cantidad_minutos: 25, cantidad_personas: 1, total: 18000, modalidad: null, pagos_detalle: null }),
  ],
  [exc(10), exc(10), exc(11, { duracion: null, hora_tomado: null, total: 30000, cantidad_simuladores: 2 })],
);
assert.equal(ops.length, 7, "dedup Turnero por id, Excel por contenido, sin anuladas");
const op = (id: string) => ops.find((o) => o.id === id)!;
assert.deepEqual(op("t:2").pagos, [{ metodo: "QR", monto: 30000 }, { metodo: "EFECTIVO", monto: 16000 }], "pago mixto separado por medio");
assert.equal(op("t:3").cortesia, true);
assert.equal(op("t:1").cortesia, false);
assert.equal(op("t:5").pagos[0].metodo, "QR", "sin pagos_detalle usa el medio de la fila");
assert.equal(op("t:6").clase, "otra", "25 min no es una duración del catálogo");
assert.equal(op("t:6").modalidad, "legacy");
assert.equal(op("x:11").clase, "sin_dato");
assert.equal(op("x:10").personas, 1);
assert.equal(op("x:11").personas, 2, "Excel: personas = Cant. de Sim.");
assert.equal(op("t:2").diaSemana, 5, "03/10/2026 es sábado");
assert.equal(esperaDe(op("t:1")), 5);
assert.equal(esperaDe(op("t:5")), null, "subida antes de la toma: fuera de rango");
assert.equal(esperaDe(op("t:6")), null, "sin subida");

// ── Totales: una definición por métrica ──────────────────────────────────────
const t = totalesDe(ops);
assert.equal(t.operaciones, 7);
assert.equal(t.cortesias, 1);
assert.equal(t.ventas, 6);
assert.equal(t.facturacion, 20000 + 46000 + 120000 + 18000 + 15000 + 30000);
assert.equal(t.personas, 2 + 3 + 1 + 4 + 1 + 1 + 2);
assert.equal(t.personasComerciales, t.personas - 1);
assert.equal(t.personasConSubida, 2 + 3 + 1 + 4 + 1 + 2, "todas menos la #6 (sin subida)");
assert.equal(t.ticketPromedio, t.facturacion / 6, "el ticket excluye cortesías");
assert.equal(t.ingresoPorPersona, t.facturacion / t.personasComerciales);
// Duración promedio ponderada por persona: Σ(min × personas) / Σ personas con dato.
const minPer = 10 * 2 + 20 * 3 + 10 * 1 + 30 * 4 + 25 * 1 + 15 * 1;
assert.equal(t.minutosPersona, minPer);
assert.equal(t.personasConDuracion, t.personas - 2, "la #x:11 no tiene duración");
assert.equal(t.duracionPromedioPersona, minPer / (t.personas - 2));

// ── Rangos y comparación con corte equivalente ───────────────────────────────
const mes = rangoDePreset("mes", HOY, AHORA);
assert.deepEqual(mes, { desde: PRIMERO_OCT, hasta: HOY, incompleto: true, corteMinuto: null, minutoAhora: AHORA });
assert.deepEqual(rangoComparacion(mes, "mes", "anterior"), { desde: "2026-09-01", hasta: "2026-09-28", incompleto: false, corteMinuto: AHORA, minutoAhora: null }, "un mes en curso contra los mismos días, con el mismo corte");
const mesAnt = rangoDePreset("mes_anterior", HOY, AHORA);
assert.deepEqual(mesAnt, { desde: "2026-09-01", hasta: "2026-09-30", incompleto: false, corteMinuto: null, minutoAhora: null });
assert.deepEqual(rangoComparacion(mesAnt, "mes_anterior", "anterior"), { desde: "2026-08-01", hasta: "2026-08-31", incompleto: false, corteMinuto: null, minutoAhora: null }, "mes completo contra mes completo");
const hoy = rangoDePreset("hoy", HOY, AHORA);
assert.deepEqual(rangoComparacion(hoy, "hoy", "anterior"), { desde: "2026-10-27", hasta: "2026-10-27", incompleto: false, corteMinuto: AHORA, minutoAhora: null }, "hoy hasta las 15:40 contra ayer hasta las 15:40");
const semana = rangoDePreset("semana", HOY, AHORA);
assert.equal(semana.desde, "2026-10-26", "la semana empieza el lunes");
assert.deepEqual(rangoComparacion(semana, "semana", "anterior")?.desde, "2026-10-19");
assert.deepEqual(rangoComparacion(semana, "semana", "anterior")?.hasta, "2026-10-21");
assert.deepEqual(rangoComparacion(mes, "mes", "anio"), { desde: "2025-10-01", hasta: "2025-10-28", incompleto: false, corteMinuto: AHORA, minutoAhora: null });
assert.equal(rangoComparacion(rangoDePreset("todo", HOY, AHORA), "todo", "anterior"), null);
assert.equal(rangoComparacion(mes, "mes", "ninguna"), null);
const pers = rangoDePreset("personalizado", HOY, AHORA, { desde: "2026-09-10", hasta: "2026-12-31" });
assert.equal(pers.hasta, HOY, "nunca más allá de hoy");
assert.ok(pers.incompleto);
assert.equal(rangoDePreset("personalizado", HOY, AHORA, { desde: "2026-09-10", hasta: "2026-09-01" }).hasta, "2026-09-10", "hasta < desde se corrige");
assert.equal(rangoDePreset("anio", "2028-02-29", AHORA).desde, "2028-01-01");
assert.equal(rangoComparacion(rangoDePreset("hoy", "2028-02-29", AHORA), "hoy", "anio")?.desde, "2027-02-28", "29/02 contra 28/02");

// El corte se aplica solo al último día del período de comparación.
const corte = { desde: "2026-10-03", hasta: "2026-10-04", incompleto: false, corteMinuto: 19 * 60, minutoAhora: null };
assert.deepEqual(enRango(ops, corte).map((o) => o.id).sort(), ["t:1", "t:2", "t:3", "t:6"], "del 04/10 entra solo la venta de las 11:00");

// ── Resumen: todas las vistas suman lo mismo ─────────────────────────────────
const rango = { desde: "2025-11-01", hasta: "2026-10-04", incompleto: false, corteMinuto: null, minutoAhora: null };
const r = resumir(ops, rango, HOY);
const suma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
assert.equal(suma(r.duraciones, (d) => d.facturacion), t.facturacion);
assert.equal(suma(r.duraciones, (d) => d.personas), t.personas);
assert.equal(suma(r.duraciones, (d) => d.operaciones), t.operaciones);
assert.equal(suma(r.grupos, (g) => g.operaciones), t.operaciones);
assert.equal(suma(r.serie, (d) => d.facturacion), t.facturacion);
assert.equal(suma(r.serie, (d) => d.personas), t.personas);
assert.equal(suma(r.diasSemana, (d) => d.personas), t.personas);
assert.equal(suma(r.calorVenta, (c) => c.operaciones), t.operaciones - 1, "la #x:11 no tiene hora de venta");
assert.equal(r.cobertura.conHoraVenta, t.operaciones - 1);
assert.equal(suma(r.calorSubida, (c) => c.operaciones), t.operacionesConSubida);
assert.equal(suma(r.pagos, (p) => p.monto), t.facturacion, "Σ pagos = facturación (las cortesías pagan 0)");
assert.equal(r.duraciones.find((d) => d.clase === "10")!.cortesias, 1);
assert.ok(r.duraciones.some((d) => d.clase === "otra") && r.duraciones.some((d) => d.clase === "sin_dato"));
assert.equal(r.grupos.find((g) => g.grupo === 4)!.operaciones, 1);
assert.equal(r.espera.validas, 4, "#1, #2, #3 y la Excel #10");
assert.equal(r.espera.fueraDeRango, 1);
assert.equal(r.espera.sinDato, 2);
assert.equal(r.espera.mediana, 5 + 0 /* 5,5,5,10 → (5+5)/2 */);
assert.equal(r.espera.maxima, 10);
assert.equal(suma(r.espera.tramos, (x) => x.operaciones), r.espera.validas);
assert.equal(r.espera.top[0].id, "x:10");

// ── Comparación: la descomposición de la facturación es exacta ───────────────
const actual = resumir(filtrar(ops, { fuente: "turnero" }), rango, HOY);
const anterior = resumir(filtrar(ops, { fuente: "excel" }), rango, HOY);
const c = comparar(actual, anterior);
assert.equal((c.efectoVentas ?? 0) + (c.efectoTicket ?? 0), c.facturacion.diferencia, "ΔF = efecto ventas + efecto ticket");
assert.equal(c.modalidadesDistintas, true, "Turnero v2 contra Excel legacy");
const lectura = hallazgos(actual, anterior, c);
assert.ok(lectura.find((h) => h.id === "facturacion")?.texto.includes("por cantidad de ventas"));
assert.ok(lectura.find((h) => h.id === "duraciones")?.texto.includes("no son comparables"));
assert.ok(lectura.find((h) => h.id === "cortesias"));
assert.deepEqual(hallazgos(resumir([], rango, HOY), null, null), [], "sin operaciones no hay lectura");

// ── Criterios: filtros del dashboard ∧ selección del detalle ─────────────────
assert.equal(filtrar(ops, { duraciones: ["10"] }).length, 2);
assert.equal(filtrar(ops, { tipo: "cortesias" }).length, 1);
assert.equal(filtrar(ops, { dias: [5], horas: [18] }).length, 3, "sábado 18 h");
assert.equal(filtrar(ops, { horasSubida: [19] }).length, 1);
assert.equal(filtrar(ops, { grupo: 4 }).length, 1);
assert.equal(filtrar(ops, { medio: "EFECTIVO" }).length, 3, "#2 (mixto) y las dos Excel");
assert.equal(filtrar(ops, { esperaMin: 10 }).length, 1);
assert.equal(filtrar(ops, { esperaMin: 5, esperaMax: 10 }).length, 3, "tramo [5, 10)");
assert.equal(filtrar(ops, { id: "t:2" }).length, 1);
assert.equal(filtrar(ops, combinar({ duraciones: ["10", "20"] }, { duraciones: ["20"] })).length, 1);
const nada = combinar({ duraciones: ["10"] }, { duraciones: ["30"] });
assert.equal(nada.nada, true);
assert.equal(filtrar(ops, nada).length, 0, "criterios contradictorios: ninguna operación");
assert.equal(filtrar(ops, combinar({ tipo: "comerciales" }, { tipo: "cortesias" })).length, 0);
assert.equal(cumple(op("t:1"), {}), true);
assert.equal(filtrar(ops, { fechaDesde: "2026-10-04", fechaHasta: "2026-10-31" }).length, 2, "subrango de fechas");

// ── Detalle paginado: su contexto es el mismo total ──────────────────────────
const muchas: OperacionStand[] = Array.from({ length: 60 }, (_, i) => ({ ...op("t:1"), id: `t:${100 + i}`, idOrigen: 100 + i, importe: 1000 + i }));
const p1 = paginaDetalle(muchas, "reciente", 1);
const p3 = paginaDetalle(muchas, "reciente", 3);
assert.equal(p1.filas.length, POR_PAGINA);
assert.equal(p3.filas.length, 60 - 2 * POR_PAGINA);
assert.equal(p1.paginas, 3);
assert.equal(paginaDetalle(muchas, "reciente", 99).pagina, 3, "página fuera de rango → la última");
assert.deepEqual(p1.contexto.facturacion, totalesDe(muchas).facturacion);
assert.equal(paginaDetalle(muchas, "importe", 1).filas[0].importe, 1059);
const mixto = paginaDetalle(filtrar(ops, { medio: "EFECTIVO" }), "reciente", 1, "EFECTIVO");
assert.equal(mixto.contexto.importeMedio, 16000 + 15000 + 30000, "en un pago mixto cuenta solo lo pagado con ese medio");
assert.equal(mixto.contexto.facturacion, 46000 + 15000 + 30000, "la facturación de esas operaciones incluye la parte en QR");
assert.equal(paginaDetalle([], "reciente", 1).paginas, 1);

// ── Parámetros de URL ida y vuelta ───────────────────────────────────────────
const params = { preset: "personalizado" as const, desde: "2026-09-01", hasta: "2026-09-30", comparar: "anio" as const, filtros: { duraciones: ["10" as const, "30" as const], dias: [5, 6], horas: [18], tipo: "comerciales" as const } };
assert.deepEqual(leerParametros(escribirParametros(params)), params);
assert.deepEqual(leerParametros(new URLSearchParams("p=raro&cmp=x&dur=99&dias=9&horas=30")), { preset: "mes", desde: undefined, hasta: undefined, comparar: "anterior", filtros: {} }, "valores inválidos se descartan");
const sel = { fecha: "2026-10-03", fechaDesde: "2026-10-02", fechaHasta: "2026-10-07", grupo: 4, medio: "QR", conSubida: true, esperaMin: 15, esperaMax: 30, id: "t:123", horasSubida: [19] };
assert.deepEqual(leerSeleccion(escribirSeleccion(sel)), sel);

console.log("metricasStandDashboard: OK");
