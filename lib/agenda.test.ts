import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  WEEKDAY_SLOTS, WEEKEND_SLOTS, PASO_AGENDA_MIN,
  DIAS_MINIMO_ANTICIPACION, DIAS_MAXIMO_ANTICIPACION,
  DURACIONES_POR_PRODUCTO, DURACIONES_CONOCIDAS,
  bloquesPara, duracionValidaPara, cantidadSimuladoresValida,
  hoyEnSim, sumarDias, diasEntre, fechaValida, fechaDentroDeVentana,
  fechasPublicas, esFinDeSemana, horariosDe, bloquesDeAgenda, horariosPosibles,
} from "@/lib/agenda";
import { getSlotsForDate, getOccupiedSlots, DURACIONES_VALIDAS } from "@/lib/reservasSlots";
import { validarReservaInput } from "@/lib/reservasValidation";

// Ejecutar: npx tsx lib/agenda.test.ts
// Política PURA de la agenda (M6). Lo que toca base y endpoints está en
// lib/disponibilidadM6.integration.ts.

// ── 1 · Frontend y servidor salen de la MISMA fuente ───────────────────────
// getSlotsForDate (la cara histórica que usan las APIs) y horariosDe (lo que
// consume la página) tienen que devolver exactamente lo mismo.
for (const fecha of ["2026-09-09", "2026-09-12", "2026-09-13", "2026-12-31"]) {
  assert.deepEqual(getSlotsForDate(fecha), horariosDe(fecha), `misma fuente en ${fecha}`);
}
assert.equal(WEEKDAY_SLOTS.length, 36);
assert.equal(WEEKEND_SLOTS.length, 13);
assert.equal(WEEKDAY_SLOTS[0], "10:00");
assert.equal(WEEKDAY_SLOTS[WEEKDAY_SLOTS.length - 1], "21:40");
assert.equal(WEEKEND_SLOTS[0], "10:00");
assert.equal(WEEKEND_SLOTS[WEEKEND_SLOTS.length - 1], "14:00");
// La grilla es realmente de 20 minutos y sin saltos.
for (const lista of [WEEKDAY_SLOTS, WEEKEND_SLOTS]) {
  for (let i = 1; i < lista.length; i++) {
    const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    assert.equal(min(lista[i]) - min(lista[i - 1]), PASO_AGENDA_MIN,
      `salto inesperado entre ${lista[i - 1]} y ${lista[i]}`);
  }
}

// ── 2-5 · Ventana pública: mañana … hoy + 15 ───────────────────────────────
const HOY = "2026-09-15";
assert.equal(DIAS_MINIMO_ANTICIPACION, 1, "nunca se reserva para hoy");
assert.equal(DIAS_MAXIMO_ANTICIPACION, 15);
assert.equal(fechaDentroDeVentana(HOY, HOY), false, "2 · hoy rechazado");
assert.equal(fechaDentroDeVentana(sumarDias(HOY, -1), HOY), false, "ayer rechazado");
assert.equal(fechaDentroDeVentana(sumarDias(HOY, 1), HOY), true, "3 · mañana aceptado");
assert.equal(fechaDentroDeVentana(sumarDias(HOY, 15), HOY), true, "4 · hoy + 15 aceptado");
assert.equal(fechaDentroDeVentana(sumarDias(HOY, 16), HOY), false, "5 · hoy + 16 rechazado");
// La lista ofrecida son exactamente esas 15 fechas, en orden, empezando mañana.
const fechas = fechasPublicas(HOY);
assert.equal(fechas.length, 15, "se ofrecen 15 fechas, como hoy en /reservas");
assert.equal(fechas[0], sumarDias(HOY, 1));
assert.equal(fechas[14], sumarDias(HOY, 15));
assert.ok(!fechas.includes(HOY), "hoy nunca aparece en la lista");
assert.deepEqual(fechas, [...fechas].sort(), "las fechas vienen ordenadas");

// ── 6 · Zona de Córdoba cerca de medianoche ────────────────────────────────
// 03:30 UTC = 00:30 en Córdoba (UTC-3): ya es el día siguiente allá.
assert.equal(hoyEnSim(new Date("2026-09-15T03:30:00Z")), "2026-09-15");
// 02:30 UTC = 23:30 del día anterior en Córdoba.
assert.equal(hoyEnSim(new Date("2026-09-15T02:30:00Z")), "2026-09-14");
// 23:59 local de Córdoba sigue siendo el mismo día.
assert.equal(hoyEnSim(new Date("2026-09-15T02:59:59Z")), "2026-09-14");
assert.equal(hoyEnSim(new Date("2026-09-15T03:00:00Z")), "2026-09-15");

