import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  registrarReembolso,
  getReembolsoDeReserva,
  getEstadoReembolso,
  debeExcluirseDeMetricas,
  getReembolsosReservasMes,
} from "@/lib/reservasReembolsos";
import { resumirMes } from "@/lib/finanzas";

// Integración DB real con fixtures ZZTEST que se ELIMINAN al final.
// NO toca reservas comerciales ni Agosto real (usa reservas propias identificables).
//   npx tsx --env-file=.env.local lib/reservasReembolsos.integration.ts
const NOMBRE = "ZZTEST_REEMBOLSO";
const SIM = "ZZ_SIM_REEMB";
const MES_CERRADO = "2020-01"; // pre-negocio: sin datos reales

function hoyAR(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}
function addDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function limpiar() {
  const { data: rs } = await supabaseAdmin.from("reservas").select("id").eq("nombre", NOMBRE);
  const ids = (rs ?? []).map((r) => r.id as number);
  if (ids.length) {
    await supabaseAdmin.from("reservas_reembolsos").delete().in("reserva_id", ids);
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", ids);
    await supabaseAdmin.from("reservas").delete().in("id", ids);
  }
  await supabaseAdmin.from("fin_cierres_mensuales").delete().eq("mes", MES_CERRADO);
}

async function nuevaReserva(opts: {
  fecha: string;
  total: number;
  estado?: string;
  created_at?: string;
}): Promise<number> {
  const row: Record<string, unknown> = {
    nombre: NOMBRE, telefono: "0", fecha: opts.fecha, hora: "10:00", simuladores: [SIM],
    cantidad_turnos: 1, total: opts.total, estado: opts.estado ?? "activa",
    acepto_condiciones: true, duracion_minutos: 15, origen: "web",
  };
  if (opts.created_at) row.created_at = opts.created_at;
  const { data, error } = await supabaseAdmin.from("reservas").insert(row).select("id").single();
  if (error || !data) throw new Error("crear reserva: " + JSON.stringify(error));
  const id = data.id as number;
  // slot activo (como una reserva real ocupando el turno)
  await supabaseAdmin.from("reserva_slots").insert({ reserva_id: id, fecha: opts.fecha, hora: "10:00", simulador: SIM, estado: "activa" });
  return id;
}

async function slotsDe(reservaId: number): Promise<number> {
  const { data } = await supabaseAdmin.from("reserva_slots").select("id").eq("reserva_id", reservaId);
  return (data ?? []).length;
}

