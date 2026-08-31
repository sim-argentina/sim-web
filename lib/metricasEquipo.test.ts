import { strict as assert } from "node:assert";
import {
  calcularTurnos, repartirMetricas, sumarMetricas, resolverAtribucion,
  nuevoAcum, imputar, reconciliar, CERO, type Metricas,
} from "@/lib/metricasEquipo";
import type { DiaResol } from "@/lib/cronograma";

// Ejecutar: npx tsx lib/metricasEquipo.test.ts
const RAMIRO = "11111111-1111-1111-1111-111111111111";
const FRAN = "22222222-2222-2222-2222-222222222222";
const FEDE = "33333333-3333-3333-3333-333333333333";

const diaBase = (jornadas: DiaResol["jornadas"], cerrado = false): DiaResol => ({ cerrado, apertura: "10:00", cierre: "22:00", jornadas });

// ── 1) Fórmula de turnos ──────────────────────────────────────────────────────
assert.equal(calcularTurnos(3, 30), 6, "3 personas × 30 min = 6 turnos");
assert.equal(calcularTurnos(1, 15), 1, "1 persona × 15 min = 1 turno");
assert.equal(calcularTurnos(4, 30), 8, "4 × 30 = 8");
assert.equal(calcularTurnos(2, 45), 6, "2 × 45 = 6");
assert.equal(calcularTurnos(0, 30), 0, "0 personas = 0");
assert.equal(calcularTurnos(2, 0), 0, "0 min = 0");