// ── 7 · Fin de mes ─────────────────────────────────────────────────────────
assert.equal(sumarDias("2026-01-31", 1), "2026-02-01");
assert.equal(sumarDias("2026-02-28", 1), "2026-03-01", "2026 no es bisiesto");
assert.equal(sumarDias("2028-02-28", 1), "2028-02-29", "2028 sí es bisiesto");
assert.equal(sumarDias("2026-04-30", 1), "2026-05-01");
assert.equal(fechasPublicas("2026-01-25")[14], "2026-02-09", "la ventana cruza de mes");
assert.equal(diasEntre("2026-01-31", "2026-02-01"), 1);

// ── 8 · Cambio de año ──────────────────────────────────────────────────────
assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
assert.deepEqual(fechasPublicas("2026-12-25").slice(6, 9), ["2027-01-01", "2027-01-02", "2027-01-03"]);
assert.equal(diasEntre("2026-12-31", "2027-01-01"), 1);
assert.equal(fechaDentroDeVentana("2027-01-09", "2026-12-25"), true);
assert.equal(fechaDentroDeVentana("2027-01-10", "2026-12-25"), false);

// ── 9-10 · Día de semana y fin de semana ───────────────────────────────────
assert.equal(esFinDeSemana("2026-09-16"), false, "miércoles");
assert.equal(esFinDeSemana("2026-09-19"), true, "sábado");
assert.equal(esFinDeSemana("2026-09-20"), true, "domingo");
assert.equal(esFinDeSemana("2026-09-21"), false, "lunes");
assert.equal(horariosDe("2026-09-16").length, 36, "9 · día de semana");
assert.equal(horariosDe("2026-09-19").length, 13, "10 · fin de semana");

// ── 11 · Horarios y fechas inexistentes ────────────────────────────────────
assert.equal(bloquesDeAgenda("2026-09-16", "09:40", 15), null, "antes de abrir");
assert.equal(bloquesDeAgenda("2026-09-16", "22:00", 15), null, "después de cerrar");
assert.equal(bloquesDeAgenda("2026-09-16", "10:10", 15), null, "fuera de la grilla");
assert.equal(bloquesDeAgenda("2026-09-19", "15:00", 15), null, "no existe el finde");
assert.equal(fechaValida("2026-02-31"), false, "fecha imposible");
assert.equal(fechaValida("2026-13-01"), false);
assert.equal(fechaValida("16/09/2026"), false);
assert.deepEqual(horariosDe("2026-02-31"), []);

// ── 12-15 · Duración → bloques ─────────────────────────────────────────────
assert.equal(bloquesPara(15), 1, "12 · 15 min → 1 bloque");
assert.equal(bloquesPara(30), 2, "13 · 30 min → 2 bloques");
assert.equal(bloquesPara(45), 3, "14 · 45 min → 3 bloques");
assert.equal(bloquesPara(60), 4, "15 · 60 min → 4 bloques");
assert.deepEqual(bloquesDeAgenda("2026-09-16", "10:00", 15), ["10:00"]);
assert.deepEqual(bloquesDeAgenda("2026-09-16", "10:00", 30), ["10:00", "10:20"]);
assert.deepEqual(bloquesDeAgenda("2026-09-16", "10:00", 45), ["10:00", "10:20", "10:40"]);
assert.deepEqual(bloquesDeAgenda("2026-09-16", "10:00", 60), ["10:00", "10:20", "10:40", "11:00"]);

// ── 32 · Inputs manipulados en la duración ─────────────────────────────────
for (const malo of [0, -15, -1, 20, 25, 40, 75, 90, 1.5, 15.0001, NaN, Infinity,
                    null, undefined, "", "abc", "15abc", " 30 ", "0x1E", [], {}, true]) {
  assert.equal(bloquesPara(malo as unknown), null, `duración inválida aceptada: ${String(malo)}`);
}
// Un string de dígitos limpio sí se acepta (los bodies JSON llegan así).
assert.equal(bloquesPara("30"), 2);

// ── 16-17 · Duraciones por producto ────────────────────────────────────────
assert.deepEqual([...DURACIONES_POR_PRODUCTO.reserva], [15, 30]);
assert.deepEqual([...DURACIONES_POR_PRODUCTO.mensualidad], [15, 30, 45, 60]);
assert.deepEqual([...DURACIONES_VALIDAS], [15, 30], "reservasSlots sigue exponiendo 15/30");
assert.equal(duracionValidaPara("reserva", 15), true);
assert.equal(duracionValidaPara("reserva", 30), true);
assert.equal(duracionValidaPara("reserva", 45), false, "16 · reserva normal rechaza 45");
assert.equal(duracionValidaPara("reserva", 60), false, "16 · reserva normal rechaza 60");
assert.equal(duracionValidaPara("mensualidad", 45), true, "17 · mensualidad admite 45");
assert.equal(duracionValidaPara("mensualidad", 60), true, "17 · mensualidad admite 60");
assert.equal(duracionValidaPara("mensualidad", 90), false);
assert.deepEqual([...DURACIONES_CONOCIDAS], [15, 30, 45, 60]);

