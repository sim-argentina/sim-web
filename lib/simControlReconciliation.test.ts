import { strict as assert } from "node:assert";
import {
  conciliar,
  conciliarCierre,
  corteLocalDesdeUtc,
  corteAhora,
  estadoDePaqueteTrasCorrida,
  simuladorMinutosReserva,
  simuladorMinutosStand,
  totalesCentral,
  totalesSimControl,
  type FilaReservaConciliable,
  type FilaStandConciliable,
  type SesionConciliable,
} from "@/lib/simControlReconciliation";

// Ejecutar: npx tsx lib/simControlReconciliation.test.ts
//
// Conciliación AGREGADA en simulador-minutos.
//
// Las dos cosas que se prueban una y otra vez acá, porque son las que definen la política:
//  1. El nombre de la cabina NO participa del resultado.
//  2. La identidad de la terminal TAMPOCO: no se espera a que "todas" reporten. Lo único que
//     importa es que el total de SIM Control coincida con el total del central.

const FECHA = "2026-09-13";

const stand = (f: FilaStandConciliable): FilaStandConciliable => f;
const reserva = (f: FilaReservaConciliable): FilaReservaConciliable => f;
const sesion = (s: Partial<SesionConciliable>): SesionConciliable => ({
  terminal_key: "sim-01",
  local_session_id: crypto.randomUUID(),
  counts_for_reconciliation: true,
  authorized_duration_minutes: 15,
  session_type: "Commercial",
  status: "Completed",
  ...s,
});

// ── CASO A — la unidad: simulador-minutos ───────────────────────────────────────

// 1 simulador × 15 min = 15 simulador-minutos = 1 bloque.
{
  const a = simuladorMinutosStand(stand({ id: 1, estado: "activo", cantidad_simuladores: 1, cantidad_minutos: 15 }));
  assert.equal(a.simuladorMinutos, 15);
  assert.equal(totalesCentral([stand({ estado: "activo", cantidad_simuladores: 1, cantidad_minutos: 15 })], []).bloques, 1);
}

// 2 simuladores × 30 min = 60 simulador-minutos = 4 bloques.
{
  const a = simuladorMinutosStand(stand({ id: 2, estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 }));
  assert.equal(a.simuladorMinutos, 60);
  assert.equal(totalesCentral([stand({ estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 })], []).bloques, 4);
}

// 4 simuladores × 30 min = 120 simulador-minutos = 8 bloques.
{
  const a = simuladorMinutosStand(stand({ id: 3, estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 30 }));
  assert.equal(a.simuladorMinutos, 120);
  assert.equal(totalesCentral([stand({ estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 30 })], []).bloques, 8);
}

// ── CASO B — una fila de stand SIN simuladores[] concilia igual ─────────────────
// La selección de cabinas es opcional en el Turnero. Una jornada no puede quedar trabada por un
// dato visual que nadie marcó.
{
  const sinCabinas = simuladorMinutosStand(
    stand({ id: 4, estado: "activo", cantidad_simuladores: 0, cantidad_minutos: 30, cantidad_turnos: 4 })
  );
  assert.equal(sinCabinas.simuladorMinutos, 60, "cantidad_turnos × 15 = 60");
  assert.equal(sinCabinas.formula, "turnos_x_15");
  assert.equal(sinCabinas.excluidaPor, undefined, "no queda excluida por no tener cabinas cargadas");
}

// Las dos fórmulas coinciden cuando los datos están completos (invariante del Turnero:
// cantidad_turnos = cantidad_personas × cantidad_minutos / 15, una persona por cabina).
for (const [sims, minutos] of [[1, 15], [2, 15], [1, 30], [4, 30], [3, 15]] as const) {
  const turnos = sims * (minutos / 15);
  const porSims = simuladorMinutosStand(stand({ estado: "activo", cantidad_simuladores: sims, cantidad_minutos: minutos }));
  const porTurnos = simuladorMinutosStand(stand({ estado: "activo", cantidad_minutos: minutos, cantidad_turnos: turnos }));
  assert.equal(porSims.simuladorMinutos, porTurnos.simuladorMinutos, `${sims}×${minutos} debe dar lo mismo por las dos vías`);
}

// ── CASO C — exclusiones centrales ──────────────────────────────────────────────

// Cancelada de stand: no se usó.
{
  const a = simuladorMinutosStand(stand({ id: 5, estado: "cancelado", cantidad_simuladores: 2, cantidad_minutos: 30 }));
  assert.equal(a.simuladorMinutos, 0);
  assert.equal(a.excluidaPor, "cancelada");
}

// Reserva cancelada: no suma.
{
  const a = simuladorMinutosReserva(reserva({ id: 6, estado: "cancelada", duracion_minutos: 30, simuladores: ["Ferrari"] }));
  assert.equal(a.simuladorMinutos, 0);
  assert.equal(a.excluidaPor, "cancelada");
}

