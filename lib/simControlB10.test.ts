import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validarPayload } from "@/lib/simControlProtocol";
import {
  conciliar, simuladorMinutosReserva, simuladorMinutosStand, totalesSimControl,
  type FilaReservaConciliable, type FilaStandConciliable, type SesionConciliable,
} from "@/lib/simControlReconciliation";

// B10 (web) — SIM Control con la modalidad 10/20/30.
// Ejecutar: npx tsx lib/simControlB10.test.ts
//
// Módulo puro: sin base ni red. Comprueba que la conciliación cuente MINUTOS COMERCIALES (nunca el
// buffer de agenda), que el respaldo `turnos × 15` quede solo para filas legacy, que el histórico
// concilie igual y que el protocolo acepte sesiones de 10 y 20 sin cambios de esquema.

const DIA = "2026-11-16";
const st = (id: number, extra: Partial<FilaStandConciliable>): FilaStandConciliable =>
  ({ id, estado: "activo", fecha: DIA, hora: "12:00", ...extra });
const rs = (id: number, extra: Partial<FilaReservaConciliable>): FilaReservaConciliable =>
  ({ id, estado: "activa", no_show: false, fecha: DIA, hora: "12:00", ...extra });
const sesion = (terminal: string, minutos: number, extra: Partial<SesionConciliable> = {}): SesionConciliable => ({
  terminal_key: terminal, local_session_id: `${terminal}-${minutos}-${Math.random()}`, counts_for_reconciliation: true,
  authorized_duration_minutes: minutos, session_type: "Commercial", status: "Finished",
  started_at_utc: `${DIA}T15:00:00Z`, finished_at_utc: `${DIA}T15:30:00Z`, ...extra,
});
const FORMULAS_DE_LA_BASE = ["simuladores_x_minutos", "turnos_x_15", "excluida"]; // CHECK de sim_control_reconciliation_items

// ── 1. Stand: legacy igual; v2 por minutos vendidos ──────────────────────────
{
  // Legacy, exactamente como antes.
  assert.equal(simuladorMinutosStand(st(1, { cantidad_simuladores: 2, cantidad_minutos: 15 })).simuladorMinutos, 30);
  const sinCabinas = simuladorMinutosStand(st(2, { cantidad_turnos: 4, cantidad_minutos: 30, cantidad_personas: 2 }));
  assert.deepEqual([sinCabinas.simuladorMinutos, sinCabinas.formula], [60, "turnos_x_15"], "legacy sin cabinas: turnos × 15, como siempre");
  assert.equal(simuladorMinutosStand(st(3, { cantidad_turnos: 2, cantidad_minutos: 30, modalidad: "legacy" })).formula, "turnos_x_15");
  // v2 con cabinas cargadas: simuladores × minutos (ya era así).
  assert.equal(simuladorMinutosStand(st(4, { cantidad_simuladores: 2, cantidad_minutos: 20, cantidad_turnos: 4, modalidad: "v2_10" })).simuladorMinutos, 40);
  // v2 SIN cabinas: personas × minutos, nunca turnos × 15 (4 bloques de 10 → 60 sería de más).
  const v2 = simuladorMinutosStand(st(5, { cantidad_personas: 2, cantidad_minutos: 20, cantidad_turnos: 4, modalidad: "v2_10" }));
  assert.deepEqual([v2.simuladorMinutos, v2.formula], [40, "simuladores_x_minutos"]);
  assert.equal(simuladorMinutosStand(st(6, { cantidad_personas: 4, cantidad_minutos: 30, cantidad_turnos: 12, modalidad: "v2_10" })).simuladorMinutos, 120, "4 × 30 = 120, no 180");
  assert.equal(simuladorMinutosStand(st(7, { cantidad_personas: 1, cantidad_minutos: 10, cantidad_turnos: 1, modalidad: "v2_10" })).simuladorMinutos, 10);
  const roto = simuladorMinutosStand(st(8, { cantidad_turnos: 3, modalidad: "v2_10" }));
  assert.deepEqual([roto.simuladorMinutos, roto.excluidaPor], [0, "sin_datos"], "una fila v2 sin minutos no se adivina con × 15");
}

// ── 2. Reservas: legacy igual; v2 por duración real ──────────────────────────
{
  assert.equal(simuladorMinutosReserva(rs(1, { duracion_minutos: 30, simuladores: ["Ferrari"] })).simuladorMinutos, 30);
  const leg = simuladorMinutosReserva(rs(2, { duracion_minutos: 30, cantidad_turnos: 2 }));
  assert.deepEqual([leg.simuladorMinutos, leg.formula], [30, "turnos_x_15"], "legacy sin simuladores: turnos × 15, como siempre");
  for (const [d, sims] of [[10, 1], [20, 2], [30, 4]] as const) {
    const conLista = simuladorMinutosReserva(rs(10 + d, { duracion_minutos: d, simuladores: ["Ferrari", "McLaren", "Red Bull", "Alpine"].slice(0, sims), modalidad: "v2_10" }));
    assert.equal(conLista.simuladorMinutos, d * sims, `v2 ${d} × ${sims}`);
    // Sin la lista de simuladores: cantidad_turnos guarda cuántos (B3), con la duración real.
    const sinLista = simuladorMinutosReserva(rs(20 + d, { duracion_minutos: d, cantidad_turnos: sims, modalidad: "v2_10" }));
    assert.deepEqual([sinLista.simuladorMinutos, sinLista.formula], [d * sims, "simuladores_x_minutos"], `v2 ${d} × ${sims} sin lista, no ${sims * 15}`);
  }
  for (const a of [simuladorMinutosReserva(rs(99, { duracion_minutos: 20, cantidad_turnos: 1, modalidad: "v2_10" })), simuladorMinutosStand(st(98, { cantidad_turnos: 2, modalidad: "v2_10" }))]) {
    assert.ok(FORMULAS_DE_LA_BASE.includes(a.formula), "toda etiqueta respeta el CHECK de la base");
  }
}

