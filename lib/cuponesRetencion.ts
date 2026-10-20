// ============================================================================
// Cupones de usos limitados: retención compartida por Reservas y Gift Cards.
// SOLO SERVIDOR. La garantía vive en la base (db/cupones-retencion.sql); esto
// es el lado de la aplicación.
// ----------------------------------------------------------------------------
// Ciclo (un intento = la clave intento_id que manda el navegador y repite en
// cada reintento del mismo pedido):
//   1. retenerCupon ANTES de crear la compra y de habilitar cualquier pago con
//      descuento. La base bloquea el código y cuenta usos + retenciones.
//   2. El descuento se recalcula sobre la fila BLOQUEADA (evaluarCodigoDescuento);
//      si no coincide con lo validado, se libera y no se cobra nada.
//   3. Con pago: vincularRetencion marca la oportunidad de pago y su vencimiento
//      ANTES de llamar a Mercado Pago, la preferencia se crea con ese vencimiento
//      (expires + expiration_date_to) y su link se guarda en la retención.
//      Sin pago (100 % bonificada): se consume en el mismo pedido.
//   4. El webhook consume al recibir un pago APROBADO, pase lo que pase con el
//      turno (el descuento se usó). Rechazos no liberan: con la misma preferencia
//      se puede volver a intentar con otro medio hasta que vence.
//   5. Liberar: solo si nunca hubo oportunidad de pago, o si ya pasó vence_en y
//      Mercado Pago no tiene ningún pago aprobado ni abierto para esa
//      external_reference (resolverRetencion). Lo hace la próxima compra que
//      encuentra el cupón ocupado por una retención vencida.
// Mismo intento: devuelve la misma preferencia; si el intento anterior terminó
// en error, rehace la preferencia de la MISMA compra (misma external_reference).
// Nunca hay dos links entregados a la vez para una retención.
// Los códigos sin usos_maximos no se retienen: no excluyen a nadie y siguen el
// camino de siempre (consumir_codigo_descuento en el webhook).
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSecurityEvent } from "@/lib/apiError";
import type { FilaCodigoDescuento } from "@/lib/codigosDescuento";

/** Cuánto dura la preferencia de una compra con cupón limitado. */
export const VENTANA_PAGO_CUPON_MIN = 30;
/** Un pedido que acaba de retener sigue en curso: otro reintento espera. */
export const GRACIA_INTENTO_MS = 2 * 60_000;

export type ProductoCupon = "reserva" | "gift_card";

export type Retencion = {
  id: string;
  intento: string;
  codigo: string;
  producto: ProductoCupon;
  estado: "retenido" | "consumido" | "liberado";
  reserva_id: number | null;
  grupo_compra_id: string | null;
  external_reference: string | null;
  con_pago: boolean;
  preferencia_id: string | null;
  init_point: string | null;
  total_original: number | null;
  descuento: number | null;
  total_final: number | null;
  pago_id: string | null;
  nota: string | null;
  retenido_en: string;
  vence_en: string;
};

export type FalloCupon = { ok: false; status: number; error: string; codigo: string };

const MENSAJES: Record<string, { status: number; error: string }> = {
  inexistente: { status: 400, error: "El código no existe" },
  inactivo: { status: 400, error: "El código no está activo" },
  agotado: { status: 409, error: "El código ya alcanzó el máximo de usos" },
  no_vigente: { status: 400, error: "El código todavía no está vigente" },
  vencido: { status: 400, error: "El código está vencido" },
  en_uso: {
    status: 409,
    error: "Este código está apartado por otra compra en curso. Si esa compra no se paga, vuelve a quedar disponible.",
  },
  codigo_cambiado: { status: 409, error: "El código de descuento cambió mientras comprabas. Probá de nuevo." },
  intento_con_otro_pedido: { status: 409, error: "Este intento de pago corresponde a otro pedido. Recargá la página y probá de nuevo." },
  intento_en_curso: { status: 409, error: "Estamos preparando tu pago. Esperá unos segundos y volvé a intentar." },
  intento_vencido: { status: 409, error: "Este intento de pago venció. Volvé a armar tu compra." },
  compra_ya_pagada: { status: 409, error: "Esta compra ya se pagó." },
  error: { status: 500, error: "No se pudo reservar el código de descuento" },
};

export function falloCupon(codigo: string): FalloCupon {
  const m = MENSAJES[codigo] ?? MENSAJES.error;
  return { ok: false, status: m.status, error: m.error, codigo: MENSAJES[codigo] ? codigo : "error" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Clave del intento que manda el navegador; si falta o no sirve, una nueva (sin reintentos posibles). */
export function intentoDe(body: unknown): string {
  const v = (body as { intento_id?: unknown } | null)?.intento_id;
  return typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : randomUUID();
}

function estable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estable);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, estable((v as Record<string, unknown>)[k])]));
  }
  return v ?? null;
}

