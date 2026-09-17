import { strict as assert } from "node:assert";
import {
  DURACIONES_POR_PRODUCTO, REGLAS_POR_PRODUCTO, WEEKDAY_SLOTS, WEEKEND_SLOTS,
  bloquesDeAgenda, bloquesDeAgendaPara, cantidadSimuladoresValida,
  cantidadSimuladoresValidaPara, diaHabilitadoPara, duracionValidaPara,
  fechasPublicas, fechasPublicasPara, horariosDe, horariosPosibles,
  horariosPosiblesPara, terminaAntesDelCierre,
} from "@/lib/agenda";

// Test PURO de las restricciones exclusivas de Mensualidades (Bloque M5C.1).
// Sin DB, sin red. Ejecutar: npx tsx lib/mensualidadesM5C1.test.ts
//
// Se prueban DOS cosas a la vez, y la segunda importa tanto como la primera:
//   1. Mensualidades queda restringida: lunes a viernes, de 10:00 a 22:00 con
//      la experiencia terminada al cierre, 15/30/45/60 y de 2 a 4 simuladores.
//   2. Reservas normales NO cambia. El motor de agenda es el mismo; lo que se
//      agregó es un FILTRO por producto. Por eso casi cada caso de Mensualidades
//      tiene su espejo en "reserva", comprobando que ahí sigue todo igual.
//
// Nada de esto depende de qué simulador sea cuál: las reglas son por CANTIDAD.

// Semana de referencia (2026): lun 21 · mar 22 · mié 23 · jue 24 · vie 25 ·
// sáb 26 · dom 27 de septiembre.
const LUNES = "2026-09-21";
const MARTES = "2026-09-22";
const MIERCOLES = "2026-09-23";
const JUEVES = "2026-09-24";
const VIERNES = "2026-09-25";
const SABADO = "2026-09-26";
const DOMINGO = "2026-09-27";