// Reserva no-show: se pagó pero nadie se subió. Esperar una sesión por ella sería un Mismatch falso.
{
  const a = simuladorMinutosReserva(
    reserva({ id: 7, estado: "activa", no_show: true, duracion_minutos: 30, simuladores: ["Ferrari", "Alpine"] })
  );
  assert.equal(a.simuladorMinutos, 0);
  assert.equal(a.excluidaPor, "no_show");
}

// Reserva usada: cuenta por cantidad de simuladores × duración.
{
  const a = simuladorMinutosReserva(
    reserva({ id: 8, estado: "activa", no_show: false, duracion_minutos: 30, simuladores: ["Ferrari", "Alpine"] })
  );
  assert.equal(a.simuladorMinutos, 60);
}

// ── CASO D — ni la cabina ni la terminal definen el match ──────────────────────

// Mismo total, cabinas distintas en cada lado: Verified.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 })], // "Ferrari + McLaren"
    reservas: [],
    // La actividad la registraron las terminales de otras dos cabinas. Da igual.
    sesiones: [
      sesion({ terminal_key: "sim-03", authorized_duration_minutes: 30 }),
      sesion({ terminal_key: "sim-04", authorized_duration_minutes: 30 }),
    ],
  });
  assert.equal(r.estado, "verified", "cabinas distintas con el mismo total no son un Mismatch");
  assert.equal(r.diferenciaSimuladorMinutos, 0);
}

// Futuro con todas las cabinas iguales (mismo nombre/modelo): sigue funcionando igual.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 15 })],
    reservas: [],
    sesiones: ["SIM", "SIM", "SIM", "SIM"].map((t, i) =>
      sesion({ terminal_key: `${t}-${i}`, authorized_duration_minutes: 15 })
    ),
  });
  assert.equal(r.estado, "verified");
}

// Toda la actividad desde UNA sola terminal, contra un central que la anotó como 4 cabinas: cuadra.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 15 })], // 60
    reservas: [],
    sesiones: [1, 2, 3, 4].map(() => sesion({ terminal_key: "sim-01", authorized_duration_minutes: 15 })),
  });
  assert.equal(r.estado, "verified", "el reparto entre cabinas no es asunto de la conciliación");
}

// ── CASO E — reglas de negocio de SIM Control ──────────────────────────────────

// Extensión autorizada: 15 base + 5 = 20 simulador-minutos. No es fraude ni son dos ventas.
{
  const t = totalesSimControl([sesion({ authorized_duration_minutes: 20 })]);
  assert.equal(t.simuladorMinutos, 20);
}

// Mantenimiento no suma comercialmente, pero sí viaja y se cuenta aparte para diagnóstico.
{
  const t = totalesSimControl([
    sesion({ authorized_duration_minutes: 15 }),
    sesion({ authorized_duration_minutes: 60, counts_for_reconciliation: false, session_type: "Maintenance" }),
  ]);
  assert.equal(t.simuladorMinutos, 15, "el mantenimiento no es una venta");
  assert.equal(t.sesionesMantenimiento, 1);
  assert.equal(t.sesionesNoConciliables, 1);
}

// Reinicio por incidente: viajan las dos sesiones, cuenta una sola. El cliente pagó una vez.
{
  const t = totalesSimControl([
    sesion({ authorized_duration_minutes: 15, counts_for_reconciliation: false, status: "RestartedIncident" }),
    sesion({ authorized_duration_minutes: 15 }), // el reemplazo
  ]);
  assert.equal(t.simuladorMinutos, 15, "no se cuentan dos ventas por un incidente");
  assert.equal(t.sesionesReiniciadas, 1);
}

// ── CASO F — falta sincronizar → Pending; sobra → Mismatch ─────────────────────
// La asimetría es deliberada: si faltan minutos lo más probable es que otra PC no haya sincronizado
// todavía; si sobran, esperar no arregla nada porque sumar sesiones agranda la diferencia.
{
  const central = [stand({ estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 30 })]; // 120
  const aportes = [1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 }));

  for (let i = 1; i <= 3; i++) {
    const r = conciliar({ businessDate: FECHA, stand: central, reservas: [], sesiones: aportes.slice(0, i) });
    assert.equal(r.estado, "pending", `${i * 30} de 120 todavía no permite concluir nada`);
    assert.equal(r.diferenciaSimuladorMinutos, 120 - i * 30);
    assert.ok(r.resumen.includes("Faltan"), "el resumen dice cuánto falta, no acusa una diferencia");
  }

  const completo = conciliar({ businessDate: FECHA, stand: central, reservas: [], sesiones: aportes });
  assert.equal(completo.estado, "verified");
  assert.equal(completo.central.simuladorMinutos, 120);
  assert.equal(completo.simControl.simuladorMinutos, 120);
  assert.equal(completo.central.bloques, 8);
}

// Sobra actividad: el central no la respalda.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 })], // 60
    reservas: [],
    sesiones: [
      sesion({ authorized_duration_minutes: 30 }),
      sesion({ authorized_duration_minutes: 30 }),
      sesion({ authorized_duration_minutes: 20 }),
    ], // 80
  });
  assert.equal(r.estado, "mismatch");
  assert.equal(r.diferenciaSimuladorMinutos, -20);
  assert.ok(r.resumen.includes("20"), "el resumen dice cuánto sobra y de qué lado");
}