async function main() {
  await limpiar();
  const hoy = hoyAR();
  try {
    // ── 1) Registro OK: aprobada → reembolso; monto SIEMPRE del servidor ─────────
    const r1 = await nuevaReserva({ fecha: addDias(hoy, 10), total: 20000 }); // futura
    assert.equal(await slotsDe(r1), 1, "1: slot ocupado antes del reembolso");
    const ok1 = await registrarReembolso(r1, hoy, "cliente canceló");
    assert.equal(ok1.ok, true, "1: reembolso OK");
    if (ok1.ok) {
      assert.equal(Number(ok1.data.monto_reembolsado), 20000, "1: monto = total del servidor");
      assert.equal(ok1.data.origen_registro, "manual_externo", "1: origen manual_externo");
      assert.equal(ok1.data.actor, "Administrador", "1: actor Administrador");
    }
    // estado terminal + cupo liberado (futura cancelada de inmediato)
    const { data: r1row } = await supabaseAdmin.from("reservas").select("estado").eq("id", r1).single();
    assert.equal(r1row?.estado, "reembolsada", "1: estado reembolsada");
    assert.equal(await slotsDe(r1), 0, "1: cupo liberado (slots borrados)");

    // Contrato 3B: excluida de métricas SIEMPRE
    assert.equal(await debeExcluirseDeMetricas(r1), true, "1: excluida de métricas");
    const est = await getEstadoReembolso(r1);
    assert.deepEqual({ reembolsada: est.reembolsada, monto: est.monto, excluir: est.excluirDeMetricas },
      { reembolsada: true, monto: 20000, excluir: true }, "1: getEstadoReembolso");

    // ── 2) Segundo reembolso NO duplica (409 ya_reembolsada) ─────────────────────
    const dup = await registrarReembolso(r1, hoy, null);
    assert.equal(dup.ok, false, "2: segundo reembolso rechazado");
    if (!dup.ok) assert.equal(dup.status, 409, "2: 409 ya reembolsada");

    // ── 3) No pagada (estado pendiente_pago) → 409 ───────────────────────────────
    const r3 = await nuevaReserva({ fecha: addDias(hoy, 10), total: 15000, estado: "pendiente_pago" });
    const noPaga = await registrarReembolso(r3, hoy, null);
    assert.equal(noPaga.ok, false, "3: no pagada rechazada");
    if (!noPaga.ok) assert.equal(noPaga.status, 409, "3: 409 reserva_no_pagada");

    // ── 4) Fecha futura → 400 ────────────────────────────────────────────────────
    const r4 = await nuevaReserva({ fecha: addDias(hoy, 10), total: 10000 });
    const fut = await registrarReembolso(r4, addDias(hoy, 1), null);
    assert.equal(fut.ok, false, "4: fecha futura rechazada");
    if (!fut.ok) assert.equal(fut.status, 400, "4: 400 fecha futura");

    // ── 5) Fecha anterior al cobro → 400 ─────────────────────────────────────────
    // cobro = created_at (hoy). Un reembolso ayer es anterior al cobro.
    const ant = await registrarReembolso(r4, addDias(hoy, -1), null);
    assert.equal(ant.ok, false, "5: fecha anterior al cobro rechazada");
    if (!ant.ok) assert.equal(ant.status, 400, "5: 400 fecha anterior al cobro");

    // ── 6) Mes cerrado rechaza; reabrir permite ──────────────────────────────────
    const rC = await nuevaReserva({ fecha: "2020-01-10", total: 5000, created_at: "2020-01-10T13:00:00Z" });
    await supabaseAdmin.from("fin_cierres_mensuales").insert({ mes: MES_CERRADO, estado: "cerrado" });
    const cerrado = await registrarReembolso(rC, "2020-01-15", null);
    assert.equal(cerrado.ok, false, "6: mes cerrado rechaza");
    if (!cerrado.ok) assert.equal(cerrado.status, 409, "6: 409 mes cerrado");
    // reabrir (borrar cierre) → ahora sí
    await supabaseAdmin.from("fin_cierres_mensuales").delete().eq("mes", MES_CERRADO);
    const reabierto = await registrarReembolso(rC, "2020-01-15", null);
    assert.equal(reabierto.ok, true, "6: reabierto permite reembolso");
    assert.equal(await getReembolsosReservasMes(MES_CERRADO), 5000, "6: reembolso imputado a 2020-01");

    // ── 7) Finanzas: cobro en un mes, reembolso en el mes siguiente ──────────────
    // Mes del reembolso debe estar ABIERTO (no tocamos meses cerrados reales).
    const mesReemb = hoy.slice(0, 7);
    const { data: cierreActual } = await supabaseAdmin
      .from("fin_cierres_mensuales").select("estado").eq("mes", mesReemb).maybeSingle();
    if (!cierreActual || cierreActual.estado === "abierto") {
      const mesCobro = "2020-03"; // mes viejo sin datos reales, para no alterar julio/agosto reales
      const rF = await nuevaReserva({ fecha: "2020-03-10", total: 20000, created_at: "2020-03-10T13:00:00Z" });
      const cobroAntes = await reservasIngresoMes(mesCobro);
      const aAntes = await getReembolsosReservasMes(mesReemb);
      const okF = await registrarReembolso(rF, hoy, null);
      assert.equal(okF.ok, true, "7: reembolso en mes actual OK");
      // El cobro NO se reescribe: el ingreso del mes de cobro se mantiene.
      assert.equal(await reservasIngresoMes(mesCobro), cobroAntes, "7: mes de cobro preservado");
      // El reembolso impacta como negativo en el mes de fecha_reembolso.
      assert.equal(await getReembolsosReservasMes(mesReemb) - aAntes, 20000, "7: reembolso suma al mes actual");
    } else {
      console.log("   (7) mes actual cerrado: subtest de imputación temporal omitido");
    }

    // ── 8) resumirMes: aritmética de reembolsos (PURO) ───────────────────────────
    const cuentas = [
      { id: "ef", nombre: "Efectivo", tipo: "efectivo" },
      { id: "mp", nombre: "Mercado Pago", tipo: "mercado_pago" },
    ] as unknown as Parameters<typeof resumirMes>[0]["cuentas"];
    const base = {
      mes: "2020-05", movimientos: [], ingresosAuto: [], ingresosAutoTotal: 20000,
      turnosDelMes: 0, saldoInicialGeneral: 0, saldoInicialEfectivo: 0, saldoInicialMp: 0,
      sueldoAsignado: 0, cuentas, categorias: [],
    };
    const sinReemb = resumirMes({ ...base });
    const conReemb = resumirMes({ ...base, reembolsosReservas: 20000 });
    assert.equal(sinReemb.ingresos, 20000, "8: sin reembolso ingresos=20000");
    assert.equal(conReemb.ingresosDespuesReembolsos, 0, "8: bruto − reembolso = 0");
    assert.equal(conReemb.ingresos, 0, "8: neto = 0");
    assert.equal(conReemb.saldoFinalTeoricoGeneral, 0, "8: saldo baja por el reembolso");
    assert.equal(sinReemb.saldoFinalTeoricoGeneral - conReemb.saldoFinalTeoricoGeneral, 20000, "8: delta = reembolso");

    // Detalle admin recuperable
    const det = await getReembolsoDeReserva(r1);
    assert.ok(det && det.motivo === "cliente canceló", "9: detalle admin recuperable");

    console.log("✔ reservasReembolsos.integration OK");
  } finally {
    await limpiar();
  }
}

// helper: ingreso de reservas_online de un mes vía la RPC canónica
async function reservasIngresoMes(mes: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
  if (error) throw error;
  const row = (data ?? []).find((r: { fuente: string }) => r.fuente === "reservas_online");
  return row ? Number(row.total) : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