// ── 2) Borde [inicio, fin) y cambio de empleado ───────────────────────────────
const relevo = diaBase([
  { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "18:00" },
  { empleado_id: FEDE, hora_inicio: "18:00", hora_fin: "22:00" },
]);
{
  const a = resolverAtribucion({ estado: "confirmado", dia: relevo, hora: "17:45", fallbackEmpleadoId: RAMIRO });
  assert.ok(a.atribuido && a.presentes.length === 1 && a.presentes[0] === FRAN, "17:45 → Francisco");
  const b = resolverAtribucion({ estado: "confirmado", dia: relevo, hora: "18:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(b.atribuido && b.presentes.length === 1 && b.presentes[0] === FEDE, "18:00 exacto → Federico ([inicio,fin))");
  const c = resolverAtribucion({ estado: "confirmado", dia: relevo, hora: "17:59", fallbackEmpleadoId: RAMIRO });
  assert.ok(c.atribuido && c.presentes[0] === FRAN, "17:59 → Francisco");
}

// ── 3) Dos integrantes simultáneos ────────────────────────────────────────────
{
  const dia = diaBase([
    { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" },
    { empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "14:00" },
  ]);
  const a = resolverAtribucion({ estado: "confirmado", dia, hora: "12:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(a.atribuido && a.presentes.length === 2 && a.presentes.includes(FRAN) && a.presentes.includes(FEDE), "simultáneos → ambos");
}

// ── 4/5) Día cerrado / fuera de horario ───────────────────────────────────────
{
  const cerr = resolverAtribucion({ estado: "confirmado", dia: diaBase([], true), hora: "12:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(!cerr.atribuido && cerr.motivo === "dia_cerrado", "día cerrado");
  const antes = resolverAtribucion({ estado: "confirmado", dia: diaBase([]), hora: "09:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(!antes.atribuido && antes.motivo === "fuera_horario", "antes de apertura");
  const cierre = resolverAtribucion({ estado: "confirmado", dia: diaBase([]), hora: "22:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(!cierre.atribuido && cierre.motivo === "fuera_horario", "22:00 == cierre → fuera ([inicio,fin))");
}

// ── 6/7) Cronograma inexistente / borrador / reabierto (no oficial) ────────────
{
  const inex = resolverAtribucion({ estado: "inexistente", dia: null, hora: "12:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(!inex.atribuido && inex.motivo === "cronograma_no_confirmado", "inexistente");
  const bor = resolverAtribucion({ estado: "borrador", dia: diaBase([]), hora: "12:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(!bor.atribuido && bor.motivo === "cronograma_no_confirmado", "borrador (incluye reabierto) no atribuye");
}

// ── 8) Hora inválida ──────────────────────────────────────────────────────────
{
  const inv = resolverAtribucion({ estado: "confirmado", dia: diaBase([]), hora: "99:99", fallbackEmpleadoId: RAMIRO });
  assert.ok(!inv.atribuido && inv.motivo === "fecha_hora_invalida", "hora inválida");
  const nula = resolverAtribucion({ estado: "confirmado", dia: diaBase([]), hora: null, fallbackEmpleadoId: RAMIRO });
  assert.ok(!nula.atribuido && nula.motivo === "fecha_hora_invalida", "hora null");
}

// ── 9) Fallback de Ramiro (día confirmado, abierto, sin jornada en ese horario) ─
{
  const a = resolverAtribucion({ estado: "confirmado", dia: diaBase([{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "12:00" }]), hora: "15:00", fallbackEmpleadoId: RAMIRO });
  assert.ok(a.atribuido && a.presentes.length === 1 && a.presentes[0] === RAMIRO && a.fuentePresencia === "fallback", "hueco → Ramiro (fallback)");
}

// ── 10) Reparto fraccionario + reconciliación ─────────────────────────────────
{
  const op: Metricas = { turnos: 6, personas: 3, operaciones: 1, minutos: 30, bruto: 30000, comision: 3000, neto: 27000 };
  const parte = repartirMetricas(op, 2);
  assert.deepEqual(parte, { turnos: 3, personas: 1.5, operaciones: 0.5, minutos: 15, bruto: 15000, comision: 1500, neto: 13500 }, "reparto en 2 exacto");

  const acum = nuevoAcum();
  imputar(acum, "stand", op, { atribuido: true, presentes: [FRAN, FEDE], oficial: true, fuentePresencia: "manual" });
  const fran = acum.porEmpleado.get(FRAN)!;
  assert.equal(fran.stand.turnos, 3, "Francisco 3 turnos");
  assert.equal(fran.stand.personas, 1.5, "Francisco 1.5 personas");
  assert.equal(fran.stand.bruto, 15000, "Francisco 15000 bruto");
  const rec = reconciliar(acum);
  assert.ok(rec.ok, "reconciliación ok (origen = atribuido + sin-atribuir)");
  const brutoRow = rec.filas.find((f) => f.metrica === "bruto")!;
  assert.equal(brutoRow.origen, 30000, "origen bruto 30000");
  assert.equal(brutoRow.atribuido, 30000, "atribuido bruto 30000");
}

// ── 11) Precisión monetaria en reparto entre 3 + mezcla atribuido/sin-atribuir ─
{
  const acum = nuevoAcum();
  const op1: Metricas = { ...CERO, operaciones: 1, bruto: 30000.01, neto: 30000.01, personas: 3, turnos: 3, minutos: 45 };
  imputar(acum, "reservas", op1, { atribuido: true, presentes: [RAMIRO, FRAN, FEDE], oficial: true, fuentePresencia: "manual" });
  const op2: Metricas = { ...CERO, operaciones: 1, bruto: 5000, neto: 5000, personas: 1, turnos: 1, minutos: 15 };
  imputar(acum, "reservas", op2, { atribuido: false, motivo: "cronograma_no_confirmado" });
  const rec = reconciliar(acum);
  assert.ok(rec.ok, "reconciliación con 3-way split + sin-atribuir dentro de tolerancia");
  // suma de las 3 partes reconstruye el bruto original
  let suma = CERO;
  for (const v of acum.porEmpleado.values()) suma = sumarMetricas(suma, v.reservas);
  assert.ok(Math.abs(suma.bruto - 30000.01) < 0.01, "3 partes reconstruyen 30000.01");
}

console.log("OK — metricasEquipo (puro): turnos, [inicio,fin), relevo, simultáneos, cerrado, fuera de horario, no-confirmado, fallback Ramiro, reparto fraccionario, reconciliación, precisión monetaria.");