// ── CASO G — una terminal sin uso NO traba nada ────────────────────────────────
// Cuatro cabinas configuradas, solo dos se usaron. Las otras dos nunca mandan nada.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 })], // 60
    reservas: [],
    sesiones: [
      sesion({ terminal_key: "sim-01", authorized_duration_minutes: 30 }),
      sesion({ terminal_key: "sim-02", authorized_duration_minutes: 30 }),
    ],
  });
  assert.equal(r.estado, "verified", "sim-03 y sim-04 nunca enviaron nada y no hacen falta");
  assert.deepEqual(r.terminalesQueAportaron, ["sim-01", "sim-02"], "solo para auditoría");
}

// Ni siquiera hace falta un paquete vacío de la terminal que estuvo apagada.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 1, cantidad_minutos: 90 })], // 90
    reservas: [],
    sesiones: [sesion({ terminal_key: "sim-02", authorized_duration_minutes: 90 })],
  });
  assert.equal(r.estado, "verified");
}

// ── CASO H — stand y reservas se suman sin contarse dos veces ──────────────────
// Son dominios separados: dar de alta una reserva nunca escribe en turnos_stand.
{
  const r = conciliar({
    businessDate: FECHA,
    stand: [stand({ estado: "activo", cantidad_simuladores: 1, cantidad_minutos: 15 })], // 15
    reservas: [reserva({ estado: "activa", duracion_minutos: 30, simuladores: ["Ferrari", "Alpine"] })], // 60
    sesiones: [
      sesion({ authorized_duration_minutes: 15 }),
      sesion({ authorized_duration_minutes: 30 }),
      sesion({ authorized_duration_minutes: 30 }),
    ],
  });
  assert.equal(r.central.simuladorMinutos, 75);
  assert.equal(r.estado, "verified");
  assert.equal(r.central.operacionesStand, 1);
  assert.equal(r.central.operacionesReserva, 1);
}

// ── CASO I — un día sin actividad cuadra en cero ──────────────────────────────
// Sin ninguna terminal reportando y sin ventas centrales: no hay nada que reclamar.
{
  const r = conciliar({ businessDate: FECHA, stand: [], reservas: [], sesiones: [] });
  assert.equal(r.estado, "verified");
  assert.equal(r.central.simuladorMinutos, 0);
}

// ── CASO J — números que llegan como texto ────────────────────────────────────
{
  const a = simuladorMinutosStand(stand({ estado: "activo", cantidad_simuladores: "2", cantidad_minutos: "30" }));
  assert.equal(a.simuladorMinutos, 60, "los datos de carga manual pueden venir como string");
}

// ── CASO K — una fila sin ningún dato usable se excluye, pero queda visible ────
{
  const a = simuladorMinutosStand(stand({ id: 99, estado: "activo" }));
  assert.equal(a.simuladorMinutos, 0);
  assert.equal(a.excluidaPor, "sin_datos");
  const t = totalesCentral([stand({ id: 99, estado: "activo" })], []);
  assert.equal(t.excluidas, 1, "se cuenta como excluida: nunca desaparece en silencio");
}

