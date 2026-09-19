import { strict as assert } from "node:assert";
import { validarSeleccion, minutosRequeridos } from "@/lib/mensualidadesReserva";
import { CONDICIONES_RESERVA, CONDICIONES_RESERVA_VERSION } from "@/lib/mensualidadesCondiciones";
import { DURACIONES_POR_PRODUCTO } from "@/lib/agenda";

// Test PURO del Bloque M5A: validación de la selección y cálculo de consumo.
// Sin DB, sin red. Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM5A.test.ts
// (necesita el env solo porque el módulo importa supabaseAdmin para la RPC.)

const HOY = "2026-06-10";      // miércoles
const MANANA = "2026-06-11";   // jueves, día de semana
const FINDE = "2026-06-13";    // sábado
const LIMITE = "2026-06-25";   // hoy + 15
const PASADO_LIMITE = "2026-06-26";

const base = {
  fecha: MANANA, hora: "10:00", duracion_minutos: 15,
  simuladores: ["Ferrari", "McLaren"], acepto_condiciones: true,
  idempotency_key: "abcdefghij1234567890",
};
const sel = (extra: Record<string, unknown> = {}) => validarSeleccion({ ...base, ...extra }, HOY);
const codigoDe = (r: ReturnType<typeof sel>) => (r.ok ? "ok" : r.codigo);

// ── Consumo: los cuatro ejemplos obligatorios del bloque ────────────────────
assert.equal(minutosRequeridos(15, 1), 15);
assert.equal(minutosRequeridos(30, 2), 60);
assert.equal(minutosRequeridos(45, 3), 135);
assert.equal(minutosRequeridos(60, 4), 240);
// Y siempre múltiplo de 15, para cualquier combinación válida.
for (const d of [15, 30, 45, 60]) {
  for (const n of [1, 2, 3, 4]) {
    assert.equal(minutosRequeridos(d, n) % 15, 0, `${d}x${n} tiene que ser múltiplo de 15`);
  }
}

// ── Duraciones ─────────────────────────────────────────────────────────────
for (const d of [15, 30, 45, 60]) {
  assert.equal(codigoDe(sel({ duracion_minutos: d })), "ok", `${d} min es válida para mensualidad`);
}
for (const d of [0, 10, 20, 25, 75, 90, -15, 15.5, "30 ", "0x1E", null]) {
  assert.equal(codigoDe(sel({ duracion_minutos: d })), "duracion_invalida", `${String(d)} no puede pasar`);
}
// Reservas normales siguen SIN 45/60: la política vive en la fuente única.
assert.deepEqual([...DURACIONES_POR_PRODUCTO.reserva], [15, 30]);
assert.deepEqual([...DURACIONES_POR_PRODUCTO.mensualidad], [15, 30, 45, 60]);

// ── Ventana de fechas (regla pública canónica de M6) ────────────────────────
assert.equal(codigoDe(sel({ fecha: HOY })), "fecha_fuera_de_ventana", "hoy no se puede");
assert.equal(codigoDe(sel({ fecha: "2026-06-09" })), "fecha_fuera_de_ventana", "ayer tampoco");
assert.equal(codigoDe(sel({ fecha: MANANA })), "ok", "mañana sí");
assert.equal(codigoDe(sel({ fecha: LIMITE })), "ok", "hoy + 15 sí");
assert.equal(codigoDe(sel({ fecha: PASADO_LIMITE })), "fecha_fuera_de_ventana", "hoy + 16 no");
assert.equal(codigoDe(sel({ fecha: "2026-02-31" })), "fecha_invalida", "fecha que no existe");
assert.equal(codigoDe(sel({ fecha: "11/06/2026" })), "fecha_invalida", "formato ajeno");

// ── Horarios y bloques (sin duplicar el calendario) ─────────────────────────
assert.equal(codigoDe(sel({ hora: "09:40" })), "hora_invalida", "antes de abrir");
assert.equal(codigoDe(sel({ hora: "22:00" })), "hora_invalida", "después de cerrar");
assert.equal(codigoDe(sel({ hora: "10:10" })), "hora_invalida", "fuera de la grilla de 20");
// Último inicio válido y primero inválido por duración, en día de semana.
const ultimos: Array<[number, string, string]> = [
  [15, "21:40", ""], [30, "21:20", "21:40"], [45, "21:00", "21:20"], [60, "20:40", "21:00"],
];
for (const [d, ultimo, primeroMalo] of ultimos) {
  assert.equal(codigoDe(sel({ duracion_minutos: d, hora: ultimo })), "ok",
    `semana ${d} min entra a las ${ultimo}`);
  if (primeroMalo) {
    assert.equal(codigoDe(sel({ duracion_minutos: d, hora: primeroMalo })), "sin_bloques",
      `semana ${d} min ya no entra a las ${primeroMalo}`);
  }
}
// (M5C.1) El fin de semana ya no existe para Mensualidades. La grilla corta de
// sábado y domingo sigue viva —es la de Reservas normales—, pero acá se corta
// antes, por el día, y no llega ni a mirar la hora.
for (const [d, hora] of [[15, "14:00"], [30, "13:40"], [45, "13:20"], [60, "13:00"]] as const) {
  assert.equal(codigoDe(sel({ fecha: FINDE, duracion_minutos: d, hora })), "dia_no_habilitado",
    `finde ${d} min a las ${hora} ya no se puede con mensualidad`);
}
// Y tampoco en un horario que en la semana sería perfectamente válido.
assert.equal(codigoDe(sel({ fecha: FINDE, hora: "10:00" })), "dia_no_habilitado",
  "el sábado se rechaza por el día, no por el horario");

