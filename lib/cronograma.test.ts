import { strict as assert } from "node:assert";
import {
  resolverPresencia,
  validarDia,
  cubreHorarioOperativo,
  fechaEnMes,
  validarAnioMes,
  horaAMinutos,
  type DiaResol,
} from "@/lib/cronograma";

// Ejecutar: npx tsx lib/cronograma.test.ts
// Pruebas PURAS (sin DB): resolución de presencia + validación de día + cobertura.

const RAMIRO = "11111111-1111-1111-1111-111111111111";
const FRAN = "22222222-2222-2222-2222-222222222222";
const FEDE = "33333333-3333-3333-3333-333333333333";

const diaBase = (over: Partial<DiaResol> = {}): DiaResol => ({
  cerrado: false,
  apertura: "10:00",
  cierre: "22:00",
  jornadas: [],
  ...over,
});

// ── horaAMinutos ──────────────────────────────────────────────────────────────
assert.equal(horaAMinutos("10:00"), 600);
assert.equal(horaAMinutos("10:30:00"), 630);
assert.equal(horaAMinutos("24:00"), null, "24:00 inválido");
assert.equal(horaAMinutos("aa"), null);

// ── resolverPresencia ─────────────────────────────────────────────────────────
// 1) Mes inexistente → nadie, NUNCA fallback.
assert.deepEqual(
  resolverPresencia({ estado: "inexistente", dia: diaBase(), hora: "15:00", fallbackEmpleadoId: RAMIRO }),
  { presentes: [], fuente: "ninguno", oficial: false },
  "1: mes inexistente sin fallback",
);

// 3) Confirmado, día abierto, sin jornadas, dentro de horario → solo Ramiro.
assert.deepEqual(
  resolverPresencia({ estado: "confirmado", dia: diaBase(), hora: "15:00", fallbackEmpleadoId: RAMIRO }),
  { presentes: [RAMIRO], fuente: "fallback", oficial: true },
  "3: hueco confirmado → Ramiro",
);

// 4) Día cerrado → nadie, sin fallback.
assert.deepEqual(
  resolverPresencia({ estado: "confirmado", dia: diaBase({ cerrado: true }), hora: "15:00", fallbackEmpleadoId: RAMIRO }),
  { presentes: [], fuente: "ninguno", oficial: true },
  "4: día cerrado → nadie",
);

// 5) Fuera del horario operativo → nadie (incluye el borde de cierre).
assert.equal(resolverPresencia({ estado: "confirmado", dia: diaBase(), hora: "09:59", fallbackEmpleadoId: RAMIRO }).fuente, "ninguno", "5a: antes de apertura");
assert.equal(resolverPresencia({ estado: "confirmado", dia: diaBase(), hora: "22:00", fallbackEmpleadoId: RAMIRO }).fuente, "ninguno", "5b: a las 22:00 (cierre exclusivo)");
assert.equal(resolverPresencia({ estado: "confirmado", dia: diaBase(), hora: "10:00", fallbackEmpleadoId: RAMIRO }).fuente, "fallback", "5c: a las 10:00 (apertura inclusiva)");

// 6) Jornada manual → integrante correcto.
const conFran = diaBase({ jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" }] });
assert.deepEqual(
  resolverPresencia({ estado: "confirmado", dia: conFran, hora: "12:00", fallbackEmpleadoId: RAMIRO }),
  { presentes: [FRAN], fuente: "manual", oficial: true },
  "6: jornada manual",
);
// Y a las 15:00 (fuera de la jornada, dentro del horario) → hueco de Ramiro.
assert.deepEqual(
  resolverPresencia({ estado: "confirmado", dia: conFran, hora: "15:00", fallbackEmpleadoId: RAMIRO }).presentes,
  [RAMIRO],
  "6b: hueco tras la jornada → Ramiro",
);

// 7) Dos integrantes simultáneos → ambos.
const dosSimultaneos = diaBase({
  jornadas: [
    { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "18:00" },
    { empleado_id: FEDE, hora_inicio: "12:00", hora_fin: "20:00" },
  ],
});
assert.deepEqual(
  resolverPresencia({ estado: "confirmado", dia: dosSimultaneos, hora: "13:00", fallbackEmpleadoId: RAMIRO }).presentes.sort(),
  [FRAN, FEDE].sort(),
  "7: dos integrantes simultáneos",
);

// 8) Ramiro cargado manualmente junto con otro → ambos (Ramiro es uno más).
const ramiroManual = diaBase({
  jornadas: [
    { empleado_id: RAMIRO, hora_inicio: "10:00", hora_fin: "16:00" },
    { empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "16:00" },
  ],
});
assert.deepEqual(
  resolverPresencia({ estado: "confirmado", dia: ramiroManual, hora: "11:00", fallbackEmpleadoId: RAMIRO }),
  { presentes: [RAMIRO, FEDE], fuente: "manual", oficial: true },
  "8: Ramiro manual + otro",
);

// 9) Bordes [inicio, fin): a las 14:00 la jornada 10–14 ya no está activa.
assert.equal(resolverPresencia({ estado: "confirmado", dia: conFran, hora: "13:59", fallbackEmpleadoId: RAMIRO }).fuente, "manual", "9a: 13:59 dentro");
assert.equal(resolverPresencia({ estado: "confirmado", dia: conFran, hora: "14:00", fallbackEmpleadoId: RAMIRO }).fuente, "fallback", "9b: 14:00 ya fuera (→ hueco)");

// Borrador: sin preview no aplica fallback; con preview sí, pero NO es oficial.
assert.deepEqual(
  resolverPresencia({ estado: "borrador", dia: diaBase(), hora: "15:00", fallbackEmpleadoId: RAMIRO }),
  { presentes: [], fuente: "ninguno", oficial: false },
  "borrador sin preview: sin fallback",
);
assert.deepEqual(
  resolverPresencia({ estado: "borrador", dia: diaBase(), hora: "15:00", fallbackEmpleadoId: RAMIRO, preview: true }),
  { presentes: [RAMIRO], fuente: "fallback", oficial: false },
  "borrador con preview: fallback tentativo (no oficial)",
);

// ── validarDia ────────────────────────────────────────────────────────────────
// 10) Inicio >= fin → rechazo (incluye nocturnas 20–02).
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "14:00", hora_fin: "14:00" }] }).ok, false, "10a: inicio=fin");
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "20:00", hora_fin: "02:00" }] }).ok, false, "10b: nocturna cruza medianoche");