// ── CASO L — se vuelve a operar el MISMO día ──────────────────────────────────
// 19:00 cuadra en 120/120 y P1 queda verificado. Después se venden 60 minutos más y se cierra otra
// vez. P1 NO puede perder su verificación por actividad posterior.
{
  // 19:00 — primer cierre.
  const p1 = conciliar({
    businessDate: FECHA,
    stand: [stand({ id: "s1", estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 30 })], // 120
    reservas: [],
    sesiones: [1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
  });
  assert.equal(p1.estado, "verified");
  const estadoP1 = estadoDePaqueteTrasCorrida("data_verified", p1.estado);
  assert.equal(estadoP1, "verified");

  // 20:00 — se vuelve a operar: el central pasa a 180 y todavía no llegó P2.
  const entreCierres = conciliar({
    businessDate: FECHA,
    stand: [
      stand({ id: "s1", estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 30 }),
      stand({ id: "s2", estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 }), // +60
    ],
    reservas: [],
    sesiones: [1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
  });
  assert.equal(entreCierres.estado, "pending", "falta sincronizar lo nuevo");
  // Y sin embargo P1 sigue verificado: su comprobante no se revisa hacia atrás.
  assert.equal(estadoDePaqueteTrasCorrida(estadoP1, entreCierres.estado), "verified");

  // 22:00 — llega P2 con los 60 nuevos.
  const p2 = conciliar({
    businessDate: FECHA,
    stand: [
      stand({ id: "s1", estado: "activo", cantidad_simuladores: 4, cantidad_minutos: 30 }),
      stand({ id: "s2", estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 30 }),
    ],
    reservas: [],
    sesiones: [
      ...[1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
      ...[1, 2].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
    ],
  });
  assert.equal(p2.central.simuladorMinutos, 180);
  assert.equal(p2.simControl.simuladorMinutos, 180);
  assert.equal(p2.estado, "verified");
  assert.equal(estadoDePaqueteTrasCorrida("data_verified", p2.estado), "verified");
}

// Un paquete ya verificado nunca vuelve atrás, ni siquiera con una corrida en Mismatch.
{
  assert.equal(estadoDePaqueteTrasCorrida("verified", "pending"), "verified");
  assert.equal(estadoDePaqueteTrasCorrida("verified", "mismatch"), "verified");
  // Uno que todavía no lo estaba sí sigue la corrida.
  assert.equal(estadoDePaqueteTrasCorrida("data_verified", "pending"), "reconciliation_pending");
  assert.equal(estadoDePaqueteTrasCorrida("reconciliation_pending", "mismatch"), "mismatch");
  assert.equal(estadoDePaqueteTrasCorrida("reconciliation_pending", "verified"), "verified");
}

// ── CASO M — solo cuenta lo EFECTIVAMENTE USADO ──────────────────────────────
// El corte es el momento de la corrida, en hora local de SIM. Lo agendado para después está
// vendido, pero todavía no ocurrió: contarlo dejaría pendiente un cierre por minutos que nadie usó.

// Una reserva para las 21:00 no puede ensuciar el cierre de las 19:00.
{
  const r = conciliar({
    businessDate: FECHA,
    corte: `${FECHA}T19:00`,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 4, cantidad_minutos: 30 })], // 120
    reservas: [
      reserva({ id: "r1", estado: "activa", fecha: FECHA, hora: "21:00", duracion_minutos: 30, simuladores: ["Ferrari"] }),
    ],
    sesiones: [1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
  });

  assert.equal(r.central.simuladorMinutos, 120, "la reserva de las 21:00 todavía no ocurrió");
  assert.equal(r.estado, "verified", "120/120, no 120/150 Pending");
  assert.equal(r.central.noUsadasTodavia, 1);
  const futura = r.central.aportes.find((a) => a.id === "r1");
  assert.equal(futura?.excluidaPor, "todavia_no_usada");
}

// Esa misma reserva, ya usada, sí suma — aunque siga siendo "futura" por horario.
{
  const r = conciliar({
    businessDate: FECHA,
    corte: `${FECHA}T19:00`,
    stand: [],
    reservas: [
      reserva({
        id: "r1", estado: "activa", fecha: FECHA, hora: "21:00", duracion_minutos: 30,
        simuladores: ["Ferrari"], hora_subida: "18:40", // se adelantaron y el Turnero lo registró
      }),
    ],
    sesiones: [sesion({ authorized_duration_minutes: 30 })],
  });

  assert.equal(r.central.simuladorMinutos, 30, "la evidencia operativa manda sobre el horario");
  assert.equal(r.estado, "verified");
}

// Después del corte de las 22:00, la reserva de las 21:00 ya ocurrió y entra sola.
{
  const entrada = {
    businessDate: FECHA,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 4, cantidad_minutos: 30 })],
    reservas: [
      reserva({ id: "r1", estado: "activa", fecha: FECHA, hora: "21:00", duracion_minutos: 30, simuladores: ["Ferrari"] }),
    ],
  };

  const alas19 = conciliar({
    ...entrada,
    corte: `${FECHA}T19:00`,
    sesiones: [1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
  });
  assert.equal(alas19.estado, "verified", "P1 cuadra 120/120");

  // 20:00 — todavía no llegó P2 y la reserva ya se usó: ahora sí falta sincronizar.
  const alas2130 = conciliar({
    ...entrada,
    corte: `${FECHA}T21:30`,
    sesiones: [1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
  });
  assert.equal(alas2130.central.simuladorMinutos, 150);
  assert.equal(alas2130.estado, "pending", "faltan 30 por sincronizar, no es un error");
  // Y P1, que ya estaba verificado, no se toca.
  assert.equal(estadoDePaqueteTrasCorrida("verified", alas2130.estado), "verified");

  // 22:00 — llega P2 con esos 30.
  const alas22 = conciliar({
    ...entrada,
    corte: `${FECHA}T22:00`,
    sesiones: [
      ...[1, 2, 3, 4].map((i) => sesion({ terminal_key: `sim-0${i}`, authorized_duration_minutes: 30 })),
      sesion({ terminal_key: "sim-01", authorized_duration_minutes: 30 }),
    ],
  });
  assert.equal(alas22.central.simuladorMinutos, 150);
  assert.equal(alas22.simControl.simuladorMinutos, 150);
  assert.equal(alas22.estado, "verified");
}

// Un turno del stand cargado para más tarde tampoco suma todavía.
{
  const a = simuladorMinutosStand(
    stand({ id: "s9", estado: "activo", fecha: FECHA, hora: "20:30", cantidad_simuladores: 2, cantidad_minutos: 15 }),
    `${FECHA}T19:00`
  );
  assert.equal(a.simuladorMinutos, 0);
  assert.equal(a.excluidaPor, "todavia_no_usada");
}

// Pero si ya subió, cuenta aunque el horario agendado sea posterior.
{
  const a = simuladorMinutosStand(
    stand({ id: "s9", estado: "activo", fecha: FECHA, hora: "20:30", cantidad_simuladores: 2, cantidad_minutos: 15, hora_subida: "18:55" }),
    `${FECHA}T19:00`
  );
  assert.equal(a.simuladorMinutos, 30);
}

// Y una operación cuyo horario ya pasó cuenta aunque nadie haya tildado nada: exigir el checkbox
// haría que el central quedara por debajo de SIM Control, y eso sería `mismatch`, no "faltan datos".
{
  const a = simuladorMinutosStand(
    stand({ id: "s10", estado: "activo", fecha: FECHA, hora: "15:00", cantidad_simuladores: 1, cantidad_minutos: 15 }),
    `${FECHA}T19:00`
  );
  assert.equal(a.simuladorMinutos, 15);
  assert.equal(a.excluidaPor, undefined);
}

// Marcada como lista pero agendada para las 23:00 y sin hora_subida: NO es de este cierre.
// `listo` dice que terminó, no cuándo empezó, y lo que atribuye el turno a un período es su inicio.
{
  const a = simuladorMinutosReserva(
    reserva({ id: "r5", estado: "activa", fecha: FECHA, hora: "23:00", duracion_minutos: 15, simuladores: ["Alpine"], listo: true }),
    `${FECHA}T19:00`
  );
  assert.equal(a.excluidaPor, "todavia_no_usada");
}

// Con hora_subida anterior al corte sí cuenta, aunque estuviera agendada para las 23:00.
{
  const a = simuladorMinutosReserva(
    reserva({ id: "r5b", estado: "activa", fecha: FECHA, hora: "23:00", duracion_minutos: 15, simuladores: ["Alpine"], listo: true, hora_subida: "18:30" }),
    `${FECHA}T19:00`
  );
  assert.equal(a.simuladorMinutos, 15, "el inicio real manda sobre el horario agendado");
}

// Una reserva futura Y no-show se excluye por no-show: el motivo más específico gana.
{
  const a = simuladorMinutosReserva(
    reserva({ id: "r6", estado: "activa", no_show: true, fecha: FECHA, hora: "21:00", duracion_minutos: 30, simuladores: ["Alpine"] }),
    `${FECHA}T19:00`
  );
  assert.equal(a.excluidaPor, "no_show");
}

// Sin corte, no se filtra nada (el llamador decide).
{
  const a = simuladorMinutosReserva(
    reserva({ id: "r7", estado: "activa", fecha: FECHA, hora: "23:00", duracion_minutos: 30, simuladores: ["Alpine"] })
  );
  assert.equal(a.simuladorMinutos, 30);
}

// Una fila sin horario tampoco se descarta: no hay forma de saber que sea futura.
{
  const a = simuladorMinutosStand(
    stand({ id: "s11", estado: "activo", cantidad_simuladores: 1, cantidad_minutos: 15 }),
    `${FECHA}T19:00`
  );
  assert.equal(a.simuladorMinutos, 15);
}

// ── CASO N — el corte se calcula en la zona del negocio, no en la del servidor ─
{
  // 2026-09-13 22:30 UTC = 19:30 en Córdoba (UTC-3).
  const corte = corteAhora(new Date("2026-09-13T22:30:00Z"));
  assert.equal(corte, "2026-09-13T19:30");

  // Y el cruce de medianoche UTC no adelanta el día comercial.
  assert.equal(corteAhora(new Date("2026-09-14T01:00:00Z")), "2026-09-13T22:00");
}

// ── CASO O — el corte es el del CIERRE, no el del reloj ──────────────────────
// P1 cierra a las 19:00 (22:00 UTC). Ese corte es suyo para siempre: reintentarlo a las 21:30 tiene
// que dar exactamente lo mismo, y la actividad posterior pertenece al cierre siguiente.

const CIERRE_P1_UTC = "2026-09-13T22:00:00.000Z"; // 19:00 en Córdoba
const CIERRE_P2_UTC = "2026-09-14T01:00:00.000Z"; // 22:00 en Córdoba, mismo día comercial

const sesionEn = (finUtc: string, minutos: number, terminal = "sim-01"): SesionConciliable =>
  sesion({ terminal_key: terminal, authorized_duration_minutes: minutos, finished_at_utc: finUtc });

{
  // Central del día: 120 hasta las 19:00, más un turno de las 21:00 por 30.
  const standDelDia = [
    stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 4, cantidad_minutos: 30 }),
    stand({ id: "s2", estado: "activo", fecha: FECHA, hora: "21:00", cantidad_simuladores: 2, cantidad_minutos: 15 }),
  ];

  // Sesiones de SIM Control: 4×30 antes de las 19:00, y 2×15 a las 21:00.
  const antesDeLas19 = [
    sesionEn("2026-09-13T21:10:00Z", 30, "sim-01"),
    sesionEn("2026-09-13T21:20:00Z", 30, "sim-02"),
    sesionEn("2026-09-13T21:40:00Z", 30, "sim-03"),
    sesionEn("2026-09-13T21:55:00Z", 30, "sim-04"),
  ];
  const despuesDeLas19 = [
    sesionEn("2026-09-14T00:20:00Z", 15, "sim-01"),
    sesionEn("2026-09-14T00:20:00Z", 15, "sim-02"),
  ];

  // P1 con TODO ingerido (incluida la actividad de las 21:00 que trajo P2).
  const p1 = conciliarCierre({
    businessDate: FECHA,
    cierreUtc: CIERRE_P1_UTC,
    stand: standDelDia,
    reservas: [],
    sesiones: [...antesDeLas19, ...despuesDeLas19],
  });

  assert.equal(p1.central.simuladorMinutos, 120, "el turno de las 21:00 es posterior al corte de P1");
  assert.equal(p1.simControl.simuladorMinutos, 120, "las sesiones de las 21:00 tampoco entran en P1");
  assert.equal(p1.simControl.sesionesPosterioresAlCorte, 2);
  assert.equal(p1.estado, "verified", "P2 no puede ensuciar a P1 con actividad que no existía");

  // P2, con su propio corte, ve el acumulado completo del día.
  const p2 = conciliarCierre({
    businessDate: FECHA,
    cierreUtc: CIERRE_P2_UTC,
    stand: standDelDia,
    reservas: [],
    sesiones: [...antesDeLas19, ...despuesDeLas19],
  });

  assert.equal(p2.central.simuladorMinutos, 150);
  assert.equal(p2.simControl.simuladorMinutos, 150);
  assert.equal(p2.estado, "verified");
  assert.equal(p2.simControl.sesionesPosterioresAlCorte, 0);
}