/** Huella del pedido: el mismo intento con otro pedido es un conflicto, no un reintento. */
export function huellaIntento(datos: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(estable(datos))).digest("hex");
}

/** Campos de la preferencia que la hacen vencer (documentación de Checkout Pro: expires + expiration_date_*). */
export function vencimientoPreferencia(ahora: Date): { expira: Date; campos: { expires: true; expiration_date_from: string; expiration_date_to: string } } {
  const expira = new Date(ahora.getTime() + VENTANA_PAGO_CUPON_MIN * 60_000);
  return {
    expira,
    campos: { expires: true, expiration_date_from: fechaMp(new Date(ahora.getTime() - 60_000)), expiration_date_to: fechaMp(expira) },
  };
}

/** ISO 8601 con el huso de Argentina (-03:00), como los ejemplos de Mercado Pago. */
export function fechaMp(d: Date): string {
  return `${new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 23)}-03:00`;
}

type RespuestaRetener =
  | { ok: true; reutilizada: boolean; retencion: Retencion; codigo: FilaCodigoDescuento }
  | { ok: false; motivo: string; vencidas?: string[] };

export type Retenido = { ok: true; retencion: Retencion; fila: FilaCodigoDescuento; reutilizada: boolean };

export type PagoMp = { id: string; status: string };

export type DepsCupon = {
  buscarPagos?: (externalReference: string) => Promise<PagoMp[]>;
  ahora?: () => Date;
};

/**
 * Retiene el cupón para este intento. Si está ocupado por retenciones ya
 * vencidas, las verifica en Mercado Pago (resolverRetencion) y reintenta una vez.
 */
export async function retenerCupon(args: {
  codigo: string;
  producto: ProductoCupon;
  intento: string;
  huella: string;
  deps?: DepsCupon;
}): Promise<Retenido | FalloCupon> {
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    const { data, error } = await supabaseAdmin.rpc("codigo_retener", {
      p_intento: args.intento,
      p_codigo: args.codigo,
      p_producto: args.producto,
      p_huella: args.huella,
    });
    if (error) {
      if (String(error.message).includes("intento_con_otro_pedido")) return falloCupon("intento_con_otro_pedido");
      console.error("codigo_retener:", error.message);
      return falloCupon("error");
    }
    const r = data as RespuestaRetener;
    if (r.ok) return { ok: true, retencion: r.retencion, fila: r.codigo, reutilizada: r.reutilizada };
    if (r.motivo === "en_uso" && vuelta === 0 && r.vencidas?.length) {
      let alguna = false;
      for (const id of r.vencidas) {
        if ((await resolverRetencion(id, args.deps)).resultado === "liberada") alguna = true;
      }
      if (alguna) continue;
    }
    return falloCupon(r.motivo === "sin_limite" ? "codigo_cambiado" : r.motivo);
  }
  return falloCupon("en_uso");
}

export type DatosVinculo = {
  reserva_id?: number;
  grupo_compra_id?: string;
  external_reference?: string;
  total_original?: number;
  descuento?: number;
  total_final?: number;
  /** Se habilita un pago: va SIEMPRE con expira, antes de crear la preferencia. */
  con_pago?: true;
  expira?: Date;
  preferencia_id?: string;
  init_point?: string;
};

/** Vincula compra, importes, oportunidad de pago o preferencia. Lanza si la base lo rechaza. */
export async function vincularRetencion(id: string, datos: DatosVinculo): Promise<Retencion> {
  const p: Record<string, unknown> = { ...datos };
  if (datos.expira) p.expira = datos.expira.toISOString();
  const { data, error } = await supabaseAdmin.rpc("codigo_retencion_vincular", { p_id: id, p_datos: p });
  if (error) throw new Error(`codigo_retencion_vincular: ${error.message}`);
  return data as Retencion;
}

export type ResultadoConsumo = "consumida" | "ya_consumida" | "consumida_tras_liberar" | "sin_cupo" | "error";

export async function consumirRetencion(
  id: string,
  pagoId: string | null,
  contexto: { nombre?: string | null; telefono?: string | null; fecha_reserva?: string | null; hora_reserva?: string | null } = {},
): Promise<ResultadoConsumo> {
  const { data, error } = await supabaseAdmin.rpc("codigo_retencion_consumir", {
    p_id: id,
    p_pago_id: pagoId ?? "",
    p_contexto: contexto,
  });
  if (error) {
    console.error("codigo_retencion_consumir:", error.message);
    // La respuesta pudo perderse con el consumo ya hecho: se mira el estado real
    // antes de que quien llamó deshaga una compra que sí usó el cupón.
    const { data: actual } = await supabaseAdmin.from("codigo_retenciones").select("estado").eq("id", id).maybeSingle();
    return actual?.estado === "consumido" ? "ya_consumida" : "error";
  }
  const resultado = (data as { resultado: ResultadoConsumo }).resultado;
  if (resultado === "sin_cupo") logSecurityEvent("cupon_aprobado_sin_cupo", { retencion: id, pagoId: pagoId ?? "" });
  if (resultado === "consumida_tras_liberar") logSecurityEvent("cupon_consumido_tras_liberar", { retencion: id });
  return resultado;
}