function main() {
  // ── 1) Días: Mensualidades opera de lunes a viernes ──
  const habiles = [[LUNES, "lunes"], [MARTES, "martes"], [MIERCOLES, "miércoles"],
    [JUEVES, "jueves"], [VIERNES, "viernes"]] as const;
  for (const [dia, nombre] of habiles) {
    assert.equal(diaHabilitadoPara("mensualidad", dia), true, `${nombre} habilitado`);
  }
  assert.equal(diaHabilitadoPara("mensualidad", SABADO), false, "sábado rechazado");
  assert.equal(diaHabilitadoPara("mensualidad", DOMINGO), false, "domingo rechazado");

  // Espejo: Reservas normales opera los siete días, como antes de M5C.1.
  for (const dia of [LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO]) {
    assert.equal(diaHabilitadoPara("reserva", dia), true,
      "Reservas normales no perdió ningún día");
  }

  // Basura de entrada: no se adivina.
  for (const malo of ["", "2026-13-01", "20260921", "hoy", "2026-09-31"]) {
    assert.equal(diaHabilitadoPara("mensualidad", malo), false, `fecha inválida: ${malo}`);
  }

  // ── 2) Cantidad de simuladores: 2, 3 o 4. Nunca 1, nunca 5 ──
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 1), false, "un simulador rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 2), true, "dos permitidos");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 3), true, "tres permitidos");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 4), true, "cuatro permitidos");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 5), false, "cinco rechazados");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 0), false, "cero rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", -2), false, "negativo rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 2.5), false, "fraccionario rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", " 2 "), false, "string sucio rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", "2"), true, "string limpio aceptado");

  // Espejo: en Reservas normales UNO sigue siendo válido.
  assert.equal(cantidadSimuladoresValidaPara("reserva", 1), true,
    "Reservas normales sigue aceptando un simulador");
  assert.equal(cantidadSimuladoresValidaPara("reserva", 4), true);
  assert.equal(cantidadSimuladoresValidaPara("reserva", 5), false);
  // Y el helper viejo, sin producto, tampoco cambió: es el que usa Reservas.
  assert.equal(cantidadSimuladoresValida(1), true, "el helper histórico no se tocó");
  assert.equal(cantidadSimuladoresValida(4), true);
  assert.equal(cantidadSimuladoresValida(5), false);

  // ── 3) Duraciones ──
  assert.deepEqual([...DURACIONES_POR_PRODUCTO.mensualidad], [15, 30, 45, 60]);
  assert.deepEqual([...DURACIONES_POR_PRODUCTO.reserva], [15, 30],
    "45 y 60 siguen siendo exclusivas de Mensualidades");
  for (const d of [15, 30, 45, 60]) {
    assert.equal(duracionValidaPara("mensualidad", d), true, `${d} min permitido`);
  }
  for (const d of [45, 60]) {
    assert.equal(duracionValidaPara("reserva", d), false, `${d} min no existe en Reservas`);
  }

  // ── 4) Horario: la grilla arranca 10:00 y la experiencia termina <= 22:00 ──
  assert.equal(WEEKDAY_SLOTS[0], "10:00", "antes de las 10:00 no hay agenda");
  assert.equal(WEEKDAY_SLOTS[WEEKDAY_SLOTS.length - 1], "21:40");
  for (const temprano of ["08:00", "09:00", "09:40", "09:59"]) {
    assert.equal(bloquesDeAgendaPara("mensualidad", LUNES, temprano, 15), null,
      `${temprano} es antes de la apertura`);
  }

  // Terminar EXACTAMENTE a las 22:00 vale, en las cuatro duraciones.
  assert.equal(terminaAntesDelCierre("mensualidad", "21:45", 15), true);
  assert.equal(terminaAntesDelCierre("mensualidad", "21:30", 30), true);
  assert.equal(terminaAntesDelCierre("mensualidad", "21:15", 45), true);
  assert.equal(terminaAntesDelCierre("mensualidad", "21:00", 60), true);
  // Un minuto después, no.
  assert.equal(terminaAntesDelCierre("mensualidad", "21:46", 15), false);
  assert.equal(terminaAntesDelCierre("mensualidad", "21:31", 30), false);
  assert.equal(terminaAntesDelCierre("mensualidad", "21:16", 45), false);
  assert.equal(terminaAntesDelCierre("mensualidad", "21:01", 60), false);
  assert.equal(terminaAntesDelCierre("mensualidad", "22:00", 15), false,
    "arrancar al cierre no es terminar al cierre");
  for (const basura of ["", "9:00", "25:00", "21:99", "21-00"]) {
    assert.equal(terminaAntesDelCierre("mensualidad", basura, 15), false, `hora basura: ${basura}`);
  }

  // La grilla real de 20 minutos es todavía más estricta que el cierre, y esos
  // son los últimos inicios que Mensualidades puede ofrecer de verdad.
  const ultimo = (d: number) => {
    const hs = horariosPosiblesPara("mensualidad", LUNES, d);
    return hs[hs.length - 1];
  };
  assert.equal(ultimo(15), "21:40");
  assert.equal(ultimo(30), "21:20");
  assert.equal(ultimo(45), "21:00");
  assert.equal(ultimo(60), "20:40");
  // Y el primero siempre es la apertura.
  assert.equal(horariosPosiblesPara("mensualidad", LUNES, 60)[0], "10:00");

  // ── 5) Los bloques por producto suman día + cierre al chequeo de M6 ──
  assert.deepEqual(bloquesDeAgendaPara("mensualidad", VIERNES, "20:40", 60),
    ["20:40", "21:00", "21:20", "21:40"], "viernes 20:40 de 60 min: cuatro bloques contiguos");
  assert.equal(bloquesDeAgendaPara("mensualidad", SABADO, "11:00", 30), null,
    "sábado no opera para Mensualidades");
  assert.equal(bloquesDeAgendaPara("mensualidad", DOMINGO, "11:00", 30), null,
    "domingo no opera para Mensualidades");
  assert.equal(bloquesDeAgendaPara("mensualidad", LUNES, "21:00", 60), null,
    "21:00 + 60 no tiene bloques en la grilla");

  // Espejo: el sábado Reservas normales sigue teniendo su grilla corta intacta.
  assert.notEqual(bloquesDeAgenda(SABADO, "11:00", 30), null,
    "Reservas normales sigue reservando el sábado");
  assert.notEqual(bloquesDeAgendaPara("reserva", SABADO, "11:00", 30), null,
    "y también por la vía parametrizada");
  assert.deepEqual(horariosDe(SABADO), [...WEEKEND_SLOTS],
    "la grilla de fin de semana no se tocó");
  assert.deepEqual(horariosPosibles(SABADO, 30), horariosPosiblesPara("reserva", SABADO, 30),
    "para Reservas, la vía vieja y la nueva dan lo mismo");
  assert.deepEqual(horariosPosibles(LUNES, 30), horariosPosiblesPara("reserva", LUNES, 30));

  // Mensualidades el sábado no ofrece nada, aunque la grilla exista.
  assert.deepEqual(horariosPosiblesPara("mensualidad", SABADO, 30), [],
    "el sábado Mensualidades no ofrece horarios");

  // ── 6) Ventana pública: mañana .. hoy+15, y solo días hábiles ──
  const hoyDomingo = "2026-09-20";
  const publicas = fechasPublicas(hoyDomingo);
  assert.equal(publicas.length, 15);
  assert.equal(publicas[0], LUNES, "la ventana arranca mañana, nunca hoy");
  assert.equal(publicas.includes(hoyDomingo), false, "el mismo día nunca entra");
  assert.equal(publicas[publicas.length - 1], "2026-10-05", "hasta hoy + 15");

  const mens = fechasPublicasPara("mensualidad", hoyDomingo);
  assert.equal(mens.includes(hoyDomingo), false, "el mismo día tampoco para Mensualidades");
  assert.equal(mens[0], LUNES, "la primera de Mensualidades también es mañana");
  assert.equal(mens.includes(SABADO), false, "sin sábados");
  assert.equal(mens.includes(DOMINGO), false, "sin domingos");
  assert.equal(mens.includes("2026-10-06"), false, "nada más allá de hoy + 15");
  assert.equal(mens.every((f) => diaHabilitadoPara("mensualidad", f)), true);
  assert.equal(mens.every((f) => publicas.includes(f)), true,
    "Mensualidades es un SUBCONJUNTO de la ventana pública, no otra ventana");
  // De lunes a lunes hay exactamente 11 días hábiles en 15 corridos.
  assert.equal(mens.length, 11);

  // Espejo: la ventana de Reservas normales queda igual que fechasPublicas.
  assert.deepEqual(fechasPublicasPara("reserva", hoyDomingo), publicas,
    "Reservas normales conserva las 15 fechas");

  // ── 7) Las reglas están en un solo lugar y dicen lo que deben decir ──
  const r = REGLAS_POR_PRODUCTO.mensualidad;
  assert.equal(r.simuladoresMin, 2);
  assert.equal(r.simuladoresMax, 4);
  assert.equal(r.cierreMin, 22 * 60);
  assert.deepEqual([...r.diasHabilitados], [1, 2, 3, 4, 5]);
  const rn = REGLAS_POR_PRODUCTO.reserva;
  assert.equal(rn.simuladoresMin, 1, "Reservas normales no subió el mínimo");
  assert.equal(rn.simuladoresMax, 4);
  assert.deepEqual([...rn.diasHabilitados], [0, 1, 2, 3, 4, 5, 6]);

  console.log("mensualidadesM5C1.test.ts OK (restricciones de Mensualidades + Reservas intacto)");
}

main();