// ── 18-19 · Últimos inicios válidos e inválidos por duración ───────────────
const SEMANA = "2026-09-16";
const FINDE = "2026-09-19";
const ultimos: Array<[string, number, string, string]> = [
  // fecha, duración, último inicio VÁLIDO, primer inicio INVÁLIDO después de él
  [SEMANA, 15, "21:40", "22:00"],
  [SEMANA, 30, "21:20", "21:40"],
  [SEMANA, 45, "21:00", "21:20"],
  [SEMANA, 60, "20:40", "21:00"],
  [FINDE, 15, "14:00", "14:20"],
  [FINDE, 30, "13:40", "14:00"],
  [FINDE, 45, "13:20", "13:40"],
  [FINDE, 60, "13:00", "13:20"],
];
for (const [fecha, dur, ultimoOk, primerMal] of ultimos) {
  const ok = bloquesDeAgenda(fecha, ultimoOk, dur);
  assert.ok(ok, `18 · ${dur} min debería entrar en ${ultimoOk} (${fecha})`);
  assert.equal(ok!.length, bloquesPara(dur));
  assert.equal(bloquesDeAgenda(fecha, primerMal, dur), null,
    `19 · ${dur} min NO debería entrar en ${primerMal} (${fecha})`);
  // horariosPosibles corta en el mismo lugar.
  const posibles = horariosPosibles(fecha, dur);
  assert.equal(posibles[posibles.length - 1], ultimoOk, `18 · último posible de ${dur} en ${fecha}`);
  assert.ok(!posibles.includes(primerMal));
}
// Cuantos más bloques, menos inicios ofrecidos.
assert.ok(horariosPosibles(SEMANA, 15).length > horariosPosibles(SEMANA, 30).length);
assert.ok(horariosPosibles(SEMANA, 30).length > horariosPosibles(SEMANA, 45).length);
assert.ok(horariosPosibles(SEMANA, 45).length > horariosPosibles(SEMANA, 60).length);
assert.equal(horariosPosibles(SEMANA, 60).length, 33, "36 inicios − 3 que no entran");

// ── 20 · Discontinuidad horaria ────────────────────────────────────────────
// Con una grilla hipotética con un corte, las posiciones siguientes del array NO
// alcanzan: la experiencia larga tiene que rechazarse. Se comprueba la regla
// midiendo minutos reales, que es lo que hace bloquesDeAgenda.
{
  const conCorte = ["10:00", "10:20", "13:00", "13:20"];
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  // Contiguos de verdad: solo el primer par y el último.
  assert.equal(min(conCorte[1]) - min(conCorte[0]), PASO_AGENDA_MIN);
  assert.notEqual(min(conCorte[2]) - min(conCorte[1]), PASO_AGENDA_MIN,
    "20 · hay un salto real entre 10:20 y 13:00");
  // Y en el calendario real, 45 min desde el antepenúltimo del finde no entra.
  assert.equal(bloquesDeAgenda(FINDE, "13:40", 45), null);
}

// ── 30-31 · Cantidad de simuladores ────────────────────────────────────────
for (const n of [1, 2, 3, 4]) assert.ok(cantidadSimuladoresValida(n), `30 · ${n} simuladores`);
for (const n of [0, 5, 6, -1, 1.5, "", "abc", null, undefined, [], {}]) {
  assert.ok(!cantidadSimuladoresValida(n as unknown), `31 · cantidad inválida aceptada: ${String(n)}`);
}
assert.ok(cantidadSimuladoresValida("3"), "los bodies JSON llegan como string");

// ── validarReservaInput usa la misma política ──────────────────────────────
const baseReserva = {
  nombre: "Ana", telefono: "3515123456", simuladores: ["Ferrari"],
  acepto_condiciones: true, hora: "10:00",
};
const conFecha = (f: string, extra: Record<string, unknown> = {}) =>
  validarReservaInput({ ...baseReserva, fecha: f, ...extra }, { hoy: HOY });

