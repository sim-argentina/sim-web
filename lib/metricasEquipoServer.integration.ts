import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";

// Integración DB real con fixtures ZZTEST en un mes AISLADO (2099-03) que se
// ELIMINA por completo al final. NO toca datos reales ni Agosto 2026.
//   npx tsx --env-file=.env.local lib/metricasEquipoServer.integration.ts
const NOMBRE = "ZZTEST_EQUIPO";
const ANIO = 2099, MES = 3;
const D10 = "2099-03-10", D11 = "2099-03-11", D12 = "2099-03-12", D13 = "2099-03-13";
const CORTE_FULL = "2099-03-31T23:59"; // todo marzo es efectivo
const CORTE_MEDIO = "2099-03-10T13:00"; // parte de la actividad queda futura

async function ids() {
  const { data } = await supabaseAdmin.from("empleados").select("id, nombre_formal, es_fallback").in("nombre_formal", ["Ramiro", "Francisco", "Federico"]);
  const by = (n: string) => (data ?? []).find((e) => e.nombre_formal === n)!.id as string;
  return { ramiro: by("Ramiro"), fran: by("Francisco"), fede: by("Federico") };
}

async function limpiar() {
  await supabaseAdmin.from("turnos_stand").delete().eq("nombre", NOMBRE);
  const { data: rs } = await supabaseAdmin.from("reservas").select("id").eq("nombre", NOMBRE);
  const rids = (rs ?? []).map((r) => r.id as number);
  if (rids.length) {
    await supabaseAdmin.from("reservas_reembolsos").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  const { data: mes } = await supabaseAdmin.from("cronograma_meses").select("id").eq("anio", ANIO).eq("mes", MES).maybeSingle();
  if (mes) {
    const { data: dias } = await supabaseAdmin.from("cronograma_dias").select("id").eq("mes_id", mes.id);
    const dids = (dias ?? []).map((d) => d.id as string);
    if (dids.length) await supabaseAdmin.from("cronograma_jornadas").delete().in("dia_id", dids);
    await supabaseAdmin.from("cronograma_dias").delete().eq("mes_id", mes.id);
    await supabaseAdmin.from("cronograma_meses").delete().eq("id", mes.id);
  }
  await supabaseAdmin.from("empleados").delete().eq("nombre_formal", NOMBRE + "_ARCH");
}

async function stand(fecha: string, hora_subida: string, personas: number, minutos: number, turnos: number, total: number, estado = "activo") {
  await supabaseAdmin.from("turnos_stand").insert({
    nombre: NOMBRE, fecha, hora: hora_subida, hora_subida, estado, turno_listo: true,
    cantidad_personas: personas, cantidad_minutos: minutos, cantidad_turnos: turnos, total,
    metodo_pago: "efectivo", simuladores: ["ZZ"],
  });
}
async function reserva(fecha: string, hora: string, sims: number, turnos: number, total: number, estado = "activa") {
  const { data } = await supabaseAdmin.from("reservas").insert({
    nombre: NOMBRE, telefono: "0", fecha, hora, simuladores: Array.from({ length: sims }, (_, i) => `S${i}`),
    cantidad_turnos: turnos, duracion_minutos: 15, total, estado, acepto_condiciones: true, origen: "web", no_show: false,
  }).select("id").single();
  return data!.id as number;
}

async function main() {
  await limpiar();
  const { ramiro, fran, fede } = await ids();
  try {
    // ── Cronograma confirmado 2099-03 (insertado directo, service_role) ─────────
    const { data: mes } = await supabaseAdmin.from("cronograma_meses").insert({ anio: ANIO, mes: MES, estado: "confirmado", apertura_default: "10:00:00", cierre_default: "22:00:00", confirmado_at: new Date().toISOString() }).select("id").single();
    const mesId = mes!.id as string;
    const mkDia = async (fecha: string, cerrado = false) => {
      const { data } = await supabaseAdmin.from("cronograma_dias").insert({ mes_id: mesId, fecha, cerrado, apertura: "10:00:00", cierre: "22:00:00" }).select("id").single();
      return data!.id as string;
    };
    const dia10 = await mkDia(D10);
    await mkDia(D11, true); // cerrado
    await mkDia(D12); // abierto, sin jornadas → Ramiro fallback
    const dia13 = await mkDia(D13); // abierto, solo un integrante ARCHIVADO
    // Relevo el día 10: Francisco 10-18, Federico 18-22.
    await supabaseAdmin.from("cronograma_jornadas").insert([
      { dia_id: dia10, empleado_id: fran, hora_inicio: "10:00:00", hora_fin: "18:00:00", activo: true },
      { dia_id: dia10, empleado_id: fede, hora_inicio: "18:00:00", hora_fin: "22:00:00", activo: true },
    ]);
    // Integrante ARCHIVADO con jornada histórica el día 13 (cubre 10-22).
    const { data: arch } = await supabaseAdmin.from("empleados").insert({ nombre_formal: NOMBRE + "_ARCH", activo: false, es_fallback: false }).select("id").single();
    const archId = arch!.id as string;
    await supabaseAdmin.from("cronograma_jornadas").insert({ dia_id: dia13, empleado_id: archId, hora_inicio: "10:00:00", hora_fin: "22:00:00", activo: true });

    // ── Fixtures de actividad ───────────────────────────────────────────────────
    await stand(D10, "11:00", 2, 30, 4, 20000);        // S1 → Francisco
    await stand(D10, "18:30", 1, 15, 1, 5000);         // S2 → Federico
    await stand(D11, "12:00", 1, 15, 1, 3000);         // S3 → día cerrado
    await stand(D12, "15:00", 1, 15, 1, 4000);         // S4 → Ramiro (fallback)
    await stand(D10, "09:00", 1, 15, 1, 1000);         // S5 → fuera de horario
    await stand(D10, "12:00", 1, 15, 1, 9999, "cancelado"); // S6 → excluido (cancelado)
    await stand(D13, "12:00", 1, 15, 1, 7000);         // S7 → archivado

    await reserva(D10, "12:00", 2, 2, 30000);          // R1 → Francisco
    const r3 = await reserva(D10, "14:00", 1, 1, 25000); // R3 → reembolsada (excluir)
    await supabaseAdmin.from("reservas_reembolsos").insert({ reserva_id: r3, monto_reembolsado: 25000, fecha_reembolso: "2099-04-05" });
    await reserva(D10, "16:00", 1, 1, 8000, "cancelada"); // R4 → excluida (cancelada)

    // ── RUN A: corte fin de mes → todo efectivo ─────────────────────────────────
    const A = await consultarMetricasEquipo({ desde: `${ANIO}-03-01`, hasta: `${ANIO}-03-31`, corte: CORTE_FULL });
    const de = (id: string) => A.integrantes.find((i) => i.empleado_id === id);

    const F = de(fran)!;
    assert.equal(F.total.turnos, 6, "A: Francisco 6 turnos (S1 4 + R1 2)");
    assert.equal(F.total.personas, 4, "A: Francisco 4 personas");
    assert.equal(F.total.minutos, 90, "A: Francisco 90 min");
    assert.equal(F.total.bruto, 50000, "A: Francisco 50000 bruto");
    assert.equal(F.horas_minutos, 480, "A: Francisco 480 min de cronograma (10-18)");

    const Fe = de(fede)!;
    assert.equal(Fe.total.bruto, 5000, "A: Federico 5000 (S2 18:30)");
    assert.equal(Fe.total.turnos, 1, "A: Federico 1 turno");
    assert.equal(Fe.horas_minutos, 240, "A: Federico 240 min (18-22)");

    const R = de(ramiro)!;
    assert.equal(R.total.bruto, 4000, "A: Ramiro 4000 (S4 fallback día 12)");
    assert.equal(R.horas_minutos, 720, "A: Ramiro 720 min (día 12 abierto sin jornadas)");

    const Arch = de(archId)!;
    assert.equal(Arch.total.bruto, 7000, "A: archivado 7000 (S7 día 13)");
    assert.equal(Arch.archivado, true, "A: integrante marcado archivado");
    assert.equal(Arch.horas_minutos, 720, "A: archivado 720 min (día 13)");

    // Sin atribuir
    const cerr = A.sinAtribuir.find((s) => s.motivo === "dia_cerrado");
    assert.ok(cerr && cerr.metricas.bruto === 3000, "A: día_cerrado 3000 (S3)");
    const fuera = A.sinAtribuir.find((s) => s.motivo === "fuera_horario");
    assert.ok(fuera && fuera.metricas.bruto === 1000, "A: fuera_horario 1000 (S5)");

    // Exclusiones
    assert.ok(A.exclusiones.find((e) => e.tipo === "reserva_reembolsada" && e.cantidad === 1), "A: 1 reserva reembolsada excluida");
    assert.ok(A.exclusiones.find((e) => e.tipo === "reserva_cancelada" && e.cantidad === 1), "A: 1 reserva cancelada excluida");

    // Totales + reconciliación
    assert.equal(A.totalesOrigen.bruto, 70000, "A: origen 70000 (S1..S5,S7,R1) sin canceladas/reembolsadas");
    assert.equal(A.totalesAtribuidos.bruto, 66000, "A: atribuido 66000");
    assert.ok(A.reconciliacion.ok, "A: reconciliación ok");
    assert.equal(A.actividadFuturaPendiente.cantidad, 0, "A: nada futuro con corte fin de mes");

    // ── RUN B: corte 10/13:00 → parte queda futura ──────────────────────────────
    const B = await consultarMetricasEquipo({ desde: `${ANIO}-03-01`, hasta: `${ANIO}-03-31`, corte: CORTE_MEDIO });
    // S2(18:30), S4(día12), S7(día13), R1... espera: R1 es 12:00 del día 10 < corte → efectiva.
    // Futuras: S2, S4, S7 (fechas/horas > corte).
    assert.ok(B.actividadFuturaPendiente.cantidad >= 3, "B: al menos S2, S4, S7 futuras");
    const Fb = B.integrantes.find((i) => i.empleado_id === fran)!;
    assert.equal(Fb.total.bruto, 50000, "B: Francisco sigue 50000 (S1 11:00 + R1 12:00, ambas < corte)");
    const Feb = B.integrantes.find((i) => i.empleado_id === fede)!;
    assert.equal(Feb.total.bruto, 0, "B: Federico 0 (S2 18:30 es futura)");
    assert.ok(B.reconciliacion.ok, "B: reconciliación ok");

    // ── Filtro por fuente ───────────────────────────────────────────────────────
    const soloStand = await consultarMetricasEquipo({ desde: `${ANIO}-03-01`, hasta: `${ANIO}-03-31`, corte: CORTE_FULL, fuentes: "stand" });
    assert.equal(soloStand.registros.reservas, 0, "fuente=stand no cuenta reservas");
    assert.ok(soloStand.registros.stand > 0, "fuente=stand cuenta stand");
    const soloRes = await consultarMetricasEquipo({ desde: `${ANIO}-03-01`, hasta: `${ANIO}-03-31`, corte: CORTE_FULL, fuentes: "reservas" });
    assert.equal(soloRes.registros.stand, 0, "fuente=reservas no cuenta stand");
    assert.equal(soloRes.integrantes.find((i) => i.empleado_id === fran)!.total.bruto, 30000, "fuente=reservas Francisco solo R1 30000");

    // ── Filtro por integrante ───────────────────────────────────────────────────
    const soloFran = await consultarMetricasEquipo({ desde: `${ANIO}-03-01`, hasta: `${ANIO}-03-31`, corte: CORTE_FULL, empleadoId: fran });
    assert.equal(soloFran.integrantes.length, 1, "empleadoId filtra a 1 integrante");
    assert.equal(soloFran.integrantes[0].empleado_id, fran, "empleadoId correcto");

    console.log("✔ metricasEquipoServer.integration OK");
  } finally {
    await limpiar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
