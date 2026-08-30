import { strict as assert } from "node:assert";
import { calcularHorasMensuales, formatHoras, type DiaHoras } from "@/lib/cronograma";

// Ejecutar: npx tsx lib/cronogramaHoras.test.ts
// Horas efectivas por integrante (Bloque 2C). Minutos enteros; sin dividir; huecos
// del horario operativo → fallback (Ramiro), sin doble conteo.

const RAMIRO = "11111111-1111-1111-1111-111111111111";
const FRAN = "22222222-2222-2222-2222-222222222222";
const FEDE = "33333333-3333-3333-3333-333333333333";
const H = (min: number) => min * 60; // atajo horas→min no usado; ver abajo

const dia = (jornadas: Array<{ id: string; i: string; f: string }>, over: Partial<DiaHoras> = {}): DiaHoras => ({
  cerrado: false,
  apertura: "10:00",
  cierre: "22:00",
  jornadas: jornadas.map((j) => ({ empleado_id: j.id, hora_inicio: j.i, hora_fin: j.f })),
  ...over,
});

// 6) Día abierto vacío → todo el horario para Ramiro (12 h = 720 min).
assert.deepEqual(calcularHorasMensuales([dia([])], RAMIRO), { [RAMIRO]: 720 }, "6: vacío → Ramiro 12 h");

// 5) Día cerrado → cero para todos.
assert.deepEqual(calcularHorasMensuales([dia([], { cerrado: true })], RAMIRO), {}, "5: cerrado → 0");

// 7) Jornada parcial → resto para Ramiro. Fede 10–18 (8 h), Ramiro 18–22 (4 h).
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: FEDE, i: "10:00", f: "18:00" }])], RAMIRO),
  { [FEDE]: 480, [RAMIRO]: 240 },
  "7: Fede 8 h, Ramiro 4 h",
);

// 8) Jornada completa → sin fallback.
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: FEDE, i: "10:00", f: "22:00" }])], RAMIRO),
  { [FEDE]: 720 },
  "8: cobertura total, Ramiro 0",
);

// 9) Superposición de dos integrantes → completas para ambos. Fede 10–20 (10 h),
//    Fran 16–22 (6 h), Ramiro 0.
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: FEDE, i: "10:00", f: "20:00" }, { id: FRAN, i: "16:00", f: "22:00" }])], RAMIRO),
  { [FEDE]: 600, [FRAN]: 360 },
  "9: Fede 10 h, Fran 6 h, Ramiro 0",
);

// 10) Dos jornadas contiguas [inicio, fin): 10–16 y 16–22 cubren todo (Ramiro 0).
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: FEDE, i: "10:00", f: "16:00" }, { id: FRAN, i: "16:00", f: "22:00" }])], RAMIRO),
  { [FEDE]: 360, [FRAN]: 360 },
  "10: contiguas cubren, Ramiro 0",
);

// 11/12) Ramiro manual + otro, sin doble conteo. Ramiro 10–15 (5 h) + Fede 12–18,
//        hueco 18–22 (4 h) → Ramiro 9 h; Fede 6 h.
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: RAMIRO, i: "10:00", f: "15:00" }, { id: FEDE, i: "12:00", f: "18:00" }])], RAMIRO),
  { [RAMIRO]: 5 * 60 + 4 * 60, [FEDE]: 360 },
  "11/12: Ramiro 9 h (5 manual + 4 fallback), Fede 6 h",
);

// Ramiro manual que cubre todo → sin fallback extra (no se recuenta).
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: RAMIRO, i: "10:00", f: "22:00" }])], RAMIRO),
  { [RAMIRO]: 720 },
  "Ramiro manual total → 12 h, sin doble conteo",
);

// 13) Minutos exactos sin errores de redondeo. Fede 10:30–12:15 (105 min); huecos
//     10:00–10:30 (30) + 12:15–22:00 (585) → Ramiro 615.
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: FEDE, i: "10:30", f: "12:15" }])], RAMIRO),
  { [FEDE]: 105, [RAMIRO]: 615 },
  "13: minutos exactos",
);

// 14) Horario operativo especial 12:00–20:00 (8 h). Fede 12–16 (4 h), Ramiro 16–20 (4 h).
assert.deepEqual(
  calcularHorasMensuales([dia([{ id: FEDE, i: "12:00", f: "16:00" }], { apertura: "12:00", cierre: "20:00" })], RAMIRO),
  { [FEDE]: 240, [RAMIRO]: 240 },
  "14: horario especial",
);

// Suma multi-día. Un día vacío (720 Ramiro) + un día Fede 10–22 (720 Fede).
assert.deepEqual(
  calcularHorasMensuales([dia([]), dia([{ id: FEDE, i: "10:00", f: "22:00" }])], RAMIRO),
  { [RAMIRO]: 720, [FEDE]: 720 },
  "multi-día acumula",
);

// Sin fallback configurado: los huecos no se asignan a nadie.
assert.deepEqual(calcularHorasMensuales([dia([])], ""), {}, "sin fallback → huecos a nadie");

// ── formatHoras ───────────────────────────────────────────────────────────────
assert.equal(formatHoras(720), "12 h", "720 → 12 h");
assert.equal(formatHoras(0), "0 h", "0 → 0 h");
assert.equal(formatHoras(105), "1 h 45 min", "105 → 1 h 45 min");
assert.equal(formatHoras(90), "1 h 30 min");
assert.equal(formatHoras(192 * 60), "192 h");

void H;
console.log("OK — cronogramaHoras (puro): vacío/cerrado/parcial/completa/superposición/contiguas/Ramiro-manual (sin doble conteo)/minutos/horario-especial/multi-día; formato X h / X h Y min.");