assert.equal(conFecha(HOY).ok, false, "el servidor tampoco acepta hoy");
assert.equal(conFecha(sumarDias(HOY, 1)).ok, true, "mañana sí");
assert.equal(conFecha(sumarDias(HOY, 15)).ok, true, "hoy + 15 sí");
assert.equal(conFecha(sumarDias(HOY, 16)).ok, false, "hoy + 16 no");
assert.equal(conFecha(sumarDias(HOY, 120)).ok, false, "ya no se aceptan 120 días");
// 45 y 60 no existen para una reserva normal, ni siquiera desde el body.
for (const d of [45, 60, 90, 20]) {
  const r = conFecha(sumarDias(HOY, 2), { duracion_minutos: d });
  assert.equal(r.ok, false, `una reserva normal no puede pedir ${d} minutos`);
  if (!r.ok) assert.equal(r.error, "Duración inválida");
}
// Con el producto mensualidad, 45 y 60 sí.
for (const d of [15, 30, 45, 60]) {
  const r = validarReservaInput(
    { ...baseReserva, fecha: sumarDias(HOY, 2), duracion_minutos: d },
    { hoy: HOY, producto: "mensualidad" },
  );
  assert.equal(r.ok, true, `mensualidad debería aceptar ${d} minutos`);
  if (r.ok) assert.equal(r.value.bloques.length, bloquesPara(d));
}
// Sin duración explícita se mantiene el default histórico de 15.
{
  const r = conFecha(sumarDias(HOY, 2));
  assert.ok(r.ok && r.value.duracion === 15);
}
// 30 minutos en el último horario del día no entra.
assert.equal(conFecha(sumarDias(HOY, 2), { hora: "21:40", duracion_minutos: 30 }).ok, false);

// ── getOccupiedSlots conserva su contrato histórico ────────────────────────
assert.deepEqual(getOccupiedSlots(SEMANA, "10:00", 15), ["10:00"]);
assert.deepEqual(getOccupiedSlots(SEMANA, "10:00", 30), ["10:00", "10:20"]);
// Nunca devuelve vacío, ni siquiera donde la duración no entra (los nueve
// consumidores históricos dependen de eso).
assert.deepEqual(getOccupiedSlots(SEMANA, "21:40", 30), ["21:40"]);
assert.deepEqual(getOccupiedSlots(SEMANA, "99:99", 15), ["99:99"]);

// ── Anti-duplicación estructural ───────────────────────────────────────────
// Si alguien vuelve a copiar los horarios, la ventana o el mapeo de bloques en
// otro archivo, este test lo detecta.
function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, acc);
    // Solo código de producción: los tests y fixtures contienen estos patrones
    // a propósito (son justamente los que verifican la política).
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.(test|integration|fixtures)\.tsx?$/.test(nombre)) {
      acc.push(ruta);
    }
  }
  return acc;
}
const raiz = join(process.cwd(), "app");
const libs = join(process.cwd(), "lib");
const fuentes = [...archivosFuente(raiz), ...archivosFuente(libs)];

const conHorarios: string[] = [];
const conVentana: string[] = [];
const conMapeo: string[] = [];
for (const f of fuentes) {
  const txt = readFileSync(f, "utf8");
  const rel = f.replace(process.cwd(), "").replace(/\\/g, "/");
  // Una lista de horarios de verdad: varios "HH:MM" seguidos del calendario.
  if (/"10:00",\s*"10:20",\s*"10:40"/.test(txt)) conHorarios.push(rel);
  // Otra DECLARACIÓN de ventana paralela (mencionarlas en un comentario está bien).
  if (/(const|let|var)\s+(MAX_BOOKING_DAYS|MAX_FUTURO_DIAS)\s*=/.test(txt)) conVentana.push(rel);
  // Otro mapeo duración → bloques: solo puede declararse una vez.
  if (/function bloquesPara\b|function bloquesDeAgenda\b/.test(txt)) conMapeo.push(rel);
}
assert.deepEqual(conHorarios, ["/lib/agenda.ts"],
  `los horarios deben estar SOLO en lib/agenda.ts; aparecen en: ${conHorarios.join(", ")}`);
assert.deepEqual(conVentana, [],
  `no puede volver una constante de ventana paralela; aparece en: ${conVentana.join(", ")}`);
assert.deepEqual(conMapeo, ["/lib/agenda.ts"],
  `el mapeo duración → bloques debe estar SOLO en lib/agenda.ts; aparece en: ${conMapeo.join(", ")}`);
// Y la página de reservas no puede volver a definir su propia política.
const pagina = readFileSync(join(raiz, "reservas", "page.tsx"), "utf8");
assert.ok(!/weekdayTimeSlots|weekendTimeSlots/.test(pagina),
  "app/reservas/page.tsx no puede volver a tener listas propias de horarios");
assert.ok(/from "@\/lib\/agenda"/.test(pagina),
  "app/reservas/page.tsx debe consumir la fuente única");

console.log(`agenda.test.ts OK (${fuentes.length} archivos revisados)`);
