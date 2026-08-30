import { strict as assert } from "node:assert";
import {
  fechasSemana, mapearSemana, esLunes, ocurrencia, weekday,
  mapearMes, clasificar, firmaDia, normalizarNombrePlantilla, type DiaCmp,
} from "@/lib/cronogramaCopia";

// Ejecutar: npx tsx lib/cronogramaCopia.test.ts
// Mapeos puros (semana/mes por aparición) + comparador de conflictos.

// ── Semana ────────────────────────────────────────────────────────────────────
assert.equal(esLunes("2026-08-03"), true, "3/8/2026 es lunes");
assert.equal(esLunes("2026-08-04"), false);
assert.deepEqual(fechasSemana("2026-08-03"), ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"], "semana lun→dom");
// Semana que cruza fin de mes: 31/8 (lun) → 6/9 (dom).
assert.deepEqual(fechasSemana("2026-08-31"), ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"], "semana cruza mes");
const ms = mapearSemana("2026-08-03", "2026-09-07");
assert.equal(ms.length, 7);
assert.deepEqual(ms[0], { origen: "2026-08-03", destino: "2026-09-07" }, "lunes→lunes");
assert.deepEqual(ms[6], { origen: "2026-08-09", destino: "2026-09-13" }, "domingo→domingo");

// ── Mes por aparición ─────────────────────────────────────────────────────────
assert.equal(ocurrencia("2026-08-03"), 1, "3/8 = 1er lunes");
assert.equal(ocurrencia("2026-08-31"), 5, "31/8 = 5º lunes");
assert.equal(weekday("2026-08-01"), 5, "1/8 = sábado");

const mm = mapearMes(2026, 8, 2026, 9);
const par = (o: string) => mm.pares.find((p) => p.origen === o);
// Primer lunes 3/8 → primer lunes 7/9.
assert.equal(par("2026-08-03")?.destino, "2026-09-07", "1er lunes Ago→Sep");
// Primer sábado 1/8 → primer sábado 5/9.
assert.equal(par("2026-08-01")?.destino, "2026-09-05", "1er sábado Ago→Sep");
// 5º lunes de Agosto (31/8) SIN equivalente en Septiembre → soloOrigen (ignorado).
assert.ok(mm.soloOrigen.includes("2026-08-31"), "5º lunes sin destino → soloOrigen");
assert.ok(!mm.pares.some((p) => p.origen === "2026-08-31"), "5º lunes no se mapea");

// Caso inverso: destino con 5ª aparición que el origen no tiene → soloDestino (se conserva).
// Septiembre 2026 (30 días) vs Febrero 2026 (28 días): días 29/30 de Sep no tienen equivalente en Feb.
const mm2 = mapearMes(2026, 2, 2026, 9);
assert.ok(mm2.soloDestino.length > 0, "destino con apariciones extra → soloDestino");

// ── Conflictos ────────────────────────────────────────────────────────────────
const dia = (over: Partial<DiaCmp> = {}): DiaCmp => ({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [], ...over });
const A = dia({ jornadas: [{ key: "e1", hora_inicio: "10:00", hora_fin: "14:00" }, { key: "e2", hora_inicio: "16:00", hora_fin: "22:00" }] });
const B = dia({ jornadas: [{ key: "e2", hora_inicio: "16:00", hora_fin: "22:00" }, { key: "e1", hora_inicio: "10:00", hora_fin: "14:00" }] });
assert.equal(firmaDia(A), firmaDia(B), "firma independiente del orden");
assert.equal(clasificar(A, B), "sin_cambios", "idénticos → sin_cambios");
assert.equal(clasificar(A, dia({ jornadas: [{ key: "e1", hora_inicio: "10:00", hora_fin: "18:00" }] })), "diferente", "distinto → diferente");
assert.equal(clasificar(null, A), "solo_propuesta", "solo propuesta");
assert.equal(clasificar(A, null), "solo_destino", "solo destino");
assert.equal(clasificar(dia({ cerrado: true }), dia({ cerrado: true })), "sin_cambios", "ambos cerrados → sin_cambios");

// ── Normalización de nombre ───────────────────────────────────────────────────
assert.equal(normalizarNombrePlantilla("  Semana  ALTA "), "semana alta");
assert.equal(normalizarNombrePlantilla("Rotación Típica"), "rotacion tipica");

console.log("OK — cronogramaCopia (puro): semana lun→dom (cruza mes), mapeo por aparición (1º/5º), soloOrigen/soloDestino, firma canónica, clasificación de conflictos, normalización.");