// Un reintento de P1 mucho más tarde da IDÉNTICO: el corte viaja con el cierre.
{
  const entrada = {
    businessDate: FECHA,
    cierreUtc: CIERRE_P1_UTC,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 4, cantidad_minutos: 30 })],
    reservas: [],
    sesiones: [
      sesionEn("2026-09-13T21:10:00Z", 30, "sim-01"),
      sesionEn("2026-09-13T21:20:00Z", 30, "sim-02"),
      sesionEn("2026-09-13T21:40:00Z", 30, "sim-03"),
      sesionEn("2026-09-13T21:55:00Z", 30, "sim-04"),
    ],
  };

  const alCerrar = conciliarCierre(entrada);
  const reintentoTardio = conciliarCierre(entrada);

  assert.deepEqual(reintentoTardio, alCerrar, "la misma entrada da el mismo resultado, siempre");
  assert.equal(alCerrar.estado, "verified");
}

// Un paquete POSTERIOR puede completar a P1 si trae sesiones anteriores a su corte.
{
  const standDelDia = [
    stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 4, cantidad_minutos: 30 }),
  ];

  // Al cerrar P1 solo estaban ingeridas 3 de las 4 terminales: faltan 30.
  const parcial = conciliarCierre({
    businessDate: FECHA,
    cierreUtc: CIERRE_P1_UTC,
    stand: standDelDia,
    reservas: [],
    sesiones: [
      sesionEn("2026-09-13T21:10:00Z", 30, "sim-01"),
      sesionEn("2026-09-13T21:20:00Z", 30, "sim-02"),
      sesionEn("2026-09-13T21:40:00Z", 30, "sim-03"),
    ],
  });
  assert.equal(parcial.estado, "pending");
  assert.equal(parcial.diferenciaSimuladorMinutos, 30);

  // T2 sincroniza 19:10 trayendo una sesión de las 18:40: ANTERIOR al corte de P1, así que cuenta.
  const completado = conciliarCierre({
    businessDate: FECHA,
    cierreUtc: CIERRE_P1_UTC,
    stand: standDelDia,
    reservas: [],
    sesiones: [
      sesionEn("2026-09-13T21:10:00Z", 30, "sim-01"),
      sesionEn("2026-09-13T21:20:00Z", 30, "sim-02"),
      sesionEn("2026-09-13T21:40:00Z", 30, "sim-03"),
      sesionEn("2026-09-13T21:45:00Z", 30, "sim-04"), // 18:45 local
    ],
  });
  assert.equal(completado.estado, "verified", "una sesión anterior al corte sí completa P1");
}

