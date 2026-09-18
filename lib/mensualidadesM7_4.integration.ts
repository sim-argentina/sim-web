import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sumarDias } from "@/lib/agenda";
import {
  previsualizarAlta, registrarAltaAdministrativa, validarAlta,
  type AltaRegistrada, type DatosAlta, type ResultadoAlta,
} from "@/lib/mensualidadesAdminAlta";
import { getDetalleMensualidad, listarMensualidades } from "@/lib/mensualidadesAdmin";
import { getAuditoria } from "@/lib/mensualidadesAdminAcciones";

// Integración del Bloque M7.4 contra la DB REAL, con datos TEMPORALES marcados
// y eliminados al final.
//
// Lo que se prueba es lo que un alta administrativa no puede equivocar:
//   · que use las MISMAS reglas que la compra pública (carry-over con tope de
//     una hora, conservación del código, vencimiento) porque comparte la RPC;
//   · que una venta genere ingreso UNA vez y una cortesía no genere ninguno;
//   · que nada monetario ni identitario se acepte del navegador;
//   · que un doble clic o dos peticiones concurrentes dejen una sola operación;
//   · que una billetera bloqueada no se reactive sola;
//   · que staff no pueda escribir por ningún camino.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM7_4.integration.ts

const MARCA = `ZZ M7.4 ${Date.now()}`;
const EMAIL = `m74-${Date.now()}@test.local`;
const billeteras = new Set<string>();
const compras = new Set<string>();

let seq = 0;
const nuevoTel = () => `2966${String(200000 + (Date.now() % 700000) + seq++ * 7).slice(-6)}`;
let k = 0;
const clave = () => `zzm74${String(Date.now()).slice(-8)}${String(k++).padStart(6, "0")}`;

const CTX = (rol: "admin" | "staff" = "admin") => ({ actor: rol, rol, idempotencyKey: clave() });

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

/** Cuerpo válido de alta. Cada caso cambia solo lo que quiere probar. */
function cuerpo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nombre: "Probe",
    apellido: MARCA,
    telefono: nuevoTel(),
    email: EMAIL,
    plan_slug: "2h",
    modalidad: "venta",
    medio_pago: "efectivo",
    motivo: "Alta de prueba M7.4",
    declaracion: true,
    ...over,
  };
}

/** Valida y registra en un paso, registrando lo creado para la limpieza. */
async function alta(
  over: Record<string, unknown> = {},
  ctx = CTX(),
): Promise<ResultadoAlta<AltaRegistrada>> {
  const v = validarAlta(cuerpo(over));
  if (!v.ok) return v;
  const r = await registrarAltaAdministrativa(v.data as DatosAlta, ctx);
  if (r.ok) { billeteras.add(r.data.mensualidad_id); compras.add(r.data.compra_id); }
  return r;
}

const filaDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidades")
    .select("codigo, saldo_minutos, vence_el, bloqueada, titular_nombre, titular_email, telefono_norm")
    .eq("id", id).single();
  return data!;
};

type FilaCompra = {
  canal: string; medio_pago: string | null; procesador: string | null;
  cortesia_tipo: string | null; importe_bruto: number | null; comision_mp: number | null;
  importe_neto: number | null; mp_payment_id: string | null; external_reference: string | null;
  estado_pago: string; procesamiento: string; tipo: string | null; plan_precio: number;
  plan_minutos: number; cobrado_at: string | null; motivo_admin: string | null;
  registrado_por: string | null; saldo_resultante: number | null;
};

const COLS_COMPRA =
  "canal, medio_pago, procesador, cortesia_tipo, importe_bruto, comision_mp, importe_neto, " +
  "mp_payment_id, external_reference, estado_pago, procesamiento, tipo, plan_precio, " +
  "plan_minutos, cobrado_at, motivo_admin, registrado_por, saldo_resultante";

const compraDe = async (id: string): Promise<FilaCompra> => {
  const { data, error } = await supabaseAdmin.from("mensualidad_compras")
    .select(COLS_COMPRA).eq("id", id).single();
  if (error) throw new Error(`compraDe: ${error.message}`);
  return data as unknown as FilaCompra;
};

const movimientosDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidad_movimientos")
    .select("tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key")
    .eq("mensualidad_id", id).order("created_at", { ascending: true });
  return data ?? [];
};

const auditoriaDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidad_auditoria")
    .select("accion, actor, actor_rol, motivo, valor_anterior, valor_nuevo, idempotency_key")
    .eq("mensualidad_id", id).order("created_at", { ascending: true });
  return data ?? [];
};

const contarCompras = async (mensualidadId: string) => {
  const { count } = await supabaseAdmin.from("mensualidad_compras")
    .select("*", { count: "exact", head: true }).eq("mensualidad_id", mensualidadId);
  return count ?? 0;
};

async function limpiar() {
  const ids = [...billeteras];
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_auditoria").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_compras").delete().in("mensualidad_id", ids);
  }
  if (compras.size) await supabaseAdmin.from("mensualidad_compras").delete().in("id", [...compras]);
  await supabaseAdmin.from("mensualidad_compras").delete().eq("comprador_email", EMAIL);
  if (ids.length) await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
}

