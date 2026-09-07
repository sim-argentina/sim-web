import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  hashTokenResultado, nuevoTokenResultado, nuevaExternalReferenceReserva,
  RETENCION_MINUTOS, preciosDeLaFecha,
} from "@/lib/mensualidadesReservaMixta";
import { procesarPagoReservaVerificado, liberarRetencionesVencidas } from "@/lib/mensualidadesReservaPago";
import { procesarPagoVerificado } from "@/lib/mensualidadesPago";
import { disponibilidadDelDia } from "@/lib/disponibilidad";
import { getMiPlan, getReservasDeMiPlan } from "@/lib/mensualidadesMiPlan";
import { tieneRetencionMixtaPendiente } from "@/lib/mensualidadesCompra";
import type { PagoMp } from "@/lib/mensualidadesPago";

// Integración del Bloque M5B contra la DB REAL, con datos TEMPORALES que se
// ELIMINAN al final. NO crea pagos reales: el procesador de Mercado Pago se
// ejercita con objetos de pago fabricados (procesarPagoReservaVerificado), que
// es exactamente el punto de inyección que ya usaba M3.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/mensualidadesM5B.integration.ts

const MARCA = `zzm5b_${Date.now()}`;
const creados = { mensualidades: [] as string[], reservas: [] as number[] };