// ── 3. Conciliación del ejemplo: 10 + 20 + 30 + 15 legacy = 75 de los dos lados ─
{
  const stand = [
    st(1, { cantidad_personas: 1, cantidad_minutos: 10, cantidad_turnos: 1, modalidad: "v2_10" }),
    st(2, { cantidad_personas: 1, cantidad_minutos: 20, cantidad_turnos: 2, modalidad: "v2_10" }),
  ];
  const reservas = [
    rs(3, { duracion_minutos: 30, simuladores: ["Alpine"], cantidad_turnos: 1, modalidad: "v2_10" }),
    rs(4, { duracion_minutos: 15, simuladores: ["Ferrari"], cantidad_turnos: 1, modalidad: null }),
  ];
  // Las sesiones vienen de terminales cualquiera: las cabinas son equivalentes.
  const sesiones = [sesion("sim-02", 10), sesion("sim-02", 20), sesion("sim-04", 30), sesion("sim-01", 15)];
  const r = conciliar({ businessDate: DIA, stand, reservas, sesiones });
  assert.deepEqual([r.central.simuladorMinutos, r.simControl.simuladorMinutos, r.estado], [75, 75, "verified"], "75 = 75, sin buffers");
  // Si alguien sumara el buffer de agenda (+10 por operación v2) daría 105 y quedaría pending para siempre.
  const conBuffer = conciliar({ businessDate: DIA, stand, reservas, sesiones: [...sesiones, sesion("sim-03", 30)] });
  assert.equal(conBuffer.estado, "mismatch", "SIM Control con minutos de más (p. ej. el buffer) no cuadra");
  // Otra distribución de cabinas, mismo total: cuadra igual.
  const otrasCabinas = conciliar({ businessDate: DIA, stand, reservas, sesiones: [sesion("sim-01", 10), sesion("sim-01", 20), sesion("sim-01", 30), sesion("sim-01", 15)] });
  assert.equal(otrasCabinas.estado, "verified", "no se concilia por escudería ni por terminal");
  assert.equal(totalesSimControl([sesion("sim-01", 20, { counts_for_reconciliation: false, session_type: "Maintenance" })]).simuladorMinutos, 0, "mantenimiento no suma");
}

// ── 4. Protocolo: sesiones de 10 y 20 entran sin cambiar el esquema ───────────
{
  const golden = JSON.parse(readFileSync(join(process.cwd(), "tests", "contracts", "day-sync-v1", "valid-package.json"), "utf8"));
  type S = { sessionType: string; countsForReconciliation: boolean; extensionMinutesTotal: number };
  assert.ok(golden.sessions.some((s: S) => s.sessionType === "Commercial" && s.countsForReconciliation), "el golden trae sesiones comerciales");
  for (const minutos of [10, 15, 20, 30]) {
    const p = structuredClone(golden);
    // Mismo paquete (intervenciones y performance intactas), con turnos comerciales de `minutos`.
    p.sessions = p.sessions.map((s: S) => s.sessionType !== "Commercial" ? s : {
      ...s, baseDurationMinutes: minutos, authorizedDurationMinutes: minutos + s.extensionMinutesTotal,
      actualCommercialSeconds: (minutos + s.extensionMinutesTotal) * 60,
    });
    const v = validarPayload(p);
    assert.ok(v.ok, `una sesión de ${minutos} min es válida: ${v.ok ? "" : v.motivo}`);
  }
}

// ── 5. Fuentes: el cargador trae la modalidad; nada de × 15 suelto para v2 ────
{
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const server = leer("lib/simControlServer.ts");
  assert.ok(/cantidad_personas, modalidad, hora_subida/.test(server) && /cantidad_turnos, modalidad"\)/.test(server), "el cargador lee la modalidad de Turnero y Reservas");
  const rec = leer("lib/simControlReconciliation.ts");
  assert.equal((rec.match(/turnos \* MINUTOS_POR_BLOQUE/g) ?? []).length, 2, "el respaldo × 15 existe solo en las dos ramas legacy");
}

console.log("OK — B10 web: conciliación en minutos comerciales (v2 sin × 15 ni buffer), histórico legacy igual, 10+20+30+15 = 75 de los dos lados, cabinas equivalentes, protocolo acepta 10/20.");