export type MotivoLiberacion = "sin_oportunidad_de_pago" | "sin_pago_tras_vencer";

/** Libera; nunca lanza. La base rechaza liberar antes de tiempo una retención con pago. */
export async function liberarRetencion(id: string, motivo: MotivoLiberacion): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("codigo_retencion_liberar", { p_id: id, p_motivo: motivo });
  if (error) {
    console.error("codigo_retencion_liberar:", error.message);
    return "error";
  }
  return (data as { resultado: string }).resultado;
}

/**
 * La retención de ESTE intento para ese código, si existe. Sirve para que el
 * reintento de una compra que ya usó un cupón de un uso (y que por eso ya no
 * valida) siga por su propio estado en vez de recibir "el código no está activo".
 */
export async function retencionDeIntento(intento: string, codigo: string): Promise<Retencion | null> {
  const { data } = await supabaseAdmin
    .from("codigo_retenciones")
    .select("*")
    .eq("intento", intento)
    .eq("codigo", String(codigo || "").trim().toUpperCase())
    .maybeSingle();
  return (data as Retencion | null) ?? null;
}

export async function retencionDeCompra(compra: { reserva_id: number } | { grupo_compra_id: string }): Promise<Retencion | null> {
  const q = supabaseAdmin.from("codigo_retenciones").select("*");
  const { data, error } = await ("reserva_id" in compra ? q.eq("reserva_id", compra.reserva_id) : q.eq("grupo_compra_id", compra.grupo_compra_id)).maybeSingle();
  if (error) throw new Error(`codigo_retenciones: ${error.message}`);
  return (data as Retencion | null) ?? null;
}

/**
 * Webhook con un pago aprobado: si la compra tiene retención, la consume
 * (idempotente). Devuelve null si la compra no tiene retención (código sin
 * límite o compra anterior a esta versión: camino de siempre).
 */
export async function consumirRetencionDeCompra(
  compra: { reserva_id: number } | { grupo_compra_id: string },
  pagoId: string,
  contexto: Parameters<typeof consumirRetencion>[2] = {},
): Promise<ResultadoConsumo | null> {
  const r = await retencionDeCompra(compra);
  if (!r) return null;
  if (r.estado === "consumido") return "ya_consumida";
  return consumirRetencion(r.id, pagoId, contexto);
}

// ── Verificación para liberar ──────────────────────────────────────────────
// Estados de pago de Mercado Pago. Aprobado alguna vez (aunque después se haya
// devuelto o disputado): el descuento se usó, se consume. Cerrado sin cobro: no
// cuenta. Cualquier otro (pending, in_process, authorized o uno desconocido)
// todavía puede aprobarse: la retención se mantiene.
const FUE_APROBADO = new Set(["approved", "refunded", "charged_back", "in_mediation"]);
const CERRADO_SIN_COBRO = new Set(["rejected", "cancelled"]);

async function buscarPagosMp(externalReference: string): Promise<PagoMp[]> {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error("sin MERCADOPAGO_ACCESS_TOKEN");
  const res = await new Payment(new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } })).search({
    options: { external_reference: externalReference, limit: 100 },
  });
  return (res.results ?? []).map((p) => ({ id: String(p.id), status: String(p.status ?? "") }));
}

/** ¿La compra ya quedó paga o activa sin pago? (por si el pedido murió antes de consumir) */
async function compraCompletada(r: Retencion): Promise<{ completada: boolean; pagoId: string | null }> {
  if (r.producto === "reserva") {
    if (!r.reserva_id) return { completada: false, pagoId: null };
    const { data } = await supabaseAdmin.from("reservas").select("estado, total, mercado_pago_payment_id").eq("id", r.reserva_id).maybeSingle();
    if (data?.mercado_pago_payment_id) return { completada: true, pagoId: String(data.mercado_pago_payment_id) };
    return { completada: data?.estado === "activa" && Number(data?.total) === 0, pagoId: null };
  }
  if (!r.grupo_compra_id) return { completada: false, pagoId: null };
  const { data } = await supabaseAdmin.from("gift_cards").select("estado_pago, mercado_pago_payment_id").eq("grupo_compra_id", r.grupo_compra_id);
  const pagada = (data ?? []).find((f) => f.mercado_pago_payment_id);
  if (pagada) return { completada: true, pagoId: String(pagada.mercado_pago_payment_id) };
  return { completada: (data ?? []).some((f) => f.estado_pago === "pagado"), pagoId: null };
}