// Pero una sesión posterior al corte NO lo afecta, ni siquiera para bien.
{
  const r = conciliarCierre({
    businessDate: FECHA,
    cierreUtc: CIERRE_P1_UTC,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 4, cantidad_minutos: 30 })],
    reservas: [],
    sesiones: [
      sesionEn("2026-09-13T21:10:00Z", 30, "sim-01"),
      sesionEn("2026-09-13T21:20:00Z", 30, "sim-02"),
      sesionEn("2026-09-13T21:40:00Z", 30, "sim-03"),
      sesionEn("2026-09-14T00:20:00Z", 30, "sim-04"), // 21:20 local: es del próximo cierre
    ],
  });
  assert.equal(r.estado, "pending", "sigue faltando; el turno de las 21:20 no es de este cierre");
  assert.equal(r.simControl.sesionesPosterioresAlCorte, 1);
}

// Sesión sin instante de fin: se ubica por su inicio.
{
  const r = conciliarCierre({
    businessDate: FECHA,
    cierreUtc: CIERRE_P1_UTC,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 15 })],
    reservas: [],
    sesiones: [
      sesion({ authorized_duration_minutes: 15, finished_at_utc: null, started_at_utc: "2026-09-13T21:00:00Z" }),
      sesion({ authorized_duration_minutes: 15, finished_at_utc: null, started_at_utc: "2026-09-14T00:30:00Z" }),
    ],
  });
  assert.equal(r.simControl.simuladorMinutos, 15, "solo la que empezó antes del corte");
  assert.equal(r.estado, "verified");
}

