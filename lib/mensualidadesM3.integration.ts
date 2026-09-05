import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  procesarPagoVerificado, PREFIJO_EXT_REF, type PagoMp,
} from "@/lib/mensualidadesPago";
import {
  validarDatosCompra, tieneMensualidadBloqueada, crearCompraYPreferencia,
  getPlanesActivos, nuevoTokenPublico, nuevaExternalReference,
} from "@/lib/mensualidadesCompra";
import { CONDICIONES_VERSION } from "@/lib/mensualidadesCondiciones";

// Integración del Bloque M3 contra la DB REAL, con datos TEMPORALES que se
// ELIMINAN al final. NUNCA se hace una compra real: los pagos de Mercado Pago se
// inyectan como objetos en procesarPagoVerificado (la MISMA función que usa el
// webhook después de traer el pago con credenciales del servidor), y la creación
// de preferencia se ejercita con el access token deshabilitado.
// Ejecutar:
//   npx tsx --env-file=.env.local lib/mensualidadesM3.integration.ts

const MARCA = `zzm3_${Date.now()}`;
const creados = { compras: [] as string[], mensualidades: [] as string[] };

let seq = 0;
// Área 2966 (Río Gallegos): canónico real y fuera del área de SIM.
const nuevoTel = () => `296698${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;

type Compra = {
  id: string; external_reference: string; token_publico: string;
  plan_slug: string; plan_precio: number; plan_minutos: number;
};

async function crearPendiente(opts: {
  slug: string; minutos: number; precio: number; telefonoNorm: string;
}): Promise<Compra> {
  const external_reference = nuevaExternalReference();
  const token_publico = nuevoTokenPublico();
  const { data, error } = await supabaseAdmin
    .from("mensualidad_compras")
    .insert({
      plan_slug: opts.slug, plan_nombre: `Plan ${opts.slug}`, plan_minutos: opts.minutos,
      plan_precio: opts.precio, plan_vigencia_dias: 30,
      comprador_nombre: "Zz", comprador_apellido: "Test",
      comprador_telefono: opts.telefonoNorm, telefono_norm: opts.telefonoNorm,
      comprador_email: `${MARCA}@test.local`, importe_bruto: opts.precio,
      external_reference, token_publico,
      condiciones_version: CONDICIONES_VERSION, condiciones_aceptadas_at: new Date().toISOString(),
    })
    .select("id, external_reference, token_publico, plan_slug, plan_precio, plan_minutos")
    .single();
  if (error) throw new Error(`crearPendiente: ${error.message}`);
  creados.compras.push(data.id);
  return data as unknown as Compra;
}

// Pago de Mercado Pago sintético, con la forma real de la API.
function pagoMp(over: Partial<PagoMp> & { external_reference: string; transaction_amount: number }): PagoMp {
  const bruto = over.transaction_amount;
  const comision = Math.round(bruto * 0.0683 * 100) / 100;
  return {
    status: "approved",
    status_detail: "accredited",
    currency_id: "ARS",
    date_approved: new Date().toISOString(),
    fee_details: [{ type: "mercadopago_fee", amount: comision, fee_payer: "collector" }],
    transaction_details: { net_received_amount: Math.round((bruto - comision) * 100) / 100 },
    metadata: { producto: "mensualidad" },
    ...over,
  };
}

async function leerCompra(id: string) {
  const { data } = await supabaseAdmin
    .from("mensualidad_compras")
    .select("procesamiento, estado_pago, mp_status, mp_payment_id, tipo, saldo_resultante, importe_bruto, comision_mp, importe_neto, mensualidad_id, minutos_descartados, minutos_trasladados, plan_precio, plan_minutos, plan_nombre")
    .eq("id", id).single();
  if (data?.mensualidad_id) creados.mensualidades.push(String(data.mensualidad_id));
  return data as Record<string, unknown> | null;
}

async function saldoDe(mensualidadId: string) {
  const { data } = await supabaseAdmin
    .from("mensualidades").select("codigo, saldo_minutos, bloqueada, vence_el").eq("id", mensualidadId).single();
  return data as { codigo: string; saldo_minutos: number; bloqueada: boolean; vence_el: string };
}

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}
function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function limpiar() {
  const ids = Array.from(new Set(creados.mensualidades));
  if (creados.compras.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("compra_id", creados.compras);
    await supabaseAdmin.from("mensualidad_compras").delete().in("id", creados.compras);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_auditoria").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
}

async function main() {
  const HOY = await hoyCordoba();
  const tokenReal = process.env.MERCADOPAGO_ACCESS_TOKEN;

  // ── M3-1 · Planes activos desde la base ───────────────────────────────────
  const planes = await getPlanesActivos();
  assert.ok(planes.length >= 3, "M3-1 deberían leerse los planes activos");
  assert.deepEqual(planes.map((p) => p.orden), [...planes.map((p) => p.orden)].sort((a, b) => a - b),
    "M3-1 los planes vienen ordenados");
  assert.ok(planes.every((p) => p.activo && p.precio > 0 && p.minutos > 0), "M3-1 solo planes válidos");
  console.log("M3-1 catálogo desde DB OK");

  // ── M3-2/3 · Plan inexistente e inactivo no se venden ─────────────────────
  process.env.MERCADOPAGO_ACCESS_TOKEN = "";
  const telPlan = nuevoTel();
  const datosBase = {
    nombre: "Zz", apellido: "Test", telefono: telPlan,
    email: `${MARCA}@test.local`, plan_slug: "2h", acepto_condiciones: true,
  };
  const vFantasma = validarDatosCompra({ ...datosBase, plan_slug: "no-existe" });
  assert.ok(vFantasma.ok);
  if (vFantasma.ok) {
    const r = await crearCompraYPreferencia(vFantasma.data, "https://x.test");
    assert.equal(r.ok, false, "M3-2 un plan inexistente no debe venderse");
    if (!r.ok) assert.equal(r.status, 404);
  }
  // Se desactiva el plan 1h un momento para comprobar el guard.
  await supabaseAdmin.from("mensualidad_planes").update({ activo: false }).eq("slug", "1h");
  try {
    const vInactivo = validarDatosCompra({ ...datosBase, plan_slug: "1h" });
    assert.ok(vInactivo.ok);
    if (vInactivo.ok) {
      const r = await crearCompraYPreferencia(vInactivo.data, "https://x.test");
      assert.equal(r.ok, false, "M3-3 un plan inactivo no debe venderse");
    }
    const activos = await getPlanesActivos();
    assert.ok(!activos.some((p) => p.slug === "1h"), "M3-3 el plan inactivo no se lista");
  } finally {
    await supabaseAdmin.from("mensualidad_planes").update({ activo: true }).eq("slug", "1h");
  }
  console.log("M3-2/3 plan inexistente e inactivo OK");

  // ── M3-4/5 · Precio y minutos del cliente se ignoran ──────────────────────
  const telPrecio = nuevoTel();
  const vManipulado = validarDatosCompra({
    ...datosBase, telefono: telPrecio, plan_slug: "2h",
    precio: 1, plan_precio: 1, minutos: 99999, plan_minutos: 99999, vigencia_dias: 3650,
  });
  assert.ok(vManipulado.ok);
  if (vManipulado.ok) {
    await crearCompraYPreferencia(vManipulado.data, "https://x.test"); // falla en MP a propósito
    const { data: c } = await supabaseAdmin
      .from("mensualidad_compras").select("id, plan_precio, plan_minutos, plan_vigencia_dias")
      .eq("telefono_norm", telPrecio).maybeSingle();
    assert.ok(c, "M3-4 la compra pendiente debería existir");
    creados.compras.push(c!.id);
    assert.equal(Number(c!.plan_precio), 55000, "M3-4 el precio sale del catálogo, no del cliente");
    assert.equal(Number(c!.plan_minutos), 120, "M3-5 los minutos salen del catálogo");
    assert.equal(Number(c!.plan_vigencia_dias), 30, "M3-5 la vigencia sale del catálogo");
  }
  console.log("M3-4/5 precio y minutos del cliente ignorados OK");

  // ── M3-11/12 · Doble clic y reintento tras fallo de Mercado Pago ──────────
  const telDoble = nuevoTel();
  const vDoble = validarDatosCompra({ ...datosBase, telefono: telDoble, idempotency_key: `${MARCA}-doble` });
  assert.ok(vDoble.ok);
  if (vDoble.ok) {
    const [r1, r2] = await Promise.all([
      crearCompraYPreferencia(vDoble.data, "https://x.test"),
      crearCompraYPreferencia(vDoble.data, "https://x.test"),
    ]);
    assert.equal(r1.ok, false, "M3-12 sin token de MP la creación falla");
    assert.equal(r2.ok, false);
    const { data: comprasDoble } = await supabaseAdmin
      .from("mensualidad_compras").select("id, external_reference").eq("telefono_norm", telDoble);
    for (const c of comprasDoble ?? []) creados.compras.push(c.id);
    assert.equal(comprasDoble?.length, 1, "M3-11 el doble clic no puede crear dos compras");
    // Reintento con la MISMA key: reusa la fila, no crea otra.
    await crearCompraYPreferencia(vDoble.data, "https://x.test");
    const { data: trasReintento } = await supabaseAdmin
      .from("mensualidad_compras").select("id, external_reference").eq("telefono_norm", telDoble);
    assert.equal(trasReintento?.length, 1, "M3-12 el reintento reusa la compra pendiente");
    assert.equal(trasReintento?.[0].external_reference, comprasDoble?.[0].external_reference,
      "M3-12 el reintento conserva la misma external_reference");
  }
  console.log("M3-11/12 doble clic y reintento OK");
  process.env.MERCADOPAGO_ACCESS_TOKEN = tokenReal;

  // ── M3-13 · Snapshot estable aunque cambie el plan ───────────────────────
  const telSnap = nuevoTel();
  const cSnap = await crearPendiente({ slug: "2h", minutos: 120, precio: 55000, telefonoNorm: telSnap });
  await supabaseAdmin.from("mensualidad_planes").update({ precio: 999999, nombre: "ZZ" }).eq("slug", "2h");
  const snapDespues = await leerCompra(cSnap.id);
  assert.equal(Number(snapDespues?.plan_precio), 55000, "M3-13 el snapshot no cambia con el catálogo");
  assert.equal(Number(snapDespues?.plan_minutos), 120);
  await supabaseAdmin.from("mensualidad_planes").update({ precio: 55000, nombre: "2 horas" }).eq("slug", "2h");
  console.log("M3-13 snapshot estable OK");

  // ── M3-21 · external_reference de otro producto o inexistente ────────────
  const ajeno = await procesarPagoVerificado("pay-ajeno", pagoMp({
    external_reference: "gift_card_deadbeef", transaction_amount: 55000,
  }));
  assert.ok(ajeno.ok && ajeno.estado === "ignorado", "M3-21 un pago de otro producto se ignora");
  const inexistente = await procesarPagoVerificado("pay-inex", pagoMp({
    external_reference: `${PREFIJO_EXT_REF}noexiste`, transaction_amount: 55000,
  }));
  assert.ok(inexistente.ok && inexistente.estado === "ignorado", "M3-21 compra inexistente se ignora");
  console.log("M3-21 external_reference ajena/inexistente OK");

  // ── M3-19/20 · Moneda e importe incorrectos ──────────────────────────────
  const telMal = nuevoTel();
  const cMal = await crearPendiente({ slug: "2h", minutos: 120, precio: 55000, telefonoNorm: telMal });
  const moneda = await procesarPagoVerificado("pay-usd", pagoMp({
    external_reference: cMal.external_reference, transaction_amount: 55000, currency_id: "USD",
  }));
  assert.equal(moneda.ok, false, "M3-19 moneda distinta de ARS se rechaza");
  const importe = await procesarPagoVerificado("pay-poco", pagoMp({
    external_reference: cMal.external_reference, transaction_amount: 1,
  }));
  assert.equal(importe.ok, false, "M3-20 un importe que no coincide se rechaza");
  const metaMala = await procesarPagoVerificado("pay-meta", pagoMp({
    external_reference: cMal.external_reference, transaction_amount: 55000,
    metadata: { producto: "gift_card" },
  }));
  assert.equal(metaMala.ok, false, "M3-20 metadata de otro producto se rechaza");
  assert.equal((await leerCompra(cMal.id))?.procesamiento, "pendiente",
    "M3-19/20 ninguno de esos casos puede acreditar");
  console.log("M3-19/20 moneda, importe y metadata inválidos OK");

  // ── M3-14/15 · Pendiente y rechazado no acreditan ────────────────────────
  const telPend = nuevoTel();
  const cPend = await crearPendiente({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telPend });
  const rPend = await procesarPagoVerificado("pay-pend", pagoMp({
    external_reference: cPend.external_reference, transaction_amount: 30000,
    status: "pending", status_detail: "pending_waiting_transfer", fee_details: [],
    transaction_details: { net_received_amount: null },
  }));
  assert.ok(rPend.ok && rPend.estado === "registrado", "M3-14 pendiente se registra");
  let estadoPend = await leerCompra(cPend.id);
  assert.equal(estadoPend?.procesamiento, "pendiente", "M3-14 pendiente NO acredita");
  assert.equal(estadoPend?.mp_status, "pending");

  const rRech = await procesarPagoVerificado("pay-rech", pagoMp({
    external_reference: cPend.external_reference, transaction_amount: 30000,
    status: "rejected", status_detail: "cc_rejected_insufficient_amount",
  }));
  assert.ok(rRech.ok && rRech.estado === "registrado", "M3-15 rechazado se registra");
  estadoPend = await leerCompra(cPend.id);
  assert.equal(estadoPend?.procesamiento, "pendiente", "M3-15 rechazado NO acredita");
  assert.equal(estadoPend?.mp_status, "rejected");
  console.log("M3-14/15 pendiente y rechazado no acreditan OK");

  // ── M3-16/17 · Después llega aprobado: acredita UNA vez ──────────────────
  const rOk = await procesarPagoVerificado("pay-ok-1", pagoMp({
    external_reference: cPend.external_reference, transaction_amount: 30000,
  }));
  assert.ok(rOk.ok && rOk.estado === "aplicado", "M3-16/17 el aprobado posterior acredita");
  const aplicada = await leerCompra(cPend.id);
  assert.equal(aplicada?.procesamiento, "aplicado");
  assert.equal(aplicada?.estado_pago, "aprobado");
  assert.equal(aplicada?.tipo, "alta");
  assert.equal(aplicada?.saldo_resultante, 60);
  const mensPend = await saldoDe(String(aplicada?.mensualidad_id));
  assert.equal(mensPend.saldo_minutos, 60, "M3-17 acredita una sola vez");
  assert.equal(mensPend.vence_el, sumarDias(HOY, 30));
  console.log("M3-16/17 pendiente → aprobado acredita una vez OK");

  // ── M3-23 · Bruto, comisión y neto reales persistidos ────────────────────
  assert.equal(Number(aplicada?.importe_bruto), 30000, "M3-23 bruto real");
  const com1 = Number(aplicada?.comision_mp);
  const neto1 = Number(aplicada?.importe_neto);
  assert.ok(com1 > 0, "M3-23 la comisión se guarda");
  assert.equal(Math.round((30000 - com1) * 100) / 100, neto1, "M3-23 bruto − comisión = neto");

  // Varios cargos: se suman.
  const telFees = nuevoTel();
  const cFees = await crearPendiente({ slug: "4h", minutos: 240, precio: 100000, telefonoNorm: telFees });
  await procesarPagoVerificado("pay-fees", {
    ...pagoMp({ external_reference: cFees.external_reference, transaction_amount: 100000 }),
    fee_details: [
      { type: "mercadopago_fee", amount: 6100, fee_payer: "collector" },
      { type: "financing_fee", amount: 1500, fee_payer: "collector" },
      { type: "application_fee", amount: 400, fee_payer: "payer" },
    ],
    transaction_details: { net_received_amount: 92400 },
  });
  const conFees = await leerCompra(cFees.id);
  assert.equal(Number(conFees?.comision_mp), 7600, "M3-23 se suman los cargos del cobrador");
  assert.equal(Number(conFees?.importe_neto), 92400, "M3-23 neto informado por MP");
  console.log("M3-23 bruto/comisión/neto con uno y varios cargos OK");

  // ── M3-18 · Webhook duplicado no duplica minutos ─────────────────────────
  await procesarPagoVerificado("pay-ok-1", pagoMp({
    external_reference: cPend.external_reference, transaction_amount: 30000,
  }));
  assert.equal((await saldoDe(String(aplicada?.mensualidad_id))).saldo_minutos, 60,
    "M3-18 reprocesar el mismo pago no duplica minutos");
  console.log("M3-18 webhook duplicado OK");

  // ── M3-32 · Webhook y reconciliación al mismo tiempo ─────────────────────
  // Los dos caminos usan el MISMO procesador, así que esto reproduce la carrera
  // real: dos procesos acreditando el mismo pago a la vez.
  const telCarrera = nuevoTel();
  const cCarrera = await crearPendiente({ slug: "2h", minutos: 120, precio: 55000, telefonoNorm: telCarrera });
  const pagoCarrera = pagoMp({ external_reference: cCarrera.external_reference, transaction_amount: 55000 });
  const [x1, x2, x3] = await Promise.all([
    procesarPagoVerificado("pay-carrera", pagoCarrera),
    procesarPagoVerificado("pay-carrera", pagoCarrera),
    procesarPagoVerificado("pay-carrera", pagoCarrera),
  ]);
  for (const r of [x1, x2, x3]) assert.ok(r.ok, "M3-32 ninguna de las tres debería fallar");
  const carrera = await leerCompra(cCarrera.id);
  assert.equal(carrera?.procesamiento, "aplicado");
  assert.equal((await saldoDe(String(carrera?.mensualidad_id))).saldo_minutos, 120,
    "M3-32 tres procesamientos simultáneos acreditan una sola vez");
  const { count: movsCarrera } = await supabaseAdmin
    .from("mensualidad_movimientos").select("*", { count: "exact", head: true })
    .eq("compra_id", cCarrera.id);
  assert.equal(movsCarrera, 1, "M3-32 un solo movimiento de minutos");
  console.log("M3-32 webhook + reconciliación concurrentes OK");

  // ── M3-22 · payment_id ya usado por otra compra ──────────────────────────
  const telOtro = nuevoTel();
  const cOtro = await crearPendiente({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telOtro });
  const cruzado = await procesarPagoVerificado("pay-ok-1", pagoMp({
    external_reference: cOtro.external_reference, transaction_amount: 30000,
  }));
  assert.equal(cruzado.ok, false, "M3-22 un payment_id de otra compra se rechaza");
  if (!cruzado.ok) assert.equal(cruzado.motivo, "payment_id_de_otra_compra");
  assert.equal((await leerCompra(cOtro.id))?.procesamiento, "pendiente");
  console.log("M3-22 payment_id cruzado OK");

  // ── M3-25/26 · Renovación vigente y descarte sobre 60 ────────────────────
  await supabaseAdmin.from("mensualidades")
    .update({ saldo_minutos: 90 }).eq("id", String(aplicada?.mensualidad_id));
  const cRenov = await crearPendiente({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telPend });
  await procesarPagoVerificado("pay-renov", pagoMp({
    external_reference: cRenov.external_reference, transaction_amount: 30000,
  }));
  const renov = await leerCompra(cRenov.id);
  assert.equal(renov?.tipo, "renovacion", "M3-25 con la mensualidad vigente es renovación");
  assert.equal(renov?.minutos_trasladados, 60, "M3-26 traslada el tope");
  assert.equal(renov?.minutos_descartados, 30, "M3-26 descarta el excedente");
  assert.equal(renov?.saldo_resultante, 120);
  const mensRenov = await saldoDe(String(renov?.mensualidad_id));
  assert.equal(mensRenov.codigo, mensPend.codigo, "M3-25 la renovación conserva el código");
  console.log("M3-25/26 renovación y descarte OK");

  // ── M3-27 · Compra posterior al vencimiento: código nuevo ────────────────
  await supabaseAdmin.from("mensualidades")
    .update({ vence_el: sumarDias(HOY, -1) }).eq("id", String(aplicada?.mensualidad_id));
  const cVenc = await crearPendiente({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telPend });
  await procesarPagoVerificado("pay-venc", pagoMp({
    external_reference: cVenc.external_reference, transaction_amount: 30000,
  }));
  const venc = await leerCompra(cVenc.id);
  assert.equal(venc?.tipo, "alta", "M3-27 tras el vencimiento es alta nueva");
  const mensVenc = await saldoDe(String(venc?.mensualidad_id));
  assert.notEqual(mensVenc.codigo, mensPend.codigo, "M3-27 código nuevo");
  assert.equal(mensVenc.saldo_minutos, 60, "M3-27 no recupera saldo vencido");
  console.log("M3-27 compra tras vencimiento OK");

  // ── M3-10/28 · Bloqueo administrativo ────────────────────────────────────
  await supabaseAdmin.from("mensualidades")
    .update({ bloqueada: true, bloqueo_motivo: "test" }).eq("id", String(venc?.mensualidad_id));
  assert.equal(await tieneMensualidadBloqueada(telPend), true, "M3-10 detecta la mensualidad bloqueada");
  process.env.MERCADOPAGO_ACCESS_TOKEN = "";
  const vBloq = validarDatosCompra({ ...datosBase, telefono: telPend });
  assert.ok(vBloq.ok);
  // El endpoint corta antes de crear nada; acá se comprueba el guard directamente.
  const { count: antes } = await supabaseAdmin
    .from("mensualidad_compras").select("*", { count: "exact", head: true }).eq("telefono_norm", telPend);
  assert.equal(await tieneMensualidadBloqueada(telPend), true);
  const { count: despues } = await supabaseAdmin
    .from("mensualidad_compras").select("*", { count: "exact", head: true }).eq("telefono_norm", telPend);
  assert.equal(antes, despues, "M3-10 comprobar el bloqueo no crea compras");
  process.env.MERCADOPAGO_ACCESS_TOKEN = tokenReal;

  // Pago aprobado de una compra iniciada ANTES del bloqueo: acredita y conserva el bloqueo.
  const cAntesBloqueo = await crearPendiente({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telPend });
  await procesarPagoVerificado("pay-bloq", pagoMp({
    external_reference: cAntesBloqueo.external_reference, transaction_amount: 30000,
  }));
  const trasBloqueo = await leerCompra(cAntesBloqueo.id);
  assert.equal(trasBloqueo?.procesamiento, "aplicado", "M3-28 el pago aprobado se acredita igual");
  const mensBloq = await saldoDe(String(trasBloqueo?.mensualidad_id));
  assert.equal(mensBloq.bloqueada, true, "M3-28 la renovación NO levanta el bloqueo");
  assert.equal(mensBloq.saldo_minutos, 120, "M3-28 el dinero no se pierde: 60 + 60");
  console.log("M3-10/28 bloqueo administrativo OK");

  // ── M3-29/30/31/33 · Endpoint de resultado ───────────────────────────────
  const { GET } = await import("@/app/api/mensualidades/resultado/route");
  const pedir = async (t: string) =>
    GET(new Request(`https://simexperience.com.ar/api/mensualidades/resultado?t=${encodeURIComponent(t)}`));

  // Token inválido / inexistente → misma respuesta neutra, sin enumerar.
  for (const malo of ["", "corto", "x".repeat(80), nuevoTokenPublico()]) {
    const res = await pedir(malo);
    assert.equal(res.status, 404, `M3-31 token "${malo.slice(0, 8)}" debería dar 404`);
    const j = await res.json();
    assert.equal(j.error, "No encontramos esa compra.", "M3-31 respuesta neutra");
  }

  // Pendiente: sin código. Se usa una compra sin preferencia para no reconciliar.
  const telRes = nuevoTel();
  const cRes = await crearPendiente({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telRes });
  const resPend = await pedir(cRes.token_publico);
  assert.equal(resPend.status, 200);
  const jPend = await resPend.json();
  assert.equal(jPend.estado, "pendiente", "M3-29 sin aplicar, el estado es pendiente");
  assert.equal(jPend.codigo, undefined, "M3-29 pendiente NO muestra código");
  assert.equal(jPend.saldo_minutos, undefined);

  // Aprobado: muestra el código correcto.
  const resOk = await pedir(cVenc.token_publico);
  const jOk = await resOk.json();
  assert.equal(jOk.estado, "aprobado", "M3-30 aplicada → aprobado");
  assert.equal(jOk.codigo, mensVenc.codigo, "M3-30 muestra el código correcto");
  assert.equal(jOk.tipo, "alta");
  assert.ok(typeof jOk.saldo_minutos === "number");
  assert.ok(jOk.vence_el, "M3-30 informa el vencimiento");
  // Sin datos internos.
  for (const prohibido of ["id", "mensualidad_id", "external_reference", "telefono_norm", "comprador_email", "mp_payment_id"]) {
    assert.equal(prohibido in jOk, false, `M3-30 la respuesta no debe exponer ${prohibido}`);
  }

  // Con la venta apagada, el resultado sigue disponible.
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;
  delete process.env.MENSUALIDADES_ENABLED;
  const resFlagOff = await pedir(cVenc.token_publico);
  assert.equal(resFlagOff.status, 200, "M3-33 el resultado no depende de la feature flag");
  assert.equal((await resFlagOff.json()).codigo, mensVenc.codigo);
  console.log("M3-29/30/31/33 pantalla de resultado OK");

  // ── M3-1b · La flag apagada impide comprar ───────────────────────────────
  const { POST } = await import("@/app/api/mensualidades/preference/route");
  const pedirCompra = async () =>
    POST(new Request("https://simexperience.com.ar/api/mensualidades/preference", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://simexperience.com.ar" },
      body: JSON.stringify({ ...datosBase, telefono: nuevoTel() }),
    }));
  const resApagada = await pedirCompra();
  assert.equal(resApagada.status, 404, "M3-1 con la flag apagada no se puede comprar");
  const jApagada = await resApagada.json();
  assert.equal(jApagada.error, "No encontrado", "M3-1 sin revelar que la función existe");
  assert.equal("planes" in jApagada, false, "M3-1 no se filtran planes");
  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  console.log("M3-1 flag apagada impide comprar OK");

  // ── M3-34 · anon sigue sin acceso a las tablas ───────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(url && anonKey, "M3-34 faltan credenciales anon en .env.local");
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  for (const tabla of ["mensualidades", "mensualidad_compras", "mensualidad_planes"]) {
    const { data, error } = await anon.from(tabla).select("*").limit(1);
    assert.ok(error || (data ?? []).length === 0, `M3-34 anon pudo leer ${tabla}`);
  }
  const { data: porToken } = await anon
    .from("mensualidad_compras").select("*").eq("token_publico", cVenc.token_publico);
  assert.ok((porToken ?? []).length === 0, "M3-34 anon no puede leer compras ni con un token válido");
  console.log("M3-34 anon sin acceso OK");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M3 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count } = await supabaseAdmin
      .from("mensualidad_compras").select("*", { count: "exact", head: true })
      .like("comprador_email", `${MARCA}%`);
    console.log(`limpieza: ${count ?? 0} compras temporales restantes (debe ser 0)`);
  });