async function main() {
  const hoy = await hoyCordoba();

  const contarTodo = async () => ({
    mensualidades: (await supabaseAdmin.from("mensualidades").select("*", { count: "exact", head: true })).count ?? 0,
    compras: (await supabaseAdmin.from("mensualidad_compras").select("*", { count: "exact", head: true })).count ?? 0,
    movimientos: (await supabaseAdmin.from("mensualidad_movimientos").select("*", { count: "exact", head: true })).count ?? 0,
    auditoria: (await supabaseAdmin.from("mensualidad_auditoria").select("*", { count: "exact", head: true })).count ?? 0,
    planes: (await supabaseAdmin.from("mensualidad_planes").select("*", { count: "exact", head: true })).count ?? 0,
    pagos_web: (await supabaseAdmin.from("fin_pagos_web").select("*", { count: "exact", head: true })).count ?? 0,
    reservas: (await supabaseAdmin.from("reservas").select("*", { count: "exact", head: true })).count ?? 0,
  });
  const antes = await contarTodo();
  console.log("contadores antes:", JSON.stringify(antes));

  // ── 1..5 · ALTA NUEVA, una venta de cada plan ─────────────────────────────
  {
    const { data: planes } = await supabaseAdmin.from("mensualidad_planes")
      .select("slug, minutos, precio").eq("activo", true).order("orden");
    assert.equal(planes?.length, 3, "1 los tres planes están activos");

    for (const p of planes!) {
      const r = await alta({ plan_slug: p.slug, medio_pago: "efectivo" });
      assert.ok(r.ok, `1 alta del plan ${p.slug}: ${r.ok ? "" : r.error}`);
      const m = await filaDe(r.data.mensualidad_id);
      const c = await compraDe(r.data.compra_id);

      // 2) minutos y vencimiento correctos
      assert.equal(r.data.tipo, "alta", "2 sin billetera previa es alta");
      assert.equal(Number(m.saldo_minutos), Number(p.minutos), "2 el saldo es el del plan");
      assert.equal(m.vence_el, sumarDias(hoy, 30), "2 vence a los 30 días corridos");
      assert.equal(r.data.saldo_anterior, 0, "2 no había saldo previo");

      // 3) una sola compra, un solo movimiento, una sola auditoría
      assert.equal(await contarCompras(r.data.mensualidad_id), 1, "3 exactamente una compra");
      const mov = await movimientosDe(r.data.mensualidad_id);
      assert.equal(mov.length, 1, "3 exactamente un movimiento");
      assert.equal(mov[0].tipo, "compra", "3 el movimiento es de compra");
      assert.match(String(mov[0].motivo), /venta administrativa/, "3 el canal queda en el libro mayor");
      const aud = await auditoriaDe(r.data.mensualidad_id);
      assert.equal(aud.length, 1, "3 exactamente una auditoría");
      assert.equal(aud[0].accion, "alta_administrativa");

      // 4) el código lo genera el servidor
      assert.match(String(m.codigo), /^MEN-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
        "4 el código tiene la forma del producto");
      assert.equal(r.data.codigo, m.codigo, "4 el código devuelto es el real");

      // 5) el precio sale del plan vigente, no del cuerpo
      assert.equal(Number(c.plan_precio), Number(p.precio), "5 el precio es el del plan");
      assert.equal(Number(c.importe_bruto), Number(p.precio), "5 el bruto es el precio vigente");
      assert.equal(c.canal, "admin_venta");
      assert.equal(c.procesamiento, "aplicado");
      assert.equal(c.estado_pago, "aprobado");
      assert.equal(c.mp_payment_id, null, "5 una venta administrativa NO tiene payment_id");
      assert.ok(String(c.external_reference).startsWith("admin_"),
        "5 la referencia no puede confundirse con una de Mercado Pago");
    }
  }
  console.log("M7.4-1..5 alta nueva: planes, minutos, vencimiento, código y precio OK");

  // ── 6..10 · RENOVACIÓN ────────────────────────────────────────────────────
  {
    // 6/7/8 · Antes del vencimiento: conserva código, traslada hasta 60 min.
    const tel = nuevoTel();
    const a = await alta({ telefono: tel, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(a.ok, "6 alta base");
    // Saldo alto a propósito para ejercitar el tope del traslado.
    await supabaseAdmin.from("mensualidades").update({ saldo_minutos: 195 }).eq("id", a.data.mensualidad_id);

    const b = await alta({ telefono: tel, plan_slug: "2h", medio_pago: "efectivo" });
    assert.ok(b.ok, `7 renovación: ${b.ok ? "" : b.error}`);
    assert.equal(b.data.tipo, "renovacion", "6 con billetera vigente es renovación");
    assert.equal(b.data.mensualidad_id, a.data.mensualidad_id, "6 es la MISMA billetera");
    assert.equal(b.data.codigo, a.data.codigo, "6 conserva el código");
    assert.equal(b.data.codigo_conservado, true);

    // 7) tope de una hora: de 195 se trasladan 60 y se descartan 135.
    assert.equal(b.data.saldo_anterior, 195, "7 el saldo anterior es el real");
    assert.equal(b.data.saldo_posterior, 60 + 120, "7 traslada 60 y suma el plan completo");
    const mov = await movimientosDe(a.data.mensualidad_id);
    const desc = mov.filter((m) => m.tipo === "descarte");
    assert.equal(desc.length, 1, "7 el excedente queda registrado, no se pierde en silencio");
    assert.equal(Number(desc[0].minutos), -135, "7 se descartan 135 minutos");

    // 8) saldo y vencimiento actualizados
    const m2 = await filaDe(a.data.mensualidad_id);
    assert.equal(Number(m2.saldo_minutos), 180, "8 el saldo quedó aplicado");
    assert.equal(m2.vence_el, sumarDias(hoy, 30), "8 la vigencia arranca de cero");
    assert.equal(await contarCompras(a.data.mensualidad_id), 2, "8 dos compras, una billetera");

    // 9/10 · Después del vencimiento: no recupera saldo y sigue la regla pública.
    const telV = nuevoTel();
    const c = await alta({ telefono: telV, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(c.ok, "9 alta que después se vence");
    await supabaseAdmin.from("mensualidades")
      .update({ vence_el: sumarDias(hoy, -1), saldo_minutos: 300 })
      .eq("id", c.data.mensualidad_id);

    const d = await alta({ telefono: telV, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(d.ok, `9 compra con la anterior vencida: ${d.ok ? "" : d.error}`);
    assert.equal(d.data.tipo, "alta", "9 vencida ⇒ vigencia nueva, no renovación");
    assert.notEqual(d.data.mensualidad_id, c.data.mensualidad_id, "9 es una billetera nueva");
    assert.equal(d.data.saldo_posterior, 60, "9 NO recupera el saldo vencido");
    assert.notEqual(d.data.codigo, c.data.codigo, "10 código nuevo, igual que en el flujo público");
    billeteras.add(d.data.mensualidad_id);

    const vieja = await filaDe(c.data.mensualidad_id);
    assert.equal(Number(vieja.saldo_minutos), 300, "9 la billetera vencida queda intacta como historia");
  }
  console.log("M7.4-6..10 renovación: código, carry-over con tope y vencida sin recuperar OK");

  // ── 11..15 · CORTESÍA ─────────────────────────────────────────────────────
  {
    // 11) crea correctamente
    const telC = nuevoTel();
    const r = await alta({
      telefono: telC, plan_slug: "1h", modalidad: "cortesia",
      medio_pago: undefined, cortesia_tipo: "cortesia_comercial",
      motivo: "Compensación por corte de luz",
    });
    assert.ok(r.ok, `11 cortesía: ${r.ok ? "" : r.error}`);
    const m = await filaDe(r.data.mensualidad_id);
    assert.equal(Number(m.saldo_minutos), 60, "11 la cortesía acredita los minutos del plan");
    assert.equal(m.vence_el, sumarDias(hoy, 30), "11 y tiene la misma vigencia");

    // 14) sin ingreso, sin comisión, sin pago
    const c = await compraDe(r.data.compra_id);
    assert.equal(c.canal, "admin_cortesia", "15 se distingue por CANAL, no por precio");
    assert.equal(Number(c.importe_bruto), 0, "14 sin cobro no hay bruto");
    assert.equal(c.comision_mp, null, "14 sin cobro no hay comisión");
    assert.equal(c.importe_neto, null, "14 sin cobro no hay neto");
    assert.equal(c.medio_pago, null, "14 una cortesía no lleva medio de pago");
    assert.equal(c.procesador, null);
    assert.equal(c.mp_payment_id, null, "14 no se fabrica ningún pago");
    assert.equal(c.cobrado_at, null, "14 no hay fecha de cobro");
    assert.equal(c.cortesia_tipo, "cortesia_comercial");
    assert.equal(Number(c.plan_precio), 30000, "14 el precio del plan queda documentado igual");

    // 15) se distingue en auditoría y en el libro mayor
    const aud = await auditoriaDe(r.data.mensualidad_id);
    assert.equal(aud[0].actor_rol, "admin");
    assert.equal((aud[0].valor_nuevo as Record<string, unknown>).modalidad, "cortesia");
    assert.equal((aud[0].valor_nuevo as Record<string, unknown>).canal, "admin_cortesia");
    const mov = await movimientosDe(r.data.mensualidad_id);
    assert.match(String(mov[0].motivo), /cortes[ií]a sin cobro/i, "15 el libro mayor lo dice");

    // 12) exige motivo · 13) recorta espacios
    const sinMotivo = validarAlta(cuerpo({
      modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: "compensacion", motivo: "",
    }));
    assert.ok(!sinMotivo.ok && sinMotivo.codigo === "motivo_requerido", "12 sin motivo se rechaza");
    const soloEspacios = validarAlta(cuerpo({
      modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: "compensacion", motivo: "     ",
    }));
    assert.ok(!soloEspacios.ok && soloEspacios.codigo === "motivo_requerido",
      "13 un motivo de solo espacios es un motivo vacío");
    const conEspacios = validarAlta(cuerpo({
      modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: "compensacion",
      motivo: "   Cortesía por demora   ",
    }));
    assert.ok(conEspacios.ok && conEspacios.data.motivo === "Cortesía por demora",
      "13 el motivo se recorta");
    assert.equal(String(c.motivo_admin), "Compensación por corte de luz", "12 el motivo queda guardado");

    // Una cortesía tampoco acepta tipo inválido ni medio de pago.
    const tipoMalo = validarAlta(cuerpo({
      modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: "lo_que_sea",
    }));
    assert.ok(!tipoMalo.ok && tipoMalo.codigo === "cortesia_tipo_invalido", "12 tipo fuera de la lista cerrada");
  }
  console.log("M7.4-11..15 cortesía: crea, exige motivo, recorta y no genera ingreso OK");

  // ── 16..21 · SEGURIDAD ────────────────────────────────────────────────────
  {
    // 17) staff no puede escribir: ni por el módulo…
    const vStaff = validarAlta(cuerpo({ telefono: nuevoTel() }));
    assert.ok(vStaff.ok);
    const rStaff = await registrarAltaAdministrativa(vStaff.data as DatosAlta, CTX("staff"));
    assert.ok(!rStaff.ok && rStaff.status === 403, "17 staff recibe 403 en la capa de servidor");

    // …ni saltando el módulo y llamando la RPC directamente.
    const { error: errRpc } = await supabaseAdmin.rpc("mensualidad_admin_alta", {
      p_plan_slug: "1h", p_nombre: "Probe", p_apellido: MARCA, p_telefono: nuevoTel(),
      p_email: EMAIL, p_modalidad: "venta", p_medio_pago: "efectivo", p_cortesia_tipo: null,
      p_motivo: "intento de staff", p_actor: "staff", p_actor_rol: "staff",
      p_idempotency_key: clave(), p_declaracion: true, p_cobrado_el: null,
    });
    assert.ok(errRpc && String(errRpc.message).includes("rol_no_autorizado"),
      "17 la base también rechaza a staff");

    // 19) nada sensible se acepta del cuerpo
    const telM = nuevoTel();
    const manipulado = validarAlta(cuerpo({
      telefono: telM, plan_slug: "1h", medio_pago: "efectivo",
      // Todo esto se manda a propósito y NO debe cambiar nada:
      precio: 1, importe_bruto: 1, plan_precio: 1, minutos: 99999, plan_minutos: 99999,
      saldo_minutos: 99999, vence_el: "2099-12-31", vencimiento: "2099-12-31",
      codigo: "MEN-AAAA-AAAA", canal: "web", actor: "superadmin", actor_rol: "admin",
      rol: "admin", estado_pago: "aprobado", mp_payment_id: "123456789",
      payment_id: "123456789", procesamiento: "aplicado", comision_mp: 0,
    }));
    assert.ok(manipulado.ok, "19 el cuerpo manipulado igual valida: los extras se ignoran");
    const rm = await registrarAltaAdministrativa(manipulado.data as DatosAlta, CTX("admin"));
    assert.ok(rm.ok, `19 ${rm.ok ? "" : rm.error}`);
    billeteras.add(rm.data.mensualidad_id); compras.add(rm.data.compra_id);

    const cm = await compraDe(rm.data.compra_id);
    const mm = await filaDe(rm.data.mensualidad_id);
    assert.equal(Number(cm.plan_precio), 30000, "19 el precio sigue siendo el del plan");
    assert.equal(Number(cm.importe_bruto), 30000, "19 el bruto no lo elige el navegador");
    assert.equal(Number(cm.plan_minutos), 60, "19 los minutos salen del plan");
    assert.equal(Number(mm.saldo_minutos), 60, "19 el saldo no lo elige el navegador");
    assert.equal(mm.vence_el, sumarDias(hoy, 30), "19 el vencimiento lo calcula la base");
    assert.notEqual(mm.codigo, "MEN-AAAA-AAAA", "19 el código no lo elige el navegador");
    assert.equal(cm.canal, "admin_venta", "19 el canal no lo elige el navegador");

    // 20) no puede fabricarse un payment_id
    assert.equal(cm.mp_payment_id, null, "20 no hay payment_id inventado");
    // Y la constraint lo garantiza aunque alguien escriba directo en la tabla.
    const { error: errPay } = await supabaseAdmin.from("mensualidad_compras")
      .update({ mp_payment_id: "999999999", canal: "web" }).eq("id", rm.data.compra_id);
    assert.ok(errPay, "20 una compra administrativa no puede convertirse en web a mano");

    // Un pago de Mercado Pago tampoco puede pegarse a una compra administrativa.
    // La compra ya está aplicada, así que la RPC devuelve la fila tal cual —esa
    // es su salida idempotente— y lo importante es que NO le adosa el pago.
    const { error: errAplicar } = await supabaseAdmin.rpc("mensualidad_aplicar_compra", {
      p_external_reference: cm.external_reference, p_mp_payment_id: "888888888",
      p_importe_bruto: 30000, p_comision_mp: 0, p_importe_neto: 30000,
    });
    assert.equal(errAplicar, null, "20 sobre una compra ya aplicada la salida es estable");
    assert.equal((await compraDe(rm.data.compra_id)).mp_payment_id, null,
      "20 y el payment_id inventado NO se adosa a una compra administrativa");

    // Una compra administrativa PENDIENTE tampoco se puede acreditar: la RPC la
    // rechaza por canal antes de tocar nada.
    const { data: pend } = await supabaseAdmin.from("mensualidad_compras").insert({
      plan_id: null, plan_slug: "1h", plan_nombre: "1 hora", plan_minutos: 60,
      plan_precio: 30000, plan_vigencia_dias: 30,
      comprador_nombre: "Probe", comprador_apellido: MARCA, comprador_telefono: nuevoTel(),
      telefono_norm: nuevoTel(), comprador_email: EMAIL, importe_bruto: 0,
      external_reference: `admin_pendiente_${Date.now()}`,
      canal: "admin_cortesia", cortesia_tipo: "compensacion",
    }).select("id, external_reference").single();
    compras.add(String(pend!.id));
    const { error: errCanal } = await supabaseAdmin.rpc("mensualidad_aplicar_compra", {
      p_external_reference: pend!.external_reference, p_mp_payment_id: "777777777",
      p_importe_bruto: 30000, p_comision_mp: 0, p_importe_neto: 30000,
    });
    assert.ok(errCanal && String(errCanal.message).includes("compra_no_web"),
      "20 una compra administrativa pendiente se rechaza por canal");

    // 21) no se registra una aceptación web falsa
    const { data: condiciones } = await supabaseAdmin.from("mensualidad_compras")
      .select("condiciones_version, condiciones_aceptadas_at").eq("id", rm.data.compra_id).single();
    assert.equal(condiciones!.condiciones_version, null,
      "21 el alta administrativa NO falsea la aceptación del cliente");
    assert.equal(condiciones!.condiciones_aceptadas_at, null, "21 ni su fecha");
    const audM = await auditoriaDe(rm.data.mensualidad_id);
    assert.equal((audM[0].valor_nuevo as Record<string, unknown>).declaracion_condiciones, true,
      "21 lo que se registra es la declaración ADMINISTRATIVA, que es otra cosa");

    // La declaración es obligatoria.
    const sinDecl = validarAlta(cuerpo({ declaracion: false }));
    assert.ok(!sinDecl.ok && sinDecl.codigo === "declaracion_requerida", "21 sin declaración no se completa");
    const declMentira = validarAlta(cuerpo({ declaracion: "true" }));
    assert.ok(!declMentira.ok, "21 la declaración tiene que ser true explícito, no una cadena");

    // 16/18) sin sesión y visibilidad: el guard de las rutas es requireAdmin.
    // El comportamiento 401/403 sobre HTTP lo cubre mensualidadesM7Auth.test.ts
    // y el smoke de producción; acá se comprueba que anon no llegue a la RPC.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    for (const fn of ["mensualidad_admin_alta", "mensualidad_aplicar_compra_interna", "mensualidad_resumen_altas_mes"]) {
      const { error } = await anon.rpc(fn as never, {} as never);
      assert.ok(error, `16 anon no puede ejecutar ${fn}`);
    }
  }
  console.log("M7.4-16..21 seguridad: staff, manipulación, payment_id y aceptación web OK");

  // ── 22..25 · ESTADOS EXISTENTES ───────────────────────────────────────────
  {
    // 22) titular vigente → renovación, no duplicado (ya probado en 6; acá se
    //     comprueba que NO aparezca una segunda billetera).
    const telR = nuevoTel();
    const p1 = await alta({ telefono: telR, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(p1.ok);
    const p2 = await alta({ telefono: telR, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(p2.ok);
    const { count: cuantas } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("telefono_norm", telR);
    assert.equal(cuantas, 1, "22 un titular vigente no genera una segunda billetera");

    // 24) titular bloqueado → NO se reactiva en silencio
    const telB = nuevoTel();
    const pb = await alta({ telefono: telB, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(pb.ok);
    await supabaseAdmin.from("mensualidades")
      .update({ bloqueada: true, bloqueo_motivo: "prueba M7.4" }).eq("id", pb.data.mensualidad_id);

    const comprasAntes = await contarCompras(pb.data.mensualidad_id);
    const rb = await alta({ telefono: telB, plan_slug: "2h", medio_pago: "efectivo" });
    assert.ok(!rb.ok, "24 no se puede renovar una billetera bloqueada");
    assert.equal(rb.codigo, "mensualidad_bloqueada");
    assert.equal(rb.status, 409);
    const mb = await filaDe(pb.data.mensualidad_id);
    assert.equal(mb.bloqueada, true, "24 sigue bloqueada");
    assert.equal(Number(mb.saldo_minutos), 60, "24 y sin saldo agregado");
    assert.equal(await contarCompras(pb.data.mensualidad_id), comprasAntes,
      "25 sin escrituras parciales: no quedó una compra huérfana");

    // La vista previa lo ANUNCIA antes de confirmar.
    const previa = await previsualizarAlta(telB, "2h", "venta");
    assert.ok(previa.ok, "24 la previa se puede calcular igual");
    assert.equal(previa.data.bloqueada, true, "24 la previa avisa que está bloqueada");
    assert.equal(previa.data.situacion.tipo, "existente");

    // 23) titular vencido → vigencia nueva sin saldo vencido (ya probado en 9).
    // 25) conflicto de identidad: teléfono no interpretable, sin escrituras.
    const comprasGlobalAntes = (await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true })).count ?? 0;
    const telMalo = validarAlta(cuerpo({ telefono: "123" }));
    assert.ok(!telMalo.ok && telMalo.codigo === "telefono_invalido", "25 teléfono inválido se rechaza");
    const emailMalo = validarAlta(cuerpo({ email: "no-es-un-mail" }));
    assert.ok(!emailMalo.ok && emailMalo.codigo === "email_invalido", "25 correo inválido se rechaza");
    const planMalo = await alta({ plan_slug: "9h" });
    assert.ok(!planMalo.ok && planMalo.codigo === "plan_inexistente", "25 plan inexistente se rechaza");
    const comprasGlobalDespues = (await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true })).count ?? 0;
    assert.equal(comprasGlobalDespues, comprasGlobalAntes, "25 ningún rechazo dejó una compra escrita");
  }
  console.log("M7.4-22..25 estados: vigente, vencido, bloqueado y conflicto OK");

  // ── 26..30 · IDEMPOTENCIA Y CONCURRENCIA ──────────────────────────────────
  {
    // 26/27) doble envío con la MISMA clave → una sola operación
    const telI = nuevoTel();
    const ctx = CTX("admin");
    const v = validarAlta(cuerpo({ telefono: telI, plan_slug: "1h", medio_pago: "efectivo" }));
    assert.ok(v.ok);
    const r1 = await registrarAltaAdministrativa(v.data as DatosAlta, ctx);
    assert.ok(r1.ok, `26 ${r1.ok ? "" : r1.error}`);
    billeteras.add(r1.data.mensualidad_id); compras.add(r1.data.compra_id);
    assert.equal(r1.data.idempotente, false, "26 la primera es real");

    const r2 = await registrarAltaAdministrativa(v.data as DatosAlta, ctx);
    assert.ok(r2.ok, "27 el reintento no falla");
    assert.equal(r2.data.idempotente, true, "27 el reintento se reconoce");
    assert.equal(r2.data.compra_id, r1.data.compra_id, "27 misma compra");
    assert.equal(r2.data.mensualidad_id, r1.data.mensualidad_id, "27 misma billetera");
    assert.equal(r2.data.saldo_posterior, r1.data.saldo_posterior, "27 mismo resultado");
    assert.equal(await contarCompras(r1.data.mensualidad_id), 1, "26 una sola compra");
    assert.equal((await movimientosDe(r1.data.mensualidad_id)).length, 1, "26 un solo movimiento");
    assert.equal((await auditoriaDe(r1.data.mensualidad_id)).length, 1, "26 una sola auditoría");
    assert.equal(Number((await filaDe(r1.data.mensualidad_id)).saldo_minutos), 60,
      "26 el saldo se acreditó una vez");

    // 28) dos peticiones CONCURRENTES con la misma clave
    const telCC = nuevoTel();
    const ctxCC = CTX("admin");
    const vcc = validarAlta(cuerpo({ telefono: telCC, plan_slug: "2h", medio_pago: "qr" }));
    assert.ok(vcc.ok);
    const [c1, c2] = await Promise.all([
      registrarAltaAdministrativa(vcc.data as DatosAlta, ctxCC),
      registrarAltaAdministrativa(vcc.data as DatosAlta, ctxCC),
    ]);
    const okCC = [c1, c2].filter((x) => x.ok) as Array<{ ok: true; data: AltaRegistrada }>;
    assert.ok(okCC.length >= 1, "28 al menos una concurrente completa");
    const idCC = okCC[0].data.mensualidad_id;
    billeteras.add(idCC); compras.add(okCC[0].data.compra_id);
    assert.equal(await contarCompras(idCC), 1, "28 una sola compra");
    assert.equal((await movimientosDe(idCC)).length, 1, "28 un solo movimiento");
    assert.equal(Number((await filaDe(idCC)).saldo_minutos), 120, "28 el saldo se acreditó una vez");
    const { count: billeterasCC } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("telefono_norm", telCC);
    assert.equal(billeterasCC, 1, "28 no quedaron dos billeteras para el mismo titular");

    // 30) una cortesía repetida sigue sin generar ingreso
    const telCo = nuevoTel();
    const ctxCo = CTX("admin");
    const vco = validarAlta(cuerpo({
      telefono: telCo, plan_slug: "1h", modalidad: "cortesia",
      medio_pago: undefined, cortesia_tipo: "compensacion", motivo: "Repetida",
    }));
    assert.ok(vco.ok);
    const co1 = await registrarAltaAdministrativa(vco.data as DatosAlta, ctxCo);
    const co2 = await registrarAltaAdministrativa(vco.data as DatosAlta, ctxCo);
    assert.ok(co1.ok && co2.ok);
    billeteras.add(co1.data.mensualidad_id); compras.add(co1.data.compra_id);
    assert.equal(co2.data.idempotente, true, "30 la cortesía repetida es idempotente");
    const { data: brutos } = await supabaseAdmin.from("mensualidad_compras")
      .select("importe_bruto, canal").eq("mensualidad_id", co1.data.mensualidad_id);
    assert.equal(brutos!.length, 1, "30 una sola compra");
    assert.equal(Number(brutos![0].importe_bruto), 0, "30 sigue sin ingreso");

    // 29) fallo financiero: si la compra no puede aplicarse, NO queda mensualidad
    //     cobrada sin su registro. Se fuerza con un plan desactivado a mitad.
    const comprasAntes = (await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true })).count ?? 0;
    const mensAntes = (await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true })).count ?? 0;
    const { error: errTel } = await supabaseAdmin.rpc("mensualidad_admin_alta", {
      p_plan_slug: "1h", p_nombre: "Probe", p_apellido: MARCA,
      p_telefono: "+1 555 0100", // extranjero: la normalización lo rechaza
      p_email: EMAIL, p_modalidad: "venta", p_medio_pago: "efectivo", p_cortesia_tipo: null,
      p_motivo: "rollback", p_actor: "admin", p_actor_rol: "admin",
      p_idempotency_key: clave(), p_declaracion: true, p_cobrado_el: null,
    });
    assert.ok(errTel, "29 la operación falla");
    assert.equal((await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true })).count ?? 0, comprasAntes,
      "29 no quedó una compra huérfana");
    assert.equal((await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true })).count ?? 0, mensAntes,
      "29 no quedó una mensualidad sin su compra");
  }
  console.log("M7.4-26..30 idempotencia, concurrencia y rollback OK");

  // ── FINANZAS Y MÉTRICAS ───────────────────────────────────────────────────
  {
    const mes = hoy.slice(0, 7);

    // Una venta con QR: la comisión sale de fin_comisiones_cobro, no inventada.
    const telQ = nuevoTel();
    const rq = await alta({ telefono: telQ, plan_slug: "2h", medio_pago: "qr" });
    assert.ok(rq.ok, `finanzas ${rq.ok ? "" : rq.error}`);
    const cq = await compraDe(rq.data.compra_id);
    assert.equal(cq.procesador, "mercado_pago", "el procesador se resuelve en el servidor");
    // qr mercado_pago: 0,80 % + IVA 21 % ⇒ 0,968 % de 55.000 = 532,40
    assert.equal(Number(cq.comision_mp), 532.4, "la comisión usa la tasa vigente del modelo");
    assert.equal(Number(cq.importe_neto), 55000 - 532.4, "el neto es bruto menos comisión");

    // Efectivo: sin comisión.
    const telE = nuevoTel();
    const re = await alta({ telefono: telE, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(re.ok);
    const ce = await compraDe(re.data.compra_id);
    assert.equal(Number(ce.comision_mp), 0, "efectivo no tiene comisión de cobro");
    assert.equal(ce.procesador, null, "efectivo no lleva procesador");

    // La fuente 'mensualidades' aparece en el informe mensual, por método.
    const { data: ing } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
    const filasMens = (ing as Array<{ fuente: string; metodo: string; total: number; cantidad: number }>)
      .filter((f) => f.fuente === "mensualidades");
    assert.ok(filasMens.length >= 2, "las ventas administrativas llegan a Finanzas");
    const porMetodo = Object.fromEntries(filasMens.map((f) => [f.metodo, Number(f.total)]));
    assert.ok((porMetodo.qr ?? 0) >= 55000, "el QR suma su bruto");
    assert.ok((porMetodo.efectivo ?? 0) >= 30000, "el efectivo suma su bruto");

    // La CORTESÍA no suma en ninguna línea de ingresos.
    const totalMens = filasMens.reduce((a, f) => a + Number(f.total), 0);
    const { data: resumen } = await supabaseAdmin.rpc("mensualidad_resumen_altas_mes", { p_mes: mes });
    const filasRes = resumen as Array<{ canal: string; tipo: string; cantidad: number; bruto: number }>;
    const cortesias = filasRes.filter((f) => f.canal === "admin_cortesia");
    assert.ok(cortesias.length >= 1, "las cortesías se cuentan aparte");
    assert.equal(cortesias.reduce((a, f) => a + Number(f.bruto), 0), 0,
      "y su bruto es cero por definición");
    const brutoVentas = filasRes.filter((f) => f.canal === "admin_venta")
      .reduce((a, f) => a + Number(f.bruto), 0);
    assert.ok(Math.abs(brutoVentas - totalMens) < 0.01,
      "el informe y el resumen coinciden: la cortesía está excluida de los dos");

    // Las métricas distinguen web / administrativa / cortesía y alta / renovación.
    const canales = new Set(filasRes.map((f) => f.canal));
    assert.ok(canales.has("admin_venta") && canales.has("admin_cortesia"),
      "se distinguen ventas administrativas de cortesías");
    const tipos = new Set(filasRes.map((f) => f.tipo));
    assert.ok(tipos.has("alta") && tipos.has("renovacion"), "y altas de renovaciones");

    // fin_pagos_web NO se toca: no hubo Checkout Pro.
    const { count: pagosWeb } = await supabaseAdmin.from("fin_pagos_web")
      .select("*", { count: "exact", head: true });
    assert.equal(pagosWeb, antes.pagos_web, "ninguna venta administrativa toca fin_pagos_web");
  }
  console.log("M7.4 finanzas: ingreso por método, comisión vigente y cortesía excluida OK");

  // ── ORDEN DE LAS COMPRAS DEL MISMO DÍA ────────────────────────────────────
  // Lo encontró la validación visual: el listado muestra el "último plan"
  // ordenando por aprobado_at, y el alta normalizaba el instante a la
  // medianoche del día. Dos ventas del mismo titular en la misma jornada
  // empataban y el panel mostraba la PRIMERA como si fuera la última.
  {
    const telO = nuevoTel();
    const a = await alta({ telefono: telO, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(a.ok, `orden ${a.ok ? "" : a.error}`);
    const b = await alta({ telefono: telO, plan_slug: "4h", medio_pago: "efectivo" });
    assert.ok(b.ok, `orden ${b.ok ? "" : b.error}`);
    assert.equal(b.data.tipo, "renovacion");

    const { data: compras2 } = await supabaseAdmin.from("mensualidad_compras")
      .select("plan_slug, aprobado_at, cobrado_at")
      .eq("mensualidad_id", a.data.mensualidad_id)
      .order("aprobado_at", { ascending: false });

    assert.equal(compras2!.length, 2, "orden: dos compras el mismo día");
    assert.notEqual(compras2![0].aprobado_at, compras2![1].aprobado_at,
      "orden: dos ventas del mismo día NO pueden compartir aprobado_at");
    assert.equal(compras2![0].plan_slug, "4h",
      "orden: la más reciente por aprobado_at es la última que se registró");

    // Y el mes contable sigue siendo el correcto para las dos.
    const mes = hoy.slice(0, 7);
    for (const c of compras2!) {
      assert.equal(String(c.cobrado_at).slice(0, 7), mes,
        "orden: el mes contable no cambia por llevar la hora real");
    }
  }
  console.log("M7.4 orden: dos ventas del mismo día se distinguen OK");

  // ── PANEL: lo creado aparece y el contrato de staff se mantiene ────────────
  {
    const telP = nuevoTel();
    const rp = await alta({ telefono: telP, plan_slug: "1h", medio_pago: "efectivo" });
    assert.ok(rp.ok);

    const lista = await listarMensualidades({ busqueda: telP, pagina: 1 });
    assert.ok(lista.filas.length >= 1, "la mensualidad nueva aparece en el listado");

    const detAdmin = await getDetalleMensualidad(rp.data.mensualidad_id, "admin");
    assert.ok(detAdmin, "el detalle existe");
    assert.ok(detAdmin!.codigo, "admin ve el código");
    assert.equal(detAdmin!.codigo_visible, true);
    // El saldo y el vencimiento del detalle son los que dejó el alta: la
    // pantalla no puede mostrar un estado viejo.
    assert.equal(detAdmin!.saldo_minutos, rp.data.saldo_posterior, "el detalle muestra el saldo nuevo");
    assert.equal(detAdmin!.vence_el, rp.data.vence_el, "y el vencimiento nuevo");
    assert.ok(detAdmin!.historial.length >= 1, "el movimiento del alta está en el historial");

    const detStaff = await getDetalleMensualidad(rp.data.mensualidad_id, "staff");
    assert.equal(detStaff!.codigo, null, "staff NO ve el código: el contrato de M7 sigue igual");
    assert.equal(detStaff!.codigo_visible, false);

    // La auditoría es una consulta aparte y sigue siendo material de admin: el
    // motivo de una cortesía no puede terminar en la pantalla de staff.
    const audi = await getAuditoria(rp.data.mensualidad_id);
    assert.ok(audi.length >= 1, "la auditoría del alta existe");
    assert.equal(audi[0].actor_rol, "admin");
  }
  console.log("M7.4 panel: listado, detalle y contrato de staff OK");

  const despues = await contarTodo();
  console.log("contadores después (antes de limpiar):", JSON.stringify(despues));
  assert.equal(despues.planes, antes.planes, "los planes no se tocan");
  assert.equal(despues.pagos_web, antes.pagos_web, "fin_pagos_web no cambia");
  assert.equal(despues.reservas, antes.reservas, "no se crean reservas");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count: bill } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", EMAIL);
    const { count: comp } = await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true }).eq("comprador_email", EMAIL);
    console.log(`limpieza: ${bill ?? 0} billeteras y ${comp ?? 0} compras con la marca (deben ser 0 y 0)`);
    if ((bill ?? 0) !== 0 || (comp ?? 0) !== 0) process.exitCode = 1;
  });