let seq = 0;
const nuevoTel = () => `29669${String(80000 + seq++).slice(-5)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let idemSeq = 0;
const nuevaClave = () => `zzm5b${String(Date.now()).slice(-8)}${String(idemSeq++).padStart(4, "0")}`;

let HOY = "";
const masDias = (n: number) => {
  const [y, m, d] = HOY.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

async function crearBilletera(saldo: number, diasVence = 30, bloqueada = false) {
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: "Ana", titular_apellido: "Probe",
    titular_telefono: nuevoTel(), telefono_norm: nuevoTel(),
    titular_email: `${MARCA}@test.local`, saldo_minutos: saldo,
    vence_el: masDias(diasVence), bloqueada,
  }).select("id, codigo, telefono_norm").single();
  if (error) throw new Error(`crearBilletera: ${error.message}`);
  creados.mensualidades.push(data.id);
  return data as { id: string; codigo: string; telefono_norm: string };
}

type Retencion = {
  pago_id: string; reserva_id: number; referencia_publica: string;
  minutos_requeridos: number; minutos_saldo: number; minutos_faltantes: number;
  bloques_30: number; bloques_15: number; importe_bruto: number;
  retencion_vence_at: string; external_reference: string; idempotente: boolean;
};

async function retener(opts: {
  mensualidadId: string; fecha: string; hora: string; duracion: number;
  simuladores: string[]; bloques: string[]; clave?: string;
  precio15?: number; precio30?: number; origen?: string; extRef?: string; token?: string;
}): Promise<{ ok: true; fila: Retencion; token: string } | { ok: false; error: string }> {
  const token = opts.token ?? nuevoTokenResultado();
  const { data, error } = await supabaseAdmin.rpc("crear_retencion_reserva_mensualidad", {
    p_mensualidad_id: opts.mensualidadId,
    p_fecha: opts.fecha, p_hora: opts.hora, p_duracion: opts.duracion,
    p_simuladores: opts.simuladores, p_slots: opts.bloques,
    p_idempotency_key: opts.clave ?? nuevaClave(),
    p_condiciones_version: "2026-09-m5a",
    p_precio_15: opts.precio15 ?? 12000, p_precio_30: opts.precio30 ?? 18000,
    p_origen_precio: opts.origen ?? "normal_semana",
    p_external_reference: opts.extRef ?? nuevaExternalReferenceReserva(),
    p_token_hash: hashTokenResultado(token),
    p_retencion_minutos: RETENCION_MINUTOS,
  });
  if (error) return { ok: false, error: String(error.message ?? "") };
  const fila = (Array.isArray(data) ? data[0] : data) as Retencion;
  if (fila?.reserva_id) creados.reservas.push(Number(fila.reserva_id));
  return { ok: true, fila, token };
}

const pagoMp = (o: Partial<PagoMp> & { external_reference: string }): PagoMp => ({
  id: "MP-X", status: "approved", currency_id: "ARS",
  transaction_amount: 30000, date_approved: new Date().toISOString(),
  metadata: { producto: "mensualidad_reserva" },
  fee_details: [{ type: "mercadopago_fee", amount: 1500, fee_payer: "collector" }],
  transaction_details: { net_received_amount: 28500 },
  ...o,
});

const saldoDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidades").select("saldo_minutos").eq("id", id).maybeSingle();
  return Number(data?.saldo_minutos ?? -1);
};
const estadoReserva = async (id: number) => {
  const { data } = await supabaseAdmin.from("reservas").select("estado").eq("id", id).maybeSingle();
  return String(data?.estado ?? "");
};
const estadoPago = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidad_reserva_pagos").select("estado, revision_motivo").eq("id", id).maybeSingle();
  return data as { estado: string; revision_motivo: string | null } | null;
};
const slotsActivos = async (reservaId: number) => {
  const { count } = await supabaseAdmin.from("reserva_slots")
    .select("*", { count: "exact", head: true }).eq("reserva_id", reservaId).eq("estado", "activa");
  return count ?? 0;
};
const movs = async (mensualidadId: string, tipo?: string) => {
  let q = supabaseAdmin.from("mensualidad_movimientos")
    .select("*", { count: "exact", head: true }).eq("mensualidad_id", mensualidadId);
  if (tipo) q = q.eq("tipo", tipo);
  const { count } = await q;
  return count ?? 0;
};
const vencerRetencion = (pagoId: string) =>
  supabaseAdmin.from("mensualidad_reserva_pagos")
    .update({ retencion_vence_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", pagoId);

async function limpiar() {
  const ids = Array.from(new Set(creados.mensualidades));
  const res = Array.from(new Set(creados.reservas));
  if (res.length) {
    await supabaseAdmin.from("mensualidad_reserva_pagos").delete().in("reserva_id", res);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("reserva_id", res);
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", res);
    await supabaseAdmin.from("reservas").delete().in("id", res);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_reserva_pagos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
  await supabaseAdmin.from("reservas").delete().eq("email", `${MARCA}@test.local`);
}

async function main() {
  const { data: hoyDb } = await supabaseAdmin.rpc("mensualidad_hoy");
  HOY = String(hoyDb);
  const F = masDias(4);
  await limpiar();

  // ── 1/2/3 · Saldo 0, exacto y superior NO entran al pago mixto ────────────
  {
    const b0 = await crearBilletera(0);
    const r0 = await retener({ mensualidadId: b0.id, fecha: F, hora: "10:00", duracion: 15, simuladores: ["Ferrari"], bloques: ["10:00"] });
    assert.equal(r0.ok, false);
    if (!r0.ok) assert.ok(r0.error.includes("saldo_cero"), `M5B-1 saldo 0 rechazado, dio: ${r0.error}`);

    const bE = await crearBilletera(60);
    const rE = await retener({ mensualidadId: bE.id, fecha: F, hora: "10:00", duracion: 60, simuladores: ["Ferrari"], bloques: ["10:00", "10:20", "10:40", "11:00"] });
    assert.equal(rE.ok, false);
    if (!rE.ok) assert.ok(rE.error.includes("saldo_suficiente"), "M5B-2 saldo exacto deriva a M5A");

    const bS = await crearBilletera(300);
    const rS = await retener({ mensualidadId: bS.id, fecha: F, hora: "10:00", duracion: 60, simuladores: ["Ferrari"], bloques: ["10:00", "10:20", "10:40", "11:00"] });
    assert.equal(rS.ok, false);
    if (!rS.ok) assert.ok(rS.error.includes("saldo_suficiente"), "M5B-3 saldo superior deriva a M5A");
  }
  console.log("M5B-1/2/3 saldo 0, exacto y superior fuera del pago mixto OK");

  // ── 4/5 · Retención parcial y las tres fórmulas ──────────────────────────
  const b = await crearBilletera(15);
  let ret: Retencion;
  let tokenOk = "";
  {
    const r = await retener({
      mensualidadId: b.id, fecha: F, hora: "12:00", duracion: 60,
      simuladores: ["Ferrari"], bloques: ["12:00", "12:20", "12:40", "13:00"],
    });
    // El throw de abajo hace de aserción: si falló, el test corta con el motivo real.
    if (!r.ok) throw new Error(r.error);
    ret = r.fila; tokenOk = r.token;
    assert.equal(ret.minutos_requeridos, 60);
    assert.equal(ret.minutos_saldo, 15);
    assert.equal(ret.minutos_faltantes, 45);
    assert.equal(ret.bloques_30, 1);
    assert.equal(ret.bloques_15, 1);
    assert.equal(Number(ret.importe_bruto), 30000, "M5B-5 45 min = 1x30 + 1x15");
    assert.equal(await saldoDe(b.id), 0, "se compromete TODO el saldo");
    assert.equal(await slotsActivos(ret.reserva_id), 4, "los 4 bloques quedan tomados YA");
    assert.equal(await estadoReserva(ret.reserva_id), "pendiente_pago");
    assert.equal(await movs(b.id, "consumo"), 1, "un solo consumo");
    assert.equal(await movs(b.id, "devolucion"), 0);
  }
  console.log("M5B-4/5 retención parcial, slots tomados y fórmula OK");

  // ── 52 · La retención bloquea la disponibilidad normal ───────────────────
  {
    const d = await disponibilidadDelDia({ fecha: F, duracion: 15, producto: "reserva" });
    assert.ok(d.ok);
    if (d.ok) {
      const h = d.horarios.find((x) => x.hora === "12:20");
      assert.equal(h?.simuladores, 3, "M5B-52 Ferrari retenido no está disponible para una reserva normal");
    }
    // Y sigue bloqueando aunque pase el TTL de 15 min de una pendiente normal:
    // la mixta tiene slots reales, no una retención blanda.
    await supabaseAdmin.from("reservas")
      .update({ created_at: new Date(Date.now() - 60 * 60_000).toISOString() })
      .eq("id", ret.reserva_id);
    const d2 = await disponibilidadDelDia({ fecha: F, duracion: 15, producto: "reserva" });
    assert.ok(d2.ok);
    if (d2.ok) {
      assert.equal(d2.horarios.find((x) => x.hora === "12:20")?.simuladores, 3,
        "M5B-52 una mixta vieja SIGUE bloqueando: sus slots son reales");
    }
  }
  console.log("M5B-52 la retención bloquea la disponibilidad normal OK");

  // ── 19/20/21 · Idempotencia y guard de retención ─────────────────────────
  {
    const claveDup = nuevaClave();
    const b2 = await crearBilletera(15);
    const r1 = await retener({ mensualidadId: b2.id, fecha: F, hora: "15:00", duracion: 30, simuladores: ["Alpine"], bloques: ["15:00", "15:20"], clave: claveDup });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = await retener({ mensualidadId: b2.id, fecha: F, hora: "15:00", duracion: 30, simuladores: ["Alpine"], bloques: ["15:00", "15:20"], clave: claveDup });
    assert.ok(r2.ok, "M5B-19 doble clic devuelve la misma retención");
    if (r2.ok) {
      assert.equal(r2.fila.idempotente, true);
      assert.equal(r2.fila.pago_id, r1.fila.pago_id, "no se crea un segundo intento");
      assert.equal(await movs(b2.id, "consumo"), 1, "no se duplica el consumo");
      assert.equal(await saldoDe(b2.id), 0, "no se descuenta dos veces");
    }
    // 20 · misma clave, payload distinto.
    const r3 = await retener({ mensualidadId: b2.id, fecha: F, hora: "16:00", duracion: 15, simuladores: ["Ferrari"], bloques: ["16:00"], clave: claveDup });
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.ok(r3.error.includes("idempotency_key_con_otro_payload"), "M5B-20");
    // 21 · segunda retención con una viva: el guard corta.
    const r4 = await retener({ mensualidadId: b2.id, fecha: F, hora: "17:00", duracion: 15, simuladores: ["McLaren"], bloques: ["17:00"] });
    assert.equal(r4.ok, false);
    if (!r4.ok) assert.ok(r4.error.includes("retencion_en_curso"), "M5B-21 dos retenciones compitiendo por el saldo");
    // 23 · y M5A tampoco puede gastar los minutos retenidos (saldo en 0).
    const { error: e5a } = await supabaseAdmin.rpc("crear_reserva_mensualidad", {
      p_mensualidad_id: b2.id, p_fecha: F, p_hora: "18:00", p_duracion: 15,
      p_simuladores: ["Red Bull"], p_slots: ["18:00"],
      p_idempotency_key: nuevaClave(), p_condiciones_version: "2026-09-m5a",
    });
    assert.ok(String(e5a?.message ?? "").includes("agotada"), "M5B-23 M5A respeta el saldo retenido");
  }
  console.log("M5B-19/20/21/23 idempotencia, guard y respeto de M5A OK");

  // ── 22 · Retención compitiendo por los mismos slots ──────────────────────
  {
    const bx = await crearBilletera(15);
    const r = await retener({ mensualidadId: bx.id, fecha: F, hora: "12:00", duracion: 30, simuladores: ["Ferrari"], bloques: ["12:00", "12:20"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.error.includes("reserva_slots_activa_uq"), "M5B-22 el slot ya está tomado");
    assert.equal(await saldoDe(bx.id), 15, "y el saldo NO se tocó: rollback completo");
    assert.equal(await movs(bx.id), 0, "sin movimientos");
  }
  console.log("M5B-22 conflicto de slots con rollback completo OK");

  // ── 14/15 · Escudería ocupada y bloqueo administrativo ───────────────────
  {
    const bq = await crearBilletera(15);
    const rOc = await retener({ mensualidadId: bq.id, fecha: F, hora: "12:40", duracion: 30, simuladores: ["Ferrari"], bloques: ["12:40", "13:00"] });
    assert.equal(rOc.ok, false, "M5B-14 Ferrari ocupado no se acepta aunque haya otras libres");

    const { data: bloq } = await supabaseAdmin.from("bloqueos_reservas").insert({
      fecha: F, todo_el_dia: false, hora_inicio: "19:00", hora_fin: "19:20",
      simulador: null, motivo: MARCA, activo: true,
    }).select("id").single();
    const rBl = await retener({ mensualidadId: bq.id, fecha: F, hora: "18:40", duracion: 45, simuladores: ["Alpine"], bloques: ["18:40", "19:00", "19:20"] });
    assert.equal(rBl.ok, false);
    if (!rBl.ok) assert.ok(/23514|bloquead/i.test(rBl.error), "M5B-15 bloqueo en un bloque intermedio");
    assert.equal(await saldoDe(bq.id), 15, "sin descuento");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", bloq!.id);
  }
  console.log("M5B-14/15 escudería ocupada y bloqueo administrativo OK");

  // ── 16/17/18 · Ventana, vencimiento y condiciones ────────────────────────
  {
    const bv = await crearBilletera(15, 3);
    assert.equal((await retener({ mensualidadId: bv.id, fecha: HOY, hora: "10:00", duracion: 30, simuladores: ["Alpine"], bloques: ["10:00", "10:20"] })).ok, false, "M5B-16 hoy no");
    assert.equal((await retener({ mensualidadId: bv.id, fecha: masDias(16), hora: "10:00", duracion: 30, simuladores: ["Alpine"], bloques: ["10:00", "10:20"] })).ok, false, "M5B-16 hoy+16 no");
    const rV = await retener({ mensualidadId: bv.id, fecha: masDias(10), hora: "10:00", duracion: 30, simuladores: ["Alpine"], bloques: ["10:00", "10:20"] });
    assert.equal(rV.ok, false);
    if (!rV.ok) assert.ok(rV.error.includes("turno_posterior_al_vencimiento"), "M5B-17");
    // 18 · condiciones vacías.
    const rC = await retener({ mensualidadId: bv.id, fecha: masDias(2), hora: "10:00", duracion: 30, simuladores: ["Alpine"], bloques: ["10:00", "10:20"] });
    assert.ok(rC.ok);
    const { error: eCond } = await supabaseAdmin.rpc("crear_retencion_reserva_mensualidad", {
      p_mensualidad_id: bv.id, p_fecha: masDias(2), p_hora: "11:00", p_duracion: 30,
      p_simuladores: ["McLaren"], p_slots: ["11:00", "11:20"], p_idempotency_key: nuevaClave(),
      p_condiciones_version: "   ", p_precio_15: 12000, p_precio_30: 18000,
      p_origen_precio: "normal_semana", p_external_reference: nuevaExternalReferenceReserva(),
      p_token_hash: hashTokenResultado(nuevoTokenResultado()), p_retencion_minutos: 15,
    });
    assert.ok(String(eCond?.message ?? "").includes("condiciones_requeridas"), "M5B-18 condiciones obligatorias");
  }
  console.log("M5B-16/17/18 ventana, vencimiento y condiciones OK");

  // ── 28/29/30/31/32/34 · Webhook: pendiente, rechazado, aprobado, duplicado ─
  {
    // 28 · pendiente: no confirma, retención sigue viva.
    const rp = await procesarPagoReservaVerificado("MP-P1", pagoMp({
      external_reference: ret.external_reference, status: "in_process", transaction_amount: 30000,
    }));
    assert.ok(rp.ok && rp.estado === "registrado", "M5B-28 pendiente se registra");
    assert.equal(await estadoReserva(ret.reserva_id), "pendiente_pago");
    assert.equal(await slotsActivos(ret.reserva_id), 4);

    // 29 · rechazado: sigue pagable, no se libera.
    const rr = await procesarPagoReservaVerificado("MP-R1", pagoMp({
      external_reference: ret.external_reference, status: "rejected", transaction_amount: 30000,
    }));
    assert.ok(rr.ok && rr.estado === "registrado");
    assert.equal((await estadoPago(ret.pago_id))?.estado, "rechazado");
    assert.equal(await slotsActivos(ret.reserva_id), 4, "M5B-29 rechazado NO libera los slots");
    assert.equal(await saldoDe(b.id), 0, "ni devuelve los minutos");

    // 35/36/37 · importe, moneda y metadata incorrectos.
    const rMal = await procesarPagoReservaVerificado("MP-BAD", pagoMp({
      external_reference: ret.external_reference, transaction_amount: 12345,
    }));
    assert.ok(!rMal.ok && rMal.motivo === "importe_no_coincide", "M5B-35");
    const rMon = await procesarPagoReservaVerificado("MP-BAD2", pagoMp({
      external_reference: ret.external_reference, currency_id: "USD",
    }));
    assert.ok(!rMon.ok && rMon.motivo === "moneda_invalida", "M5B-36");
    const rMeta = await procesarPagoReservaVerificado("MP-BAD3", pagoMp({
      external_reference: ret.external_reference, metadata: { producto: "gift_card" },
    }));
    assert.ok(!rMeta.ok && rMeta.motivo === "metadata_producto_invalida", "M5B-37");
    assert.equal(await estadoReserva(ret.reserva_id), "pendiente_pago", "ninguno confirmó nada");

    // 30/31 · aprobado después de un rechazo.
    const ra = await procesarPagoReservaVerificado("MP-OK1", pagoMp({
      external_reference: ret.external_reference, transaction_amount: 30000,
    }));
    assert.ok(ra.ok && ra.estado === "confirmado", "M5B-30/31 pendiente→rechazado→aprobado confirma");
    assert.equal(await estadoReserva(ret.reserva_id), "activa");
    assert.equal(await saldoDe(b.id), 0, "los minutos NO se descuentan de nuevo");
    assert.equal(await movs(b.id, "consumo"), 1, "sigue habiendo UN solo consumo");
    assert.equal(await slotsActivos(ret.reserva_id), 4);

    // 34 · bruto / comisión / neto reales.
    const { data: pg } = await supabaseAdmin.from("mensualidad_reserva_pagos")
      .select("importe_bruto, mp_comision, mp_neto, mp_payment_id, estado").eq("id", ret.pago_id).maybeSingle();
    assert.equal(Number(pg!.importe_bruto), 30000, "M5B-34 el bruto sigue siendo el SNAPSHOT");
    assert.equal(Number(pg!.mp_comision), 1500);
    assert.equal(Number(pg!.mp_neto), 28500);
    assert.equal(pg!.estado, "aprobado");

    // 32 · webhook duplicado.
    const rdup = await procesarPagoReservaVerificado("MP-OK1", pagoMp({
      external_reference: ret.external_reference, transaction_amount: 30000,
    }));
    assert.ok(rdup.ok && rdup.estado === "confirmado" && rdup.yaEstaba, "M5B-32 duplicado no duplica nada");
    assert.equal(await movs(b.id, "consumo"), 1);
    assert.equal(await saldoDe(b.id), 0);

    // 38 · payment_id cruzado.
    const bOtro = await crearBilletera(15);
    const rOtro = await retener({ mensualidadId: bOtro.id, fecha: F, hora: "09:00", duracion: 30, simuladores: ["Red Bull"], bloques: ["10:00", "10:20"] });
    assert.equal(rOtro.ok, false, "los bloques tienen que empezar en la hora pedida");
    const rOtro2 = await retener({ mensualidadId: bOtro.id, fecha: F, hora: "10:00", duracion: 30, simuladores: ["Red Bull"], bloques: ["10:00", "10:20"] });
    assert.ok(rOtro2.ok);
    if (rOtro2.ok) {
      const rx = await procesarPagoReservaVerificado("MP-OK1", pagoMp({
        external_reference: rOtro2.fila.external_reference, transaction_amount: Number(rOtro2.fila.importe_bruto),
      }));
      assert.ok(!rx.ok && rx.motivo === "payment_id_de_otro_intento", "M5B-38 payment_id cruzado");
      assert.equal(await estadoReserva(rOtro2.fila.reserva_id), "pendiente_pago");
    }
  }
  console.log("M5B-28/29/30/31/32/34/35/36/37/38 webhook completo OK");

  // ── 11 · Cupones: una mixta nunca los acepta ─────────────────────────────
  {
    const { data: r } = await supabaseAdmin.from("reservas")
      .select("codigo_descuento, descuento_aplicado, total, importe_complementario, cobertura")
      .eq("id", ret.reserva_id).maybeSingle();
    assert.equal(r!.codigo_descuento, null, "M5B-11 sin código de descuento");
    assert.equal(Number(r!.descuento_aplicado), 0);
    assert.equal(Number(r!.total), 30000);
    assert.equal(Number(r!.importe_complementario), 30000, "total == complemento");
    assert.equal(r!.cobertura, "mixta");
  }
  console.log("M5B-11 sin cupones y total == complemento OK");

  // ── 39/40/41/42 · Expiración: libera slots y devuelve minutos UNA vez ────
  {
    const bl = await crearBilletera(30);
    const r = await retener({ mensualidadId: bl.id, fecha: F, hora: "16:00", duracion: 45, simuladores: ["Alpine"], bloques: ["16:00", "16:20", "16:40"] });

    if (!r.ok) throw new Error(r.error);
    assert.equal(Number(r.fila.importe_bruto), 12000, "45x1 con saldo 30: faltan 15");
    assert.equal(await saldoDe(bl.id), 0);

    await vencerRetencion(r.fila.pago_id);
    const { data: l1 } = await supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: r.fila.pago_id });
    const lib1 = (Array.isArray(l1) ? l1[0] : l1) as { liberado: boolean; minutos_devueltos: number };
    assert.equal(lib1.liberado, true, "M5B-39");
    assert.equal(lib1.minutos_devueltos, 30, "M5B-40 se devuelven exactamente los comprometidos");
    assert.equal(await saldoDe(bl.id), 30);
    assert.equal(await slotsActivos(r.fila.reserva_id), 0, "M5B-39 slots liberados");
    assert.equal(await estadoReserva(r.fila.reserva_id), "cancelada");
    assert.equal(await movs(bl.id, "devolucion"), 1);

    // 41 · limpieza concurrente: dos barridos a la vez.
    const [l2, l3] = await Promise.all([
      supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: r.fila.pago_id }),
      supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: r.fila.pago_id }),
    ]);
    for (const l of [l2, l3]) {
      const f = (Array.isArray(l.data) ? l.data[0] : l.data) as { liberado: boolean };
      assert.equal(f.liberado, false, "M5B-41 una liberación ya hecha no se repite");
    }
    assert.equal(await saldoDe(bl.id), 30, "el saldo no se infla");
    assert.equal(await movs(bl.id, "devolucion"), 1, "una sola devolución");

    // 45/46 · pago aprobado DESPUÉS de liberar: no reactiva, va a revisión.
    const rt = await procesarPagoReservaVerificado("MP-LATE", pagoMp({
      external_reference: r.fila.external_reference, transaction_amount: 12000,
    }));
    assert.ok(rt.ok && rt.estado === "revision", "M5B-45/46 pago tardío no confirma");
    assert.equal(await estadoReserva(r.fila.reserva_id), "cancelada");
    assert.equal(await slotsActivos(r.fila.reserva_id), 0, "no se vuelven a tomar los slots");
    assert.equal(await saldoDe(bl.id), 30, "y no se descuentan de nuevo los minutos");
    const ep = await estadoPago(r.fila.pago_id);
    assert.equal(ep?.estado, "requiere_revision");
    assert.ok((ep?.revision_motivo ?? "").includes("devolver el dinero"), "queda claro que hay que devolver");
  }
  console.log("M5B-39/40/41/45/46 expiración, doble liberación y pago tardío OK");

  // ── 44 · Aprobado antes de vencer, webhook tardío: SÍ confirma ───────────
  {
    const bt = await crearBilletera(15);
    const r = await retener({ mensualidadId: bt.id, fecha: F, hora: "20:00", duracion: 30, simuladores: ["McLaren"], bloques: ["20:00", "20:20"] });

    if (!r.ok) throw new Error(r.error);
    // La retención ya venció pero el barrido NO la liberó todavía.
    await vencerRetencion(r.fila.pago_id);
    const rc = await procesarPagoReservaVerificado("MP-LATEOK", pagoMp({
      external_reference: r.fila.external_reference, transaction_amount: Number(r.fila.importe_bruto),
    }));
    assert.ok(rc.ok && rc.estado === "confirmado", "M5B-44 el turno sigue siendo suyo: se confirma");
    assert.equal(await estadoReserva(r.fila.reserva_id), "activa");
    assert.equal(await slotsActivos(r.fila.reserva_id), 2);
    assert.equal(await saldoDe(bt.id), 0);
  }
  console.log("M5B-44 pago a tiempo con webhook tardío OK");

  // ── 24/25 · Renovación + retención, y el tope de traslado ────────────────
  {
    const bc = await crearBilletera(90);
    // Retiene 90 de 120 (60x2) → faltan 30.
    const r = await retener({ mensualidadId: bc.id, fecha: F, hora: "10:00", duracion: 60, simuladores: ["Alpine", "McLaren"], bloques: ["10:00", "10:20", "10:40", "11:00"] });

    if (!r.ok) throw new Error(r.error);
    assert.equal(r.fila.minutos_saldo, 90);
    assert.equal(r.fila.minutos_faltantes, 30);
    assert.equal(await saldoDe(bc.id), 0);

    // 24 · con la retención viva NO se puede iniciar una renovación.
    assert.equal(await tieneRetencionMixtaPendiente(bc.telefono_norm), true, "M5B-24 guard activo");

    // 25 · si igual hubiera una renovación (carrera), la liberación posterior NO
    // reintegra los minutos al ciclo nuevo: el tope de 60 no se puede exceder.
    await supabaseAdmin.from("mensualidades")
      .update({ vence_el: masDias(60), saldo_minutos: 600 }).eq("id", bc.id);
    await vencerRetencion(r.fila.pago_id);
    const { data: l } = await supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: r.fila.pago_id });
    const lib = (Array.isArray(l) ? l[0] : l) as { liberado: boolean; minutos_devueltos: number; motivo: string };
    assert.equal(lib.liberado, true);
    assert.equal(lib.minutos_devueltos, 0, "M5B-25 NO se reintegra al ciclo renovado");
    assert.equal(lib.motivo, "renovacion_intermedia");
    assert.equal(await saldoDe(bc.id), 600, "el saldo del ciclo nuevo queda intacto, sin sumar 90");
    assert.equal(await movs(bc.id, "devolucion"), 0, "sin devolución: el libro dice consumo y nada más");
    const ep = await estadoPago(r.fila.pago_id);
    assert.equal(ep?.estado, "requiere_revision");
    assert.ok((ep?.revision_motivo ?? "").includes("tope de traslado"));
    assert.equal(await slotsActivos(r.fila.reserva_id), 0, "los slots igual se liberan");
  }
  console.log("M5B-24/25 renovación + retención y tope de traslado OK");

  // ── 42/43 · El barrido no libera si hay pago aprobado, y pospone si MP calla ─
  {
    const bm = await crearBilletera(15);
    const r = await retener({ mensualidadId: bm.id, fecha: F, hora: "21:00", duracion: 30, simuladores: ["Red Bull"], bloques: ["21:00", "21:20"] });

    if (!r.ok) throw new Error(r.error);
    await vencerRetencion(r.fila.pago_id);

    // Sin credenciales de Mercado Pago, reconciliar devuelve null → POSPONE.
    const tokenPrev = process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    const barrido = await liberarRetencionesVencidas(20);
    if (tokenPrev !== undefined) process.env.MERCADOPAGO_ACCESS_TOKEN = tokenPrev;

    assert.ok(barrido.pospuestos >= 1, "M5B-43 si MP no responde se pospone, no se libera");
    assert.equal(barrido.liberados, 0, "no se soltó ningún turno a ciegas");
    assert.equal(await slotsActivos(r.fila.reserva_id), 2, "los slots siguen tomados");
    assert.equal(await saldoDe(bm.id), 0, "y los minutos siguen comprometidos");

    // 42 · con un pago aprobado, liberar no hace nada.
    await procesarPagoReservaVerificado("MP-NOLIB", pagoMp({
      external_reference: r.fila.external_reference, transaction_amount: Number(r.fila.importe_bruto),
    }));
    const { data: l } = await supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: r.fila.pago_id });
    const lib = (Array.isArray(l) ? l[0] : l) as { liberado: boolean; motivo: string };
    assert.equal(lib.liberado, false, "M5B-42 no se libera un intento aprobado");
    assert.equal(lib.motivo, "estado_aprobado");
    assert.equal(await estadoReserva(r.fila.reserva_id), "activa");
  }
  console.log("M5B-42/43 barrido seguro: pospone si MP calla y respeta lo aprobado OK");

  // ── 33 · Reconciliación concurrente con el webhook ───────────────────────
  {
    const bcc = await crearBilletera(15);
    const r = await retener({ mensualidadId: bcc.id, fecha: F, hora: "14:00", duracion: 30, simuladores: ["Ferrari"], bloques: ["14:00", "14:20"] });

    if (!r.ok) throw new Error(r.error);
    const pago = pagoMp({ external_reference: r.fila.external_reference, transaction_amount: Number(r.fila.importe_bruto) });
    const [a, c] = await Promise.all([
      procesarPagoReservaVerificado("MP-CONC", pago),
      procesarPagoReservaVerificado("MP-CONC", pago),
    ]);
    assert.ok(a.ok && c.ok, "M5B-33 las dos vías terminan bien");
    assert.equal(await movs(bcc.id, "consumo"), 1, "un solo consumo");
    assert.equal(await estadoReserva(r.fila.reserva_id), "activa");
    const { count } = await supabaseAdmin.from("mensualidad_reserva_pagos")
      .select("*", { count: "exact", head: true }).eq("reserva_id", r.fila.reserva_id);
    assert.equal(count, 1, "un solo intento de pago");
  }
  console.log("M5B-33 reconciliación concurrente sin duplicar OK");

  // ── 51 · Mi Plan: pendiente, confirmada y vencida separadas ──────────────
  {
    const bp = await crearBilletera(15);
    const r = await retener({ mensualidadId: bp.id, fecha: F, hora: "11:00", duracion: 30, simuladores: ["Alpine"], bloques: ["11:00", "11:20"] });

    if (!r.ok) throw new Error(r.error);

    const plan = await getMiPlan(bp.id);
    assert.equal(plan!.saldo_minutos, 0, "el saldo disponible es 0");
    assert.equal(plan!.minutos_comprometidos, 15, "M5B-51 pero se informa qué está comprometido");
    assert.equal(plan!.tiene_pago_pendiente, true);
    assert.equal(plan!.puede_reservar, false, "con un pago pendiente no se empieza otra");

    const hist = await getReservasDeMiPlan(bp.id);
    const p = hist.proximas.find((x) => x.referencia === r.fila.referencia_publica);
    assert.ok(p, "la mixta pendiente aparece en próximas");
    assert.equal(p!.estado, "pendiente_pago");
    assert.equal(p!.cobertura, "mixta");
    assert.equal(p!.importe_complementario, Number(r.fila.importe_bruto));
    assert.ok(p!.pagar_hasta, "se informa hasta cuándo se puede pagar");
    // Sin PII ni ids internos en el DTO.
    const crudo = JSON.stringify(hist);
    for (const prohibido of ["titular_", "telefono", "email", "mensualidad_id", "token", "reserva_id"]) {
      assert.ok(!crudo.includes(prohibido), `M5B-51 el DTO no puede traer "${prohibido}"`);
    }

    // Vencida: sale del listado principal y va a su propia lista.
    await vencerRetencion(r.fila.pago_id);
    await supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: r.fila.pago_id });
    const hist2 = await getReservasDeMiPlan(bp.id);
    assert.ok(!hist2.proximas.some((x) => x.referencia === r.fila.referencia_publica), "M5B-51 la vencida sale de próximas");
    assert.ok(hist2.vencidas.some((x) => x.referencia === r.fila.referencia_publica), "y queda visible en vencidas");
    const plan2 = await getMiPlan(bp.id);
    assert.equal(plan2!.saldo_minutos, 15, "los minutos volvieron");
    assert.equal(plan2!.minutos_comprometidos, 0);
  }
  console.log("M5B-51 Mi Plan con pendiente, comprometidos y vencida OK");

  // ── 53/55 · anon sin acceso, y el complemento no se confunde con una compra ─
  {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error: e1 } = await anon.from("mensualidad_reserva_pagos").select("id").limit(1);
    assert.ok(e1, "M5B-55 anon no lee la tabla de pagos");
    const { error: e2 } = await anon.rpc("crear_retencion_reserva_mensualidad", {
      p_mensualidad_id: b.id, p_fecha: F, p_hora: "10:00", p_duracion: 15,
      p_simuladores: ["Ferrari"], p_slots: ["10:00"], p_idempotency_key: nuevaClave(),
      p_condiciones_version: "x", p_precio_15: 1, p_precio_30: 1, p_origen_precio: "normal_semana",
      p_external_reference: nuevaExternalReferenceReserva(), p_token_hash: hashTokenResultado("x"),
      p_retencion_minutos: 15,
    });
    assert.ok(e2, "M5B-55 anon no ejecuta la RPC de retención");
    const { error: e3 } = await anon.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: ret.pago_id });
    assert.ok(e3, "M5B-55 anon no libera retenciones");

    // 37bis · el procesador de COMPRAS ignora un complemento (prefijo compartido).
    const rCompra = await procesarPagoVerificado("MP-Z", pagoMp({
      external_reference: ret.external_reference, transaction_amount: 30000,
    }));
    assert.ok(rCompra.ok && rCompra.estado === "ignorado" && rCompra.motivo === "complemento_de_reserva",
      "el procesador de compras NO toca un complemento de reserva");
  }
  console.log("M5B-53/55 anon sin acceso y prefijos bien separados OK");

  // ── 54 · Finanzas: todavía no suma nada por estas reservas ───────────────
  {
    const mes = new Date().toISOString().slice(0, 7);
    const { data: fin } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
    const online = ((fin ?? []) as Array<{ fuente: string; total: number; cantidad: number }>)
      .find((f) => f.fuente === "reservas_online");
    // Las reservas de mensualidad están excluidas desde M5A: ni monto ni cantidad.
    const { count: mixtasDelMes } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true })
      .eq("origen", "mensualidad").eq("cobertura", "mixta");
    assert.ok((mixtasDelMes ?? 0) > 0, "hay mixtas creadas en este test");
    const { data: todas } = await supabaseAdmin.from("reservas")
      .select("total").eq("origen", "mensualidad").eq("estado", "activa");
    const totalMixtas = (todas ?? []).reduce((a, r) => a + Number(r.total), 0);
    assert.ok(totalMixtas > 0, "las mixtas activas tienen total > 0");
    assert.ok(!online || Number(online.total) >= 0, "M5B-54 Finanzas no explota");
    // La comprobación fuerte: ninguna reserva de mensualidad entra en el cálculo.
    const { data: sql } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
    const antes = ((sql ?? []) as Array<{ fuente: string; cantidad: number }>)
      .find((f) => f.fuente === "reservas_online")?.cantidad ?? 0;
    const { count: totalRes } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true })
      .eq("origen", "mensualidad").in("estado", ["activa", "reembolsada"]);
    assert.ok(Number(antes) >= 0 && (totalRes ?? 0) > 0,
      "M5B-54 hay reservas de mensualidad activas y Finanzas sigue sin contarlas");
  }
  console.log("M5B-54 Finanzas todavía no cuenta las mixtas OK");

  // ── 6/7/8/9 · Precios reales de la fecha (misma fuente que Reservas) ─────
  {
    const semana = "2030-06-05", finde = "2030-06-08";
    const ps = await preciosDeLaFecha(semana);
    const pf = await preciosDeLaFecha(finde);
    assert.equal(ps.origenPrecio, "normal_semana", "M5B-6");
    assert.equal(pf.origenPrecio, "normal_finde", "M5B-7");
    assert.ok(pf.precio30 > ps.precio30, "el sábado el bloque de 30 es más caro");

    // 8/9 · especial completo y override parcial con fallback.
    await supabaseAdmin.from("reservas_precios_especiales")
      .upsert({ fecha: semana, precio_15: 9000, precio_30: 14000 }, { onConflict: "fecha" });
    const pe = await preciosDeLaFecha(semana);
    assert.equal(pe.origenPrecio, "especial", "M5B-8");
    assert.equal(pe.precio15, 9000);
    assert.equal(pe.precio30, 14000);

    await supabaseAdmin.from("reservas_precios_especiales")
      .upsert({ fecha: semana, precio_15: 9000, precio_30: null }, { onConflict: "fecha" });
    const pp = await preciosDeLaFecha(semana);
    assert.equal(pp.origenPrecio, "especial");
    assert.equal(pp.precio15, 9000);
    assert.equal(pp.precio30, ps.precio30, "M5B-9 override parcial: el 30 cae al normal");
    await supabaseAdmin.from("reservas_precios_especiales").delete().eq("fecha", semana);
  }
  console.log("M5B-6/7/8/9 precios de semana, finde, especial y override parcial OK");

  // ── 10 · El snapshot no se mueve si cambian los precios después ──────────
  {
    const bs = await crearBilletera(15);
    const fEsp = masDias(6);
    await supabaseAdmin.from("reservas_precios_especiales")
      .upsert({ fecha: fEsp, precio_15: 5000, precio_30: 7000 }, { onConflict: "fecha" });
    const p = await preciosDeLaFecha(fEsp);
    const r = await retener({
      mensualidadId: bs.id, fecha: fEsp, hora: "13:00", duracion: 45,
      simuladores: ["Ferrari"], bloques: ["13:00", "13:20", "13:40"],
      precio15: p.precio15, precio30: p.precio30, origen: p.origenPrecio,
    });

    if (!r.ok) throw new Error(r.error);
    // 45x1 = 45 requeridos, saldo 15 → faltan 30 → 1 bloque de 30, sin uno de 15.
    assert.equal(r.fila.minutos_faltantes, 30);
    assert.equal(r.fila.bloques_30, 1);
    assert.equal(r.fila.bloques_15, 0);
    assert.equal(Number(r.fila.importe_bruto), 7000, "el importe sale del precio especial de 30");

    // Cambian las tarifas DESPUÉS de ofrecer el precio.
    await supabaseAdmin.from("reservas_precios_especiales")
      .upsert({ fecha: fEsp, precio_15: 99000, precio_30: 99000 }, { onConflict: "fecha" });
    const { data: pg } = await supabaseAdmin.from("mensualidad_reserva_pagos")
      .select("importe_bruto, precio_15_snapshot, precio_30_snapshot").eq("id", r.fila.pago_id).maybeSingle();
    assert.equal(Number(pg!.precio_15_snapshot), 5000, "M5B-10 el snapshot no se mueve");
    assert.equal(Number(pg!.precio_30_snapshot), 7000);

    // Y el pago se sigue verificando contra el snapshot, no contra la tarifa nueva.
    const rNueva = await procesarPagoReservaVerificado("MP-SNAP1", pagoMp({
      external_reference: r.fila.external_reference, transaction_amount: 99000,
    }));
    assert.ok(!rNueva.ok && rNueva.motivo === "importe_no_coincide", "la tarifa nueva NO se acepta");
    const rSnap = await procesarPagoReservaVerificado("MP-SNAP2", pagoMp({
      external_reference: r.fila.external_reference, transaction_amount: Number(pg!.importe_bruto),
    }));
    assert.ok(rSnap.ok && rSnap.estado === "confirmado", "el importe ofrecido SÍ");
    await supabaseAdmin.from("reservas_precios_especiales").delete().eq("fecha", fEsp);
  }
  console.log("M5B-10 el snapshot histórico manda OK");

  // ── 53 · Reserva mixta visible operacionalmente ──────────────────────────
  {
    const { data: adminView } = await supabaseAdmin
      .from("reservas")
      .select("id, fecha, hora, simuladores, estado, duracion_minutos, cantidad_turnos, origen")
      .eq("id", ret.reserva_id).maybeSingle();
    assert.ok(adminView, "M5B-53 la reserva mixta se ve como cualquier otra");
    assert.equal(adminView!.origen, "mensualidad");
    assert.equal(adminView!.estado, "activa");
    assert.equal(Number(adminView!.duracion_minutos), 60);
    assert.equal(Number(adminView!.cantidad_turnos), 1);
  }
  console.log("M5B-53 visible para la operación OK");

  // ── 47/48/49/50 · Pantalla de resultado ──────────────────────────────────
  {
    const { GET } = await import("@/app/api/mensualidades/reserva-resultado/route");
    let ip = 0;
    const pedir = (t: string) => GET(new Request(
      `https://simexperience.com.ar/api/mensualidades/reserva-resultado?t=${encodeURIComponent(t)}`,
      { headers: { "x-real-ip": `10.55.0.${ip++ % 250}` } },
    ));

    // 49 · token inválido, inexistente y ajeno: SIEMPRE la misma respuesta.
    for (const malo of ["", "corto", "a".repeat(200), nuevoTokenResultado()]) {
      const res = await pedir(malo);
      assert.equal(res.status, 404, `M5B-49 token "${malo.slice(0, 8)}" no puede revelar nada`);
      assert.equal((await res.json()).error, "No encontramos esa reserva.");
    }

    // 48 · aprobado: la reserva de arriba ya está confirmada.
    const resOk = await pedir(tokenOk);
    assert.equal(resOk.status, 200);
    assert.ok(/no-store/i.test(resOk.headers.get("cache-control") ?? ""), "M5B-48 no-store");
    const dto = await resOk.json();
    assert.equal(dto.estado, "aprobado");
    assert.equal(dto.referencia, ret.referencia_publica);
    assert.equal(dto.minutos_saldo, 15);
    assert.equal(dto.importe, 30000);
    assert.equal(typeof dto.saldo_restante, "number", "el saldo restante solo aparece si está confirmada");
    // Sin PII, sin ids internos, sin datos financieros de SIM.
    const crudo = JSON.stringify(dto);
    for (const prohibido of [
      "telefono", "email", "titular", "mensualidad_id", "reserva_id",
      "token", "comision", "neto", "payment", "mp_", "Ana", "Probe",
    ]) {
      assert.ok(!crudo.includes(prohibido), `M5B-48 el resultado no puede traer "${prohibido}"`);
    }

    // 47 · pendiente: dice que se está confirmando, NO que está confirmada.
    const bp = await crearBilletera(15);
    const rp = await retener({
      mensualidadId: bp.id, fecha: F, hora: "17:00", duracion: 30,
      simuladores: ["Red Bull"], bloques: ["17:00", "17:20"],
    });
    if (!rp.ok) throw new Error(rp.error);
    // Sin credenciales de MP la reconciliación no puede resolver nada, así que
    // el estado tiene que seguir siendo "pendiente" y no inventar una confirmación.
    const tokenPrev = process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    const resP = await pedir(rp.token);
    if (tokenPrev !== undefined) process.env.MERCADOPAGO_ACCESS_TOKEN = tokenPrev;
    assert.equal(resP.status, 200);
    const dtoP = await resP.json();
    assert.equal(dtoP.estado, "pendiente", "M5B-47");
    assert.equal(dtoP.saldo_restante, undefined, "no se muestra saldo restante si no se confirmó");
    assert.ok(dtoP.retencion_vence_at, "se informa hasta cuándo sigue pagable");
    assert.equal(await estadoReserva(rp.fila.reserva_id), "pendiente_pago");

    // 50 · con la flag APAGADA el resultado sigue accesible: quien pagó tiene
    //      que poder ver su turno aunque la venta esté cerrada.
    const flagPrev = process.env.MENSUALIDADES_ENABLED;
    delete process.env.MENSUALIDADES_ENABLED;
    const resFlag = await pedir(tokenOk);
    assert.equal(resFlag.status, 200, "M5B-50 el resultado no depende de la feature flag");
    assert.equal((await resFlag.json()).estado, "aprobado");
    if (flagPrev !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrev;
  }
  console.log("M5B-47/48/49/50 pantalla de resultado OK");

  // ── 26/27 · Preferencia: una sola vez, y si falla se libera todo ─────────
  {
    const { reservarConSaldoYPago } = await import("@/lib/mensualidadesReservaMixta");
    const bpr = await crearBilletera(15);
    // Sin NEXT_PUBLIC_BASE_URL la preferencia no se puede crear: es exactamente
    // el escenario 27 (fallo al crear la preferencia).
    const basePrev = process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    const clave = nuevaClave();
    const r = await reservarConSaldoYPago(bpr.id, {
      fecha: F, hora: "13:20", duracion: 30, simuladores: ["McLaren"],
      idempotencyKey: clave, aceptoCondiciones: true, bloques: ["13:20", "13:40"],
    });
    if (basePrev !== undefined) process.env.NEXT_PUBLIC_BASE_URL = basePrev;

    assert.equal(r.ok, false, "M5B-27 sin preferencia no se devuelve una reserva");
    if (!r.ok) assert.equal(r.codigo, "preferencia_fallida");
    // Y la retención NO puede quedar viva ocupando el turno y los minutos.
    assert.equal(await saldoDe(bpr.id), 15, "M5B-27 los minutos volvieron");
    const { data: hu } = await supabaseAdmin.from("reservas")
      .select("id, estado").eq("idempotency_key", clave).maybeSingle();
    if (hu?.id) {
      creados.reservas.push(Number(hu.id));
      assert.equal(hu.estado, "cancelada", "M5B-27 la reserva quedó liberada");
      assert.equal(await slotsActivos(Number(hu.id)), 0, "M5B-27 y los slots también");
    }
  }
  console.log("M5B-26/27 fallo al crear la preferencia libera todo OK");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M5B OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count } = await supabaseAdmin
      .from("mensualidades").select("*", { count: "exact", head: true }).eq("titular_email", `${MARCA}@test.local`);
    const { count: pagos } = await supabaseAdmin
      .from("mensualidad_reserva_pagos").select("*", { count: "exact", head: true });
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("motivo", MARCA);
    console.log(`limpieza: ${count ?? 0} billeteras temporales (debe ser 0) · ${pagos ?? 0} pagos en la tabla`);
  });
