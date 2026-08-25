import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  crearCampania, generarCodigos, reservarConCodigo, validarCodigo, getCampania, datosInforme,
  marcarPagada, cancelarReservaEmpresa, reprogramarReservaEmpresa, setEstadoCodigo,
} from "@/lib/empresasServer";
import { sumarDias } from "@/lib/empresas";

// Integración END-TO-END Fase 2 contra la DB real, con datos TEMPORALES que se ELIMINAN
// (§S: no campañas/reservas/ingresos reales). Fechas 2030 y simuladores "ZZ_*" para no
// colisionar con datos reales. Ejecutar:
//   node --env-file=.env.local --import tsx lib/empresasCanje.integration.ts

const MARCA = `__TEST_EMP_${Date.now()}`;
const hoy = () => new Date().toISOString().slice(0, 10);
const T_FECHA = "2030-06-05";
const SIM_A = "ZZ_SIM_A";
const SIM_B = "ZZ_SIM_B";
const BENEF = { nombre: "ZZTEST", apellido: "Benef", telefono: "000", email: "zz@test.emp" };

async function crearActiva(overrides: Record<string, unknown> = {}) {
  const res = await crearCampania({
    empresa: MARCA, nombre_campania: "Acción F2", modalidad: "unica",
    cantidad_contratada: 5, duracion_minutos: 30, usos_por_codigo: 1,
    precio_neto: 100000, iva_porcentaje: 21, fecha_inicio: hoy(),
    ...overrides,
  }, "admin");
  assert.ok(res.ok, "crearCampania: " + (res.ok ? "" : res.error));
  const c = res.data as { id: string; fecha_vencimiento: string };
  const mp = await marcarPagada(c.id, (overrides.fecha_pago as string) || hoy(), "transferencia");
  assert.ok(mp.ok, "marcarPagada: " + (mp.ok ? "" : mp.error));
  return c;
}
async function codigos(id: string) {
  const { data } = await supabaseAdmin.from("empresa_codigos").select("*").eq("campania_id", id).order("created_at");
  return data ?? [];
}
async function codEstado(codigo: string) {
  const { data } = await supabaseAdmin.from("empresa_codigos").select("estado, usos_actuales").eq("codigo", codigo).single();
  return data!;
}
async function limpiar() {
  const { data: camps } = await supabaseAdmin.from("empresa_campanias").select("id").like("empresa", "__TEST_EMP_%");
  const ids = (camps ?? []).map((c) => c.id);
  // Reservas temporales (por vínculo o por beneficiario de test) + sus slots.
  const { data: r1 } = ids.length ? await supabaseAdmin.from("reservas").select("id").in("empresa_campania_id", ids) : { data: [] };
  const { data: r2 } = await supabaseAdmin.from("reservas").select("id").eq("origen", "empresa").eq("nombre", "ZZTEST");
  const rids = Array.from(new Set([...(r1 ?? []), ...(r2 ?? [])].map((r) => r.id)));
  if (rids.length) {
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  if (ids.length) await supabaseAdmin.from("empresa_campanias").delete().in("id", ids); // cascade codigos/usos
}

async function main() {
  try {
    // ── HAPPY PATH ─────────────────────────────────────────────────────────────
    const a = await crearActiva();
    assert.ok((await generarCodigos(a.id)).ok);
    const codsA = await codigos(a.id);
    assert.equal(codsA.length, 5);
    const cod1 = codsA[0].codigo;
    const val = await validarCodigo(cod1);
    assert.ok(val.ok);
    assert.equal((val.data as { beneficio: { duracion_minutos: number } }).beneficio.duracion_minutos, 30);

    const rr = await reservarConCodigo(cod1, BENEF, T_FECHA, "10:00", [SIM_A]);
    assert.ok(rr.ok, "reservar: " + (rr.ok ? "" : rr.error));
    const reservaId = (rr.data as { reserva_id: number }).reserva_id;
    // Código consumido + uso con reserva.
    assert.deepEqual(await codEstado(cod1), { estado: "utilizado", usos_actuales: 1 });
    const { data: usos } = await supabaseAdmin.from("empresa_codigo_usos").select("*").eq("codigo_id", codsA[0].id);
    assert.equal(usos!.length, 1);
    assert.equal(usos![0].reserva_id, reservaId);
    // Reserva real: activa, total 0, origen empresa, con apellido/email, vinculada.
    const { data: reserva } = await supabaseAdmin.from("reservas").select("*").eq("id", reservaId).single();
    assert.equal(reserva!.estado, "activa");
    assert.equal(Number(reserva!.total), 0);
    assert.equal(reserva!.origen, "empresa");
    assert.equal(reserva!.apellido, "Benef");
    assert.equal(reserva!.email, "zz@test.emp");
    assert.equal(reserva!.empresa_campania_id, a.id);
    assert.equal(reserva!.mercado_pago_payment_id, null, "sin Mercado Pago");
    // Slots: 30 min = 2 slots (10:00 y 10:20) × 1 simulador.
    const { data: slots } = await supabaseAdmin.from("reserva_slots").select("*").eq("reserva_id", reservaId);
    assert.equal(slots!.length, 2);
    assert.ok(slots!.every((s) => s.estado === "activa" && s.simulador === SIM_A));
    // No se creó turnos_stand para esta reserva.
    const { count: standCount } = await supabaseAdmin.from("turnos_stand").select("id", { count: "exact", head: true }).eq("fecha", T_FECHA);
    assert.equal(standCount ?? 0, 0, "no crea turnos_stand");

    // ── FALLO DE SLOT: otro código, mismo turno/sim ocupado → sin reserva ni consumo ─
    const cod2 = codsA[1].codigo;
    const rFail = await reservarConCodigo(cod2, BENEF, T_FECHA, "10:00", [SIM_A]);
    assert.equal(rFail.ok, false, "slot ocupado debe fallar");
    assert.deepEqual(await codEstado(cod2), { estado: "disponible", usos_actuales: 0 }, "código del que falla NO se consume");

    // ── IDEMPOTENCIA: misma key dos veces → misma reserva, un solo consumo ─────
    const cod3 = codsA[2].codigo;
    const key = `idem-${Date.now()}`;
    const i1 = await reservarConCodigo(cod3, BENEF, T_FECHA, "11:00", [SIM_A], key);
    const i2 = await reservarConCodigo(cod3, BENEF, T_FECHA, "11:00", [SIM_A], key);
    assert.ok(i1.ok && i2.ok);
    assert.equal((i1.data as { reserva_id: number }).reserva_id, (i2.data as { reserva_id: number }).reserva_id, "idempotente: misma reserva");
    assert.deepEqual(await codEstado(cod3), { estado: "utilizado", usos_actuales: 1 }, "un solo consumo");

    // ── CONCURRENCIA MISMO CÓDIGO: 2 requests simultáneas → una sola ──────────
    const b = await crearActiva({ cantidad_contratada: 1 });
    await generarCodigos(b.id);
    const codB = (await codigos(b.id))[0].codigo;
    const [c1, c2] = await Promise.all([
      reservarConCodigo(codB, BENEF, T_FECHA, "12:00", [SIM_A]),
      reservarConCodigo(codB, BENEF, T_FECHA, "13:00", [SIM_B]),
    ]);
    assert.equal([c1, c2].filter((r) => r.ok).length, 1, "mismo código: solo una reserva");
    assert.equal((await codEstado(codB)).usos_actuales, 1);

    // ── CONCURRENCIA MISMO SLOT, códigos distintos → uno gana, perdedor NO consume ─
    const d = await crearActiva({ cantidad_contratada: 2 });
    await generarCodigos(d.id);
    const codsD = await codigos(d.id);
    const [s1, s2] = await Promise.all([
      reservarConCodigo(codsD[0].codigo, BENEF, T_FECHA, "14:00", [SIM_B]),
      reservarConCodigo(codsD[1].codigo, BENEF, T_FECHA, "14:00", [SIM_B]),
    ]);
    assert.equal([s1, s2].filter((r) => r.ok).length, 1, "mismo slot: solo una reserva");
    const usosD = (await codEstado(codsD[0].codigo)).usos_actuales + (await codEstado(codsD[1].codigo)).usos_actuales;
    assert.equal(usosD, 1, "el código perdedor sigue disponible (no se consume)");

    // ── GUARDS: programada / vencida / no pagada / bloqueado ──────────────────
    const prog = await crearActiva({ fecha_inicio: sumarDias(hoy(), 15) });
    await generarCodigos(prog.id);
    assert.equal((await reservarConCodigo((await codigos(prog.id))[0].codigo, BENEF, T_FECHA, "10:00", [SIM_A])).ok, false, "programada no reserva");

    const venc = await crearActiva({ fecha_pago: sumarDias(hoy(), -90), fecha_inicio: sumarDias(hoy(), -90) });
    await generarCodigos(venc.id);
    assert.equal((await reservarConCodigo((await codigos(venc.id))[0].codigo, BENEF, T_FECHA, "10:00", [SIM_A])).ok, false, "vencida no reserva");

    const noPag = await crearCampania({ empresa: MARCA, nombre_campania: "X", modalidad: "unica", cantidad_contratada: 2, duracion_minutos: 30, precio_neto: 1, iva_porcentaje: 21, fecha_inicio: hoy() }, "admin");
    assert.ok(noPag.ok);
    assert.equal((await generarCodigos((noPag.data as { id: string }).id)).ok, false, "sin pago no genera códigos");

    const bloq = codsA[3].codigo;
    await setEstadoCodigo(a.id, codsA[3].id, "bloqueado");
    assert.equal((await reservarConCodigo(bloq, BENEF, T_FECHA, "15:00", [SIM_A])).ok, false, "código bloqueado no reserva");

    // ── CANCELACIÓN: libera slots + revierte código ──────────────────────────
    const canc = await cancelarReservaEmpresa(reservaId, true);
    assert.ok(canc.ok);
    assert.deepEqual(await codEstado(cod1), { estado: "disponible", usos_actuales: 0 }, "cancelar libera el código");
    const { data: rCanc } = await supabaseAdmin.from("reservas").select("estado").eq("id", reservaId).single();
    assert.equal(rCanc!.estado, "cancelada");
    const { data: slotsCanc } = await supabaseAdmin.from("reserva_slots").select("estado").eq("reserva_id", reservaId);
    assert.ok(slotsCanc!.every((s) => s.estado === "cancelada"), "slots liberados");
    // El slot 10:00/SIM_A quedó libre → cod2 ahora sí puede reservarlo.
    assert.ok((await reservarConCodigo(cod2, BENEF, T_FECHA, "10:00", [SIM_A])).ok, "slot liberado reutilizable");

    // ── REPROGRAMACIÓN: mismo código/uso, nuevos slots ────────────────────────
    const idemResv = (i1.data as { reserva_id: number }).reserva_id;
    const rep = await reprogramarReservaEmpresa(idemResv, T_FECHA, "16:00", [SIM_A]);
    assert.ok(rep.ok, "reprogramar: " + (rep.ok ? "" : rep.error));
    assert.deepEqual(await codEstado(cod3), { estado: "utilizado", usos_actuales: 1 }, "reprogramar NO consume otro uso");
    const { data: rRep } = await supabaseAdmin.from("reservas").select("hora").eq("id", idemResv).single();
    assert.equal(rRep!.hora, "16:00", "reserva reprogramada");

    // ── FINANZAS: fuente empresas por fecha_pago, idempotente, canjes = 0 ──────
    // Campaña con pago e inicio en 2030-06 (mes aislado, sin datos reales).
    const fin = await crearActiva({ fecha_pago: "2030-06-10", fecha_inicio: "2030-06-10", precio_neto: 100000, iva_porcentaje: 21 });
    const totalEmpresas = async () => {
      const { data } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: "2030-06" });
      const row = ((data ?? []) as Array<{ fuente: string; total: number }>).find((r) => r.fuente === "empresas");
      return Number(row?.total ?? 0);
    };
    assert.equal(await totalEmpresas(), 121000, "un ingreso = precio_total (neto+IVA)");
    // Marcar pagada de nuevo (idempotente) → mismo ingreso (deriva de la campaña).
    await marcarPagada(fin.id, "2030-06-10", "transferencia");
    assert.equal(await totalEmpresas(), 121000, "marcar pagada dos veces no duplica");
    // Generar códigos (uso operativo) NO altera el ingreso; los canjes tampoco (el
    // ingreso deriva de precio_total de la campaña, no de usos/reservas).
    await generarCodigos(fin.id);
    assert.equal(await totalEmpresas(), 121000, "generar/usar códigos no genera ingreso nuevo");

    // ── INFORME con datos reales ──────────────────────────────────────────────
    const det = await getCampania(a.id);
    assert.ok(det.ok);
    const dd = det.data as { usos: Array<{ reserva: { simuladores?: unknown } | null }>; simuladores: Array<{ nombre: string; usos: number }> };
    assert.ok(dd.usos.some((u) => u.reserva && Array.isArray(u.reserva.simuladores)), "usos con reserva real");
    const inf = await datosInforme(a.id, "definitivo");
    assert.ok(inf.ok);
    const infd = inf.data as { tipo: string; simuladores: Array<{ nombre: string }>; evolucion: unknown[]; usos: unknown[] };
    assert.equal(infd.tipo, "definitivo");
    assert.ok(Array.isArray(infd.simuladores));
    assert.ok(Array.isArray(infd.evolucion));

    console.log("OK — empresas Fase 2: reserva+canje atómico (reserva/slots/consumo/uso), " +
      "fallo de slot sin consumo, idempotencia (misma reserva), concurrencia mismo código y mismo slot, " +
      "guards (programada/vencida/no-pagada/bloqueado), cancelación (libera código+slots), " +
      "reprogramación (sin segundo uso), Finanzas (fuente empresas por fecha_pago, idempotente, canjes=0), " +
      "informe con reservas reales. Sin turnos_stand ni Mercado Pago.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