// Los bloques que salen son los que va a recibir la RPC.
const r60 = sel({ duracion_minutos: 60, hora: "12:00" });
assert.ok(r60.ok);
if (r60.ok) assert.deepEqual(r60.value.bloques, ["12:00", "12:20", "12:40", "13:00"]);
const r45 = sel({ duracion_minutos: 45, hora: "12:00" });
assert.ok(r45.ok);
if (r45.ok) assert.deepEqual(r45.value.bloques, ["12:00", "12:20", "12:40"]);

// ── Simuladores (M5C.1: de 2 a 4, nunca uno solo) ──────────────────────────
const TODAS = ["Ferrari", "McLaren", "Red Bull", "Alpine"];
for (let n = 2; n <= 4; n++) {
  assert.equal(codigoDe(sel({ simuladores: TODAS.slice(0, n) })), "ok", `${n} simuladores`);
}
assert.equal(codigoDe(sel({ simuladores: [] })), "simuladores_invalidos", "0 no");
assert.equal(codigoDe(sel({ simuladores: ["Ferrari"] })), "simuladores_invalidos",
  "(M5C.1) uno solo tampoco, aunque esté libre");
assert.equal(codigoDe(sel({ simuladores: [...TODAS, "Ferrari"] })), "simuladores_invalidos", "5 no");
assert.equal(codigoDe(sel({ simuladores: "Ferrari" })), "simuladores_invalidos", "tiene que ser lista");
assert.equal(codigoDe(sel({ simuladores: ["Ferrari", "Ferrari"] })), "simuladores_duplicados");
assert.equal(codigoDe(sel({ simuladores: ["Ferrari", "Williams"] })), "simulador_desconocido");
assert.equal(codigoDe(sel({ simuladores: ["ferrari", "McLaren"] })), "simulador_desconocido",
  "distingue mayúsculas");

// ── Condiciones: obligatorias y nunca por defecto ──────────────────────────
assert.equal(codigoDe(sel({ acepto_condiciones: false })), "condiciones");
assert.equal(codigoDe(sel({ acepto_condiciones: undefined })), "condiciones");
assert.equal(codigoDe(sel({ acepto_condiciones: "true" })), "condiciones", "un string no acepta nada");
assert.equal(codigoDe(sel({ acepto_condiciones: 1 })), "condiciones");
assert.ok(CONDICIONES_RESERVA.length >= 4, "hay texto de condiciones de reserva");
// (M8A.1) La versión ya no queda fijada al bloque que la creó: el texto cambió
// cuando se corrigió la altura mínima. Lo que importa es que tenga forma de
// versión y que suba cuando el contenido cambia de fondo.
assert.match(CONDICIONES_RESERVA_VERSION, /^\d{4}-\d{2}-[a-z0-9]+$/);
assert.ok(CONDICIONES_RESERVA.some((c) => c.includes("1,40 m")), "declara la altura mínima vigente");
assert.ok(CONDICIONES_RESERVA.some((c) => c.includes("110 kg")), "declara el peso máximo");
assert.ok(CONDICIONES_RESERVA.some((c) => /cancelación|reprogramación/i.test(c)),
  "avisa de las políticas de cancelación y reprogramación");
// No pide datos de los acompañantes.
assert.ok(!CONDICIONES_RESERVA.some((c) => /nombre de cada|documento|DNI/i.test(c)));

// ── Idempotencia ───────────────────────────────────────────────────────────
assert.equal(codigoDe(sel({ idempotency_key: "corta" })), "idempotency_invalida");
assert.equal(codigoDe(sel({ idempotency_key: "" })), "idempotency_invalida");
assert.equal(codigoDe(sel({ idempotency_key: "a".repeat(65) })), "idempotency_invalida");
assert.equal(codigoDe(sel({ idempotency_key: "clave con espacios 12345" })), "idempotency_invalida");
assert.equal(codigoDe(sel({ idempotency_key: "a".repeat(16) })), "ok", "16 es el mínimo");
assert.equal(codigoDe(sel({ idempotency_key: "a".repeat(64) })), "ok", "64 es el máximo");

// ── El cliente no puede mandar datos del titular ni el consumo ─────────────
const conBasura = sel({
  nombre: "Otro", telefono: "3510000000", email: "otro@test.local",
  minutos_consumidos: 1, total: 999, mensualidad_id: "no-soy-yo", cobertura: "gratis",
});
assert.ok(conBasura.ok, "los campos de más se ignoran, no rompen");
if (conBasura.ok) {
  assert.deepEqual(Object.keys(conBasura.value).sort(), [
    "aceptoCondiciones", "bloques", "duracion", "fecha", "hora", "idempotencyKey", "simuladores",
  ], "la selección validada no arrastra nada del titular ni del importe");
}

console.log("mensualidadesM5A.test.ts OK");