export type ResultadoResolver = { resultado: "consumida" | "liberada" | "retenida" | "no_retenida"; motivo?: string };

/**
 * Decide qué pasa con una retención: se mantiene, se consume o se libera.
 * Solo libera cuando ya no existe ninguna oportunidad de pago aprobable.
 */
export async function resolverRetencion(id: string, deps: DepsCupon = {}): Promise<ResultadoResolver> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const { data, error } = await supabaseAdmin.from("codigo_retenciones").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { resultado: "retenida", motivo: "no_se_pudo_leer" };
  const r = data as Retencion;
  if (r.estado !== "retenido") return { resultado: "no_retenida", motivo: r.estado };
  if (Date.parse(r.vence_en) > ahora.getTime()) return { resultado: "retenida", motivo: "vigente" };

  const compra = await compraCompletada(r);
  if (compra.completada) {
    const c = await consumirRetencion(r.id, compra.pagoId);
    return c === "error" ? { resultado: "retenida", motivo: "error_al_consumir" } : { resultado: "consumida", motivo: "compra_completada" };
  }
  if (!r.con_pago) {
    const l = await liberarRetencion(r.id, "sin_oportunidad_de_pago");
    return l === "liberada" || l === "ya_liberada" ? { resultado: "liberada", motivo: "sin_oportunidad_de_pago" } : { resultado: "retenida", motivo: l };
  }
  if (!r.external_reference) return { resultado: "retenida", motivo: "sin_referencia" };

  let pagos: PagoMp[];
  try {
    pagos = await (deps.buscarPagos ?? buscarPagosMp)(r.external_reference);
  } catch (e) {
    logSecurityEvent("cupon_verificacion_mp_fallida", { retencion: r.id, error: (e as Error)?.message ?? "?" });
    return { resultado: "retenida", motivo: "mercado_pago_no_responde" };
  }
  const aprobado = pagos.find((p) => FUE_APROBADO.has(p.status));
  if (aprobado) {
    const c = await consumirRetencion(r.id, aprobado.id);
    return c === "error" ? { resultado: "retenida", motivo: "error_al_consumir" } : { resultado: "consumida", motivo: "pago_aprobado" };
  }
  if (pagos.some((p) => !CERRADO_SIN_COBRO.has(p.status))) return { resultado: "retenida", motivo: "pago_abierto" };
  const l = await liberarRetencion(r.id, "sin_pago_tras_vencer");
  return l === "liberada" || l === "ya_liberada" ? { resultado: "liberada", motivo: "sin_pago_tras_vencer" } : { resultado: "retenida", motivo: l };
}

// ── Reintento del mismo intento ────────────────────────────────────────────
export type EstadoCompraIntento = "sin_compra" | "en_preparacion" | "fallida" | "completada";

export type PasoReintento =
  | { paso: "devolver"; preferencia_id: string; init_point: string }
  | { paso: "rehacer_preferencia" }
  | { paso: "crear_compra" }
  | { paso: "completada" }
  | { paso: "rechazar"; fallo: FalloCupon };

/**
 * Qué hacer con un intento que ya tenía retención. `compra` la determina cada
 * ruta: sin_compra, en_preparacion (creada, sin link), fallida (el intento
 * anterior terminó con error: error_pago / cancelado) o completada.
 */
export function pasoReintento(r: Retencion, compra: EstadoCompraIntento, ahora: Date, conPago: boolean): PasoReintento {
  if (r.estado === "liberado") return { paso: "rechazar", fallo: falloCupon("intento_vencido") };
  if (r.estado === "consumido") return conPago ? { paso: "rechazar", fallo: falloCupon("compra_ya_pagada") } : { paso: "completada" };
  if (compra === "completada") return conPago ? { paso: "rechazar", fallo: falloCupon("compra_ya_pagada") } : { paso: "completada" };
  if (conPago && r.preferencia_id && r.init_point && compra !== "fallida") {
    return { paso: "devolver", preferencia_id: r.preferencia_id, init_point: r.init_point };
  }
  const enCurso = Date.parse(r.retenido_en) > ahora.getTime() - GRACIA_INTENTO_MS;
  if (compra === "fallida") return conPago ? { paso: "rehacer_preferencia" } : { paso: "rechazar", fallo: falloCupon("intento_vencido") };
  if (enCurso) return { paso: "rechazar", fallo: falloCupon("intento_en_curso") };
  if (compra === "en_preparacion") return conPago ? { paso: "rehacer_preferencia" } : { paso: "rechazar", fallo: falloCupon("intento_vencido") };
  return { paso: "crear_compra" };
}