// El corte local sale del instante UTC persistido, en la zona del negocio.
{
  assert.equal(corteLocalDesdeUtc(CIERRE_P1_UTC), "2026-09-13T19:00");
  assert.equal(corteLocalDesdeUtc(CIERRE_P2_UTC), "2026-09-13T22:00", "sigue siendo el mismo día comercial");
}

// ── CASO P — una sesión que CRUZA el corte pertenece a ese cierre ─────────────
// 18:50 arranca un turno de 30 min en T2. A las 19:00 otra terminal cierra P1. El turno termina
// 19:20 y T2 sincroniza 19:30. Ese turno ya estaba en curso cuando se cerró P1: le pertenece, con
// sus 30 minutos completos. Si se decidiera por el final quedaría afuera para siempre y P1 no
// cerraría nunca.
{
  const standCruzado = stand({
    id: "s-cruza", estado: "activo", fecha: FECHA, hora: "18:50",
    cantidad_simuladores: 1, cantidad_minutos: 30,
    hora_subida: "18:50", hora_bajada: "19:20", // termina DESPUÉS del corte
  });

  const sesionCruzada = sesion({
    terminal_key: "sim-02",
    authorized_duration_minutes: 30,
    started_at_utc: "2026-09-13T21:50:00Z",  // 18:50 local
    finished_at_utc: "2026-09-14T00:20:00Z", // 19:20 local: posterior al corte
  });

  // Todavía no llegó el paquete de T2: faltan esos 30.
  const sinT2 = conciliarCierre({
    businessDate: FECHA, cierreUtc: CIERRE_P1_UTC,
    stand: [standCruzado], reservas: [], sesiones: [],
  });
  assert.equal(sinT2.central.simuladorMinutos, 30, "el turno empezó antes del corte: el central lo espera");
  assert.equal(sinT2.estado, "pending");

  // Llega el paquete de T2 a las 19:30 → completa P1.
  const conT2 = conciliarCierre({
    businessDate: FECHA, cierreUtc: CIERRE_P1_UTC,
    stand: [standCruzado], reservas: [], sesiones: [sesionCruzada],
  });
  assert.equal(conT2.simControl.simuladorMinutos, 30, "los 30 cuentan enteros, no prorrateados");
  assert.equal(conT2.simControl.sesionesPosterioresAlCorte, 0, "cruzar el corte no la expulsa");
  assert.equal(conT2.estado, "verified", "Pending → Verified cuando llega el paquete que faltaba");

  // Y P2 sigue incluyéndolos en el acumulado, sin duplicarlos.
  const p2 = conciliarCierre({
    businessDate: FECHA, cierreUtc: CIERRE_P2_UTC,
    stand: [
      standCruzado,
      stand({ id: "s-post", estado: "activo", fecha: FECHA, hora: "20:00", cantidad_simuladores: 1, cantidad_minutos: 30 }),
    ],
    reservas: [],
    sesiones: [
      sesionCruzada,
      sesion({
        terminal_key: "sim-02", authorized_duration_minutes: 30,
        started_at_utc: "2026-09-14T01:00:00Z" /* 22:00 no, 20:00 local */, finished_at_utc: "2026-09-14T01:30:00Z",
      }),
    ],
  });
  assert.equal(p2.central.simuladorMinutos, 60, "los 30 de las 18:50 + los 30 de las 20:00");
  assert.equal(p2.simControl.simuladorMinutos, 60, "sin duplicar los que ya verificó P1");
  assert.equal(p2.estado, "verified");
}

// Una sesión que EMPIEZA después del corte no toca P1, aunque el paquete llegue antes.
{
  const r = conciliarCierre({
    businessDate: FECHA, cierreUtc: CIERRE_P1_UTC,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 30 })],
    reservas: [],
    sesiones: [
      sesion({ authorized_duration_minutes: 30, started_at_utc: "2026-09-13T21:00:00Z", finished_at_utc: "2026-09-13T21:30:00Z" }),
      // 20:00 → 20:30 local: es del próximo cierre.
      sesion({ authorized_duration_minutes: 30, started_at_utc: "2026-09-13T23:00:00Z", finished_at_utc: "2026-09-13T23:30:00Z" }),
    ],
  });
  assert.equal(r.simControl.simuladorMinutos, 30);
  assert.equal(r.simControl.sesionesPosterioresAlCorte, 1);
  assert.equal(r.estado, "verified", "P1 cuadra con lo suyo; lo de las 20:00 es de P2");
}