// 11) Jornada fuera del horario operativo → rechazo.
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "09:00", hora_fin: "11:00" }] }).ok, false, "11a: antes de apertura");
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "21:00", hora_fin: "23:00" }] }).ok, false, "11b: después del cierre");

// 12) Superposición del mismo integrante → rechazo.
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [
  { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" },
  { empleado_id: FRAN, hora_inicio: "13:00", hora_fin: "16:00" },
] }).ok, false, "12: mismo integrante superpuesto");

// 12b) Jornadas del mismo integrante que se tocan (14:00 fin / 14:00 inicio) → OK.
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [
  { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" },
  { empleado_id: FRAN, hora_inicio: "14:00", hora_fin: "18:00" },
] }).ok, true, "12b: tramos que se tocan no solapan");

// 13) Superposición entre integrantes DISTINTOS → aceptado.
assert.equal(validarDia({ cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [
  { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "18:00" },
  { empleado_id: FEDE, hora_inicio: "12:00", hora_fin: "20:00" },
] }).ok, true, "13: distintos integrantes simultáneos OK");

// 14) Día cerrado con jornadas → rechazo.
assert.equal(validarDia({ cerrado: true, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "12:00" }] }).ok, false, "14: cerrado con jornadas");
// Día cerrado sin jornadas → OK.
assert.equal(validarDia({ cerrado: true, apertura: "10:00", cierre: "22:00", jornadas: [] }).ok, true, "14b: cerrado sin jornadas OK");

// Horario operativo inválido → rechazo.
assert.equal(validarDia({ cerrado: false, apertura: "22:00", cierre: "10:00", jornadas: [] }).ok, false, "apertura>=cierre");

// ── cubreHorarioOperativo ─────────────────────────────────────────────────────
assert.equal(cubreHorarioOperativo("10:00", "22:00", []), false, "0 jornadas no cubre");
assert.equal(cubreHorarioOperativo("10:00", "22:00", [{ hora_inicio: "10:00", hora_fin: "22:00" }]), true, "cobertura total");
assert.equal(cubreHorarioOperativo("10:00", "22:00", [{ hora_inicio: "10:00", hora_fin: "14:00" }]), false, "cobertura parcial → hueco");
assert.equal(cubreHorarioOperativo("10:00", "22:00", [
  { hora_inicio: "10:00", hora_fin: "16:00" },
  { hora_inicio: "16:00", hora_fin: "22:00" },
]), true, "dos tramos contiguos cubren");
assert.equal(cubreHorarioOperativo("10:00", "22:00", [
  { hora_inicio: "10:00", hora_fin: "15:00" },
  { hora_inicio: "16:00", hora_fin: "22:00" },
]), false, "hueco 15–16");

// ── validarAnioMes / fechaEnMes ───────────────────────────────────────────────
assert.equal(validarAnioMes(2026, 8).ok, true);
assert.equal(validarAnioMes(2026, 13).ok, false, "mes 13 inválido");
assert.equal(validarAnioMes(1999, 8).ok, false, "año fuera de rango");
assert.equal(fechaEnMes("2026-08-15", 2026, 8), true);
assert.equal(fechaEnMes("2026-09-01", 2026, 8), false, "fecha de otro mes");
assert.equal(fechaEnMes("2026-08-32", 2026, 8), false, "día inexistente");

console.log("OK — cronograma (puro): presencia (inexistente/cerrado/fuera-horario/manual/simultáneos/Ramiro-manual/bordes/borrador), validación de día (inicio<fin, dentro de horario, superposición mismo vs distinto, cerrado), cobertura/huecos, mes/fecha.");