// ── CASO Q — el central usa el INICIO de uso, nunca la bajada ────────────────

// Subió antes del corte y bajó después: cuenta en este cierre.
{
  const a = simuladorMinutosStand(
    stand({
      id: "s-cruza2", estado: "activo", fecha: FECHA, hora: "18:50",
      cantidad_simuladores: 2, cantidad_minutos: 30,
      hora_subida: "18:50", hora_bajada: "19:20",
    }),
    `${FECHA}T19:00`
  );
  assert.equal(a.simuladorMinutos, 60, "la bajada posterior no lo saca de este cierre");
}

// Subió DESPUÉS del corte aunque estuviera agendado antes: es del cierre siguiente.
{
  const corte = `${FECHA}T19:00`;
  const fila = stand({
    id: "s-tarde", estado: "activo", fecha: FECHA, hora: "18:00",
    cantidad_simuladores: 1, cantidad_minutos: 15,
    hora_subida: "19:30", // se subió tarde
  });

  assert.equal(simuladorMinutosStand(fila, corte).excluidaPor, "todavia_no_usada");
  assert.equal(simuladorMinutosStand(fila, `${FECHA}T22:00`).simuladorMinutos, 15, "en P2 sí cuenta");
}

// Reserva sin hora_subida: se atribuye por el horario programado.
{
  const corte = `${FECHA}T19:00`;
  const programada18 = reserva({ id: "r-18", estado: "activa", fecha: FECHA, hora: "18:00", duracion_minutos: 30, simuladores: ["Ferrari"] });
  const programada21 = reserva({ id: "r-21", estado: "activa", fecha: FECHA, hora: "21:00", duracion_minutos: 30, simuladores: ["Ferrari"] });

  assert.equal(simuladorMinutosReserva(programada18, corte).simuladorMinutos, 30);
  assert.equal(simuladorMinutosReserva(programada21, corte).excluidaPor, "todavia_no_usada");
}

// Marcada `listo` pero sin hora_subida: `listo` no decide período, manda el horario programado.
{
  const a = simuladorMinutosReserva(
    reserva({ id: "r-listo", estado: "activa", fecha: FECHA, hora: "21:00", duracion_minutos: 15, simuladores: ["Alpine"], listo: true }),
    `${FECHA}T19:00`
  );
  assert.equal(a.excluidaPor, "todavia_no_usada", "listo dice que terminó, no cuándo empezó");
}

// no_show y cancelada siguen excluidas aunque tengan hora_subida anterior al corte.
{
  const corte = `${FECHA}T19:00`;
  assert.equal(
    simuladorMinutosReserva(
      reserva({ id: "r-ns", estado: "activa", no_show: true, fecha: FECHA, hora: "18:00", duracion_minutos: 30, simuladores: ["Ferrari"], hora_subida: "18:00" }),
      corte
    ).excluidaPor,
    "no_show"
  );
  assert.equal(
    simuladorMinutosStand(
      stand({ id: "s-canc", estado: "cancelado", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 15, hora_subida: "18:00" }),
      corte
    ).excluidaPor,
    "cancelada"
  );
}

// ── CASO R — nunca se prorratea ──────────────────────────────────────────────
// Un turno de 30 que empieza un minuto antes del corte aporta 30, no 1.
{
  const r = conciliarCierre({
    businessDate: FECHA, cierreUtc: CIERRE_P1_UTC,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:59", cantidad_simuladores: 1, cantidad_minutos: 30 })],
    reservas: [],
    sesiones: [
      sesion({
        authorized_duration_minutes: 30,
        started_at_utc: "2026-09-13T21:59:00Z", // 18:59 local
        finished_at_utc: "2026-09-14T00:29:00Z", // 19:29 local
      }),
    ],
  });
  assert.equal(r.central.simuladorMinutos, 30);
  assert.equal(r.simControl.simuladorMinutos, 30);
  assert.equal(r.estado, "verified");
}

// Sesión sin fin persistido: el inicio alcanza para ubicarla.
{
  const r = conciliarCierre({
    businessDate: FECHA, cierreUtc: CIERRE_P1_UTC,
    stand: [stand({ id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 15 })],
    reservas: [],
    sesiones: [
      sesion({ authorized_duration_minutes: 15, started_at_utc: "2026-09-13T21:00:00Z", finished_at_utc: null }),
    ],
  });
  assert.equal(r.simControl.simuladorMinutos, 15, "sin finished_at no se la manda a otro período");
  assert.equal(r.estado, "verified");
}

console.log("simControlReconciliation.test.ts OK");
