// ============================================================================
// Cupones de usos limitados: retención compartida por Reservas y Gift Cards.
// SOLO SERVIDOR. La garantía vive en la base (db/cupones-retencion.sql); esto
// es el lado de la aplicación. Detalle y despliegue: docs/marketing/cupones-retencion.md.
// ----------------------------------------------------------------------------
// Ciclo (un intento = la clave intento_id que manda el navegador y repite en
// cada reintento del mismo pedido):
//   1. retenerCupon ANTES de crear la compra y de habilitar cualquier pago con
//      descuento. La base bloquea el código y cuenta usos + retenciones.
//   2. El descuento se recalcula sobre la fila BLOQUEADA (evaluarCodigoDescuento);
//      si no coincide con lo validado, se libera y no se cobra nada.
//   3. Con pago: vincularRetencion marca la oportunidad de pago y su vencimiento
//      y toma el turno de preparación ANTES de llamar a Mercado Pago; la
//      preferencia se crea con ese vencimiento (expires + expiration_date_to) y
//      su link se guarda en la retención con el turno (que así se devuelve).
//      Sin pago (100 % bonificada): se consume en el mismo pedido.
//   4. El webhook consume al recibir un pago APROBADO, pase lo que pase con el
//      turno (el descuento se usó). Rechazos no liberan: con la misma preferencia
//      se puede volver a intentar con otro medio hasta que vence.
//   5. Liberar (resolverRetencion): solo si nunca hubo oportunidad de pago, o si
//      ya pasó vence_en y Mercado Pago, con las consultas COMPLETAS, no tiene
//      pago aprobado ni abierto y ninguna preferencia de esa compra se puede
//      pagar. Ante cualquier duda (consulta fallida, incompleta, preferencia sin
//      vencimiento) la retención se conserva con su motivo. Lo dispara la próxima
//      compra que encuentra el cupón ocupado, el botón del panel y el cron.
// Mismo intento: devuelve la misma preferencia. Si el intento anterior terminó
// sin entregar link, primero se BUSCA en Mercado Pago la preferencia que pudo
// haber quedado creada y se reutiliza; solo si no hay ninguna pagable se crea
// otra (misma compra, misma external_reference).
// Sin la migración aplicada, los cupones limitados fallan cerrados (503) y los
// webhooks siguen el camino de siempre.
// Los códigos sin usos_maximos no se retienen: no excluyen a nadie y siguen el
// camino de siempre (consumir_codigo_descuento en el webhook).
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSecurityEvent } from "@/lib/apiError";
import type { FilaCodigoDescuento } from "@/lib/codigosDescuento";
import { mercadoPago, type PagoMpApi, type PreferenciaMp } from "@/lib/mercadoPagoApi";

/** Cuánto dura la preferencia de una compra con cupón limitado. */
export const VENTANA_PAGO_CUPON_MIN = 30;
/** Un pedido que acaba de retener sigue en curso: otro reintento espera. */
export const GRACIA_INTENTO_MS = 2 * 60_000;
/** Turno para crear o recuperar la preferencia (cubre timeout + reintentos del SDK). */
export const TURNO_PREPARACION_S = 45;
/** Una preferencia vencida hace menos de esto todavía no se da por cerrada. */
export const MARGEN_VENCIMIENTO_MS = 15 * 60_000;

export type ProductoCupon = "reserva" | "gift_card";

export type Retencion = {
  id: string;
  intento: string;
  codigo: string;
  codigo_id?: number;
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
  consumido_en?: string | null;
  liberado_en?: string | null;
  motivo_liberacion?: string | null;
  preparando_hasta?: string | null;
  revisiones?: number;
  revisada_en?: string | null;
  revision_resultado?: string | null;
  revision_motivo?: string | null;
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
  verificando_pago: { status: 503, error: "No pudimos confirmar el estado de tu pago anterior. Probá de nuevo en unos minutos." },
  no_disponible: { status: 503, error: "Los códigos de descuento de uso limitado no están disponibles en este momento. Probá más tarde o comprá sin código." },
  error: { status: 500, error: "No se pudo reservar el código de descuento" },
};

export function falloCupon(codigo: string): FalloCupon {
  const m = MENSAJES[codigo] ?? MENSAJES.error;
  return { ok: false, status: m.status, error: m.error, codigo: MENSAJES[codigo] ? codigo : "error" };
}

/**
 * ¿La base todavía no tiene la migración? (función o tabla inexistentes, según
 * PostgREST o Postgres). Así la app nueva puede desplegarse ANTES de migrar.
 */
export function faltaMigracion(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(String(error.code ?? ""));
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

export type DepsCupon = { ahora?: () => Date };

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
      if (faltaMigracion(error)) {
        logSecurityEvent("cupon_limitado_sin_migracion", { producto: args.producto });
        return falloCupon("no_disponible");
      }
      console.error("codigo_retener:", error.message);
      return falloCupon("error");
    }
    const r = data as RespuestaRetener;
    if (r.ok) return { ok: true, retencion: r.retencion, fila: r.codigo, reutilizada: r.reutilizada };
    if (r.motivo === "en_uso" && vuelta === 0 && r.vencidas?.length) {
      let alguna = false;
      for (const id of r.vencidas) {
        if ((await resolverRetencion(id, { ...args.deps, origen: "compra" })).resultado === "liberada") alguna = true;
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
  /** Toma el turno de preparación (si otro pedido lo tiene, la base rechaza). */
  preparar?: { token: string; segundos: number };
  /** Guardar el link exige el turno: va con preparacion = el token. */
  preferencia_id?: string;
  init_point?: string;
  preparacion?: string;
  /** Devuelve el turno sin guardar nada. */
  soltar?: string;
};

/** Vincula compra, importes, oportunidad de pago, turno o preferencia. Lanza si la base lo rechaza. */
export async function vincularRetencion(id: string, datos: DatosVinculo): Promise<Retencion> {
  const p: Record<string, unknown> = { ...datos };
  if (datos.expira) p.expira = datos.expira.toISOString();
  const { data, error } = await supabaseAdmin.rpc("codigo_retencion_vincular", { p_id: id, p_datos: p });
  if (error) throw Object.assign(new Error(`codigo_retencion_vincular: ${error.message}`), { codigoBase: error.message });
  return data as Retencion;
}

/** Toma el turno de preparación; false si otro pedido lo tiene. */
export async function tomarTurno(id: string, token: string): Promise<boolean> {
  try {
    await vincularRetencion(id, { preparar: { token, segundos: TURNO_PREPARACION_S } });
    return true;
  } catch (e) {
    if (String((e as { codigoBase?: string }).codigoBase).includes("preparacion_en_curso")) return false;
    throw e;
  }
}

export type ResultadoConsumo = "consumida" | "ya_consumida" | "ya_contado" | "consumida_tras_liberar" | "sin_cupo" | "error";
/** Resultados que significan "el uso quedó contado". */
export const CONSUMO_OK: ReadonlySet<ResultadoConsumo> = new Set(["consumida", "ya_consumida", "ya_contado", "consumida_tras_liberar"]);

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
  if (resultado === "ya_contado") logSecurityEvent("cupon_ya_contado_por_camino_anterior", { retencion: id });
  return resultado;
}

export type MotivoLiberacion = "sin_oportunidad_de_pago" | "sin_pago_tras_vencer";

/** Libera; nunca lanza. La base rechaza liberar antes de tiempo una retención con pago. */
export async function liberarRetencion(id: string, motivo: MotivoLiberacion): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("codigo_retencion_liberar", { p_id: id, p_motivo: motivo });
  if (error) {
    // "retencion_con_pago" es la base cuidando lo que debe: hubo oportunidad de pago.
    if (!String(error.message).includes("retencion_con_pago")) console.error("codigo_retencion_liberar:", error.message);
    return String(error.message).includes("retencion_con_pago") ? "con_pago" : "error";
  }
  return (data as { resultado: string }).resultado;
}

/**
 * La retención de ESTE intento para ese código, si existe. Sirve para que el
 * reintento de una compra que ya usó un cupón de un uso (y que por eso ya no
 * valida) siga por su propio estado en vez de recibir "el código no está activo".
 */
export async function retencionDeIntento(intento: string, codigo: string): Promise<Retencion | null> {
  const { data, error } = await supabaseAdmin
    .from("codigo_retenciones")
    .select("*")
    .eq("intento", intento)
    .eq("codigo", String(codigo || "").trim().toUpperCase())
    .maybeSingle();
  if (error && !faltaMigracion(error)) console.error("codigo_retenciones (intento):", error.message);
  return (data as Retencion | null) ?? null;
}

export async function retencionDeCompra(compra: { reserva_id: number } | { grupo_compra_id: string }): Promise<Retencion | null> {
  const q = supabaseAdmin.from("codigo_retenciones").select("*");
  const { data, error } = await ("reserva_id" in compra ? q.eq("reserva_id", compra.reserva_id) : q.eq("grupo_compra_id", compra.grupo_compra_id)).maybeSingle();
  if (error) {
    // Sin la migración no hay retenciones: el webhook sigue el camino de siempre.
    if (faltaMigracion(error)) return null;
    throw new Error(`codigo_retenciones: ${error.message}`);
  }
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

// ── Verificación en Mercado Pago ────────────────────────────────────────────
// Estados de pago. Aprobado alguna vez (aunque después se haya devuelto o
// disputado): el descuento se usó, se consume. Cerrado sin cobro: no cuenta.
// Cualquier otro (pending, in_process, authorized o desconocido) todavía puede
// aprobarse: la retención se mantiene.
const FUE_APROBADO = new Set(["approved", "refunded", "charged_back", "in_mediation"]);
const CERRADO_SIN_COBRO = new Set(["rejected", "cancelled"]);
const POR_PAGINA = 50; // máximo documentado de "Buscar en pagos"
const PAGINAS_MAX = 20;

export type VeredictoMp =
  | { estado: "aprobado"; pagoId: string }
  | { estado: "pagable"; motivo: "pago_abierto" | "preferencia_vigente" | "preferencia_sin_vencimiento" }
  | { estado: "incierto"; motivo: string }
  | { estado: "cerrado" };

/** Todos los pagos de esa referencia; null si la consulta falla o queda incompleta. */
async function todosLosPagos(ref: string): Promise<PagoMpApi[] | null> {
  const pagos: PagoMpApi[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const r = await mercadoPago.buscarPagos({ external_reference: ref, offset: pagos.length, limit: POR_PAGINA });
    if (r.total === null) return null; // sin paging.total no se sabe si está completa
    pagos.push(...r.results);
    if (pagos.length >= r.total) return pagos.length === r.total ? pagos : null;
    if (r.results.length === 0) return null; // dice que hay más pero no las devuelve
  }
  return null;
}

/** Todas las preferencias de esa referencia (últimos 90 días); null si falla o queda incompleta. */
async function todasLasPreferencias(ref: string): Promise<PreferenciaMp[] | null> {
  const prefs: PreferenciaMp[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const r = await mercadoPago.buscarPreferencias({ external_reference: ref, offset: prefs.length });
    if (r.total === null) return null;
    prefs.push(...r.elements);
    if (prefs.length >= r.total) return prefs.length === r.total ? prefs : null;
    if (r.elements.length === 0) return null;
  }
  return null;
}

/** ¿Esa preferencia todavía se puede pagar? Sin vencimiento confirmado, sí. */
function pagable(p: PreferenciaMp, ahora: Date, margenMs: number): boolean {
  if (p.expires !== true || !p.expiration_date_to) return true;
  const vence = Date.parse(p.expiration_date_to);
  return !Number.isFinite(vence) || vence + margenMs > ahora.getTime();
}

/**
 * Qué dice Mercado Pago de la compra de una retención. Solo "cerrado" permite
 * liberar: consulta de pagos completa sin aprobados ni abiertos, Y todas las
 * preferencias conocidas (la guardada + las de la búsqueda) vencidas con
 * expires=true, con margen. Cualquier falla o dato faltante es "incierto".
 */
export async function verificarEnMercadoPago(r: Retencion, ahora = new Date()): Promise<VeredictoMp> {
  if (!r.external_reference) return { estado: "incierto", motivo: "sin_referencia" };
  // La búsqueda de preferencias cubre 90 días: más vieja, sin la guardada, no hay certeza.
  if (!r.preferencia_id && Date.parse(r.retenido_en) < ahora.getTime() - 85 * 86_400_000) {
    return { estado: "incierto", motivo: "fuera_de_ventana_de_busqueda" };
  }
  try {
    const pagos = await todosLosPagos(r.external_reference);
    if (!pagos) return { estado: "incierto", motivo: "consulta_de_pagos_incompleta" };
    const aprobado = pagos.find((p) => FUE_APROBADO.has(String(p.status ?? "")));
    if (aprobado) return { estado: "aprobado", pagoId: String(aprobado.id) };
    if (pagos.some((p) => !CERRADO_SIN_COBRO.has(String(p.status ?? "")))) return { estado: "pagable", motivo: "pago_abierto" };

    const prefs = await todasLasPreferencias(r.external_reference);
    if (!prefs) return { estado: "incierto", motivo: "consulta_de_preferencias_incompleta" };
    if (r.preferencia_id && !prefs.some((p) => p.id === r.preferencia_id)) prefs.push({ id: r.preferencia_id });
    for (const p of prefs) {
      // La búsqueda puede no traer `expires`: se confirma con "Obtener preferencia".
      const completa = typeof p.expires === "boolean" && p.expiration_date_to ? p : await mercadoPago.obtenerPreferencia(p.id);
      if (pagable(completa, ahora, MARGEN_VENCIMIENTO_MS)) {
        return { estado: "pagable", motivo: completa.expires === true ? "preferencia_vigente" : "preferencia_sin_vencimiento" };
      }
    }
    return { estado: "cerrado" };
  } catch (e) {
    return { estado: "incierto", motivo: `mercado_pago_no_responde:${String((e as { status?: number }).status ?? "red")}`.slice(0, 60) };
  }
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

export type ResultadoResolver = { id: string; resultado: "consumida" | "liberada" | "retenida" | "no_retenida"; motivo: string };

async function anotar(r: ResultadoResolver): Promise<ResultadoResolver> {
  const { error } = await supabaseAdmin.rpc("codigo_retencion_anotar_revision", { p_id: r.id, p_resultado: r.resultado, p_motivo: r.motivo });
  if (error) console.error("codigo_retencion_anotar_revision:", error.message);
  return r;
}

/**
 * Decide qué pasa con una retención: se mantiene, se consume o se libera, y lo
 * deja anotado (revisiones, revisada_en, resultado, motivo). Solo libera cuando
 * Mercado Pago confirma que no queda ninguna oportunidad de pago aprobable.
 * Repetirla es seguro: cada transición la vuelve a validar la base.
 */
export async function resolverRetencion(id: string, deps: DepsCupon & { origen?: string } = {}): Promise<ResultadoResolver> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const { data, error } = await supabaseAdmin.from("codigo_retenciones").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { id, resultado: "retenida", motivo: "no_se_pudo_leer" };
  const r = data as Retencion;
  const fin = async (resultado: ResultadoResolver["resultado"], motivo: string) => {
    const res = await anotar({ id, resultado, motivo });
    if (resultado !== "retenida" || deps.origen !== "compra") logSecurityEvent("cupon_conciliacion", { retencion: id, resultado, motivo, origen: deps.origen ?? "?" });
    return res;
  };
  if (r.estado !== "retenido") return { id, resultado: "no_retenida", motivo: r.estado };
  if (Date.parse(r.vence_en) > ahora.getTime()) return fin("retenida", "vigente");
  if (r.preparando_hasta && Date.parse(r.preparando_hasta) > ahora.getTime()) return fin("retenida", "preparando_pago");

  const compra = await compraCompletada(r);
  if (compra.completada) {
    const c = await consumirRetencion(r.id, compra.pagoId);
    return CONSUMO_OK.has(c) ? fin("consumida", "compra_completada") : fin("retenida", c === "sin_cupo" ? "aprobado_sin_cupo" : "error_al_consumir");
  }
  if (!r.con_pago) {
    const l = await liberarRetencion(r.id, "sin_oportunidad_de_pago");
    return l === "liberada" || l === "ya_liberada" ? fin("liberada", "sin_oportunidad_de_pago") : fin("retenida", `liberar:${l}`);
  }

  const v = await verificarEnMercadoPago(r, ahora);
  if (v.estado === "aprobado") {
    const c = await consumirRetencion(r.id, v.pagoId);
    return CONSUMO_OK.has(c) ? fin("consumida", "pago_aprobado") : fin("retenida", c === "sin_cupo" ? "aprobado_sin_cupo" : "error_al_consumir");
  }
  if (v.estado === "pagable" || v.estado === "incierto") return fin("retenida", v.motivo);
  const l = await liberarRetencion(r.id, "sin_pago_tras_vencer");
  return l === "liberada" || l === "ya_liberada" ? fin("liberada", "sin_pago_tras_vencer") : fin("retenida", `liberar:${l}`);
}

/**
 * Conciliación operativa (panel y cron): revisa las retenciones que ya pasaron
 * su vence_en (o las pedidas), una por una, hasta `limite`. Nunca libera sin
 * pasar por resolverRetencion.
 */
export async function conciliarRetenciones(o: { ids?: string[]; codigoId?: number; limite?: number; origen: string }): Promise<{
  revisadas: number;
  resultados: ResultadoResolver[];
  instaladas: boolean;
}> {
  const limite = Math.min(Math.max(o.limite ?? 25, 1), 100);
  let q = supabaseAdmin.from("codigo_retenciones").select("id").eq("estado", "retenido");
  if (o.ids?.length) q = q.in("id", o.ids.slice(0, limite));
  else q = q.lt("vence_en", new Date().toISOString());
  if (o.codigoId) q = q.eq("codigo_id", o.codigoId);
  const { data, error } = await q.order("vence_en", { ascending: true }).limit(limite);
  if (error) {
    if (faltaMigracion(error)) return { revisadas: 0, resultados: [], instaladas: false };
    throw new Error(`codigo_retenciones: ${error.message}`);
  }
  const resultados: ResultadoResolver[] = [];
  for (const { id } of (data ?? []) as { id: string }[]) resultados.push(await resolverRetencion(id, { origen: o.origen }));
  return { revisadas: resultados.length, resultados, instaladas: true };
}

// ── Recuperar una preferencia que pudo quedar creada ────────────────────────
/**
 * Para un reintento sin link guardado: busca en Mercado Pago las preferencias de
 * esa compra y devuelve una que todavía se pueda pagar (con su link, de "Obtener
 * preferencia"). null = no hay ninguna pagable (se puede crear otra sin abrir
 * una segunda oportunidad). Lanza si la búsqueda falla o queda incompleta: en ese
 * caso NO se crea otra.
 */
export async function recuperarPreferencia(externalReference: string, ahora = new Date()): Promise<{ id: string; init_point: string } | null> {
  const prefs = await todasLasPreferencias(externalReference);
  if (!prefs) throw new Error("búsqueda de preferencias incompleta");
  for (const p of prefs) {
    const completa = await mercadoPago.obtenerPreferencia(p.id);
    // Que le quede al menos un rato de vida: si está por vencer, mejor una nueva.
    if (completa.init_point && pagable(completa, ahora, -2 * 60_000)) return { id: completa.id, init_point: completa.init_point };
  }
  return null;
}

// ── Habilitar el pago de una compra con cupón retenido ─────────────────────
export type PagoPreparado =
  | { ok: true; preferencia: { id: string; init_point: string }; reutilizada: boolean }
  | { ok: false; fallo: FalloCupon };

/**
 * El único camino para entregar un link de pago con cupón limitado:
 *   · turno de preparación (un pedido a la vez por retención);
 *   · en un reintento, primero recupera la preferencia que pudo quedar creada
 *     (Mercado Pago la creó y la respuesta se perdió, o no se pudo guardar);
 *   · si no hay ninguna pagable: anota la oportunidad de pago y su vencimiento,
 *     crea la preferencia con ese vencimiento y guarda el link con el turno.
 * Si algo falla, devuelve el turno y relanza: el llamador marca su compra como
 * fallida y la retención queda (con oportunidad de pago anotada, hasta vencer y
 * verificarse en Mercado Pago).
 */
export async function prepararPagoConRetencion(args: {
  retencion: Retencion;
  vinculo: Omit<DatosVinculo, "con_pago" | "expira" | "preparar" | "preferencia_id" | "init_point" | "preparacion" | "soltar"> & { external_reference: string };
  reintento: boolean;
  crear: (campos: ReturnType<typeof vencimientoPreferencia>["campos"]) => Promise<PreferenciaMp>;
}): Promise<PagoPreparado> {
  const id = args.retencion.id;
  const token = randomUUID();
  const preparar = { token, segundos: TURNO_PREPARACION_S };
  let conTurno = false;
  try {
    if (args.reintento) {
      if (!(await tomarTurno(id, token))) return { ok: false, fallo: falloCupon("intento_en_curso") };
      conTurno = true;
      let recuperada: { id: string; init_point: string } | null;
      try {
        recuperada = await recuperarPreferencia(args.vinculo.external_reference);
      } catch (e) {
        logSecurityEvent("cupon_preferencia_no_verificable", { retencion: id, error: (e as Error)?.message ?? "?" });
        await vincularRetencion(id, { soltar: token }).catch(() => {});
        return { ok: false, fallo: falloCupon("verificando_pago") };
      }
      if (recuperada) {
        await vincularRetencion(id, { preferencia_id: recuperada.id, init_point: recuperada.init_point, preparacion: token });
        return { ok: true, preferencia: recuperada, reutilizada: true };
      }
    }
    const venc = vencimientoPreferencia(new Date());
    await vincularRetencion(id, { ...args.vinculo, con_pago: true, expira: venc.expira, ...(conTurno ? {} : { preparar }) });
    conTurno = true;
    const p = await args.crear(venc.campos);
    if (!p.id || !p.init_point) throw new Error("Mercado Pago no devolvió la preferencia");
    await vincularRetencion(id, { preferencia_id: String(p.id), init_point: String(p.init_point), preparacion: token });
    return { ok: true, preferencia: { id: String(p.id), init_point: String(p.init_point) }, reutilizada: false };
  } catch (e) {
    if (conTurno) await vincularRetencion(id, { soltar: token }).catch(() => {});
    throw e;
  }
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
 * "rehacer_preferencia" = recuperar la que pudo quedar creada o, si no hay
 * ninguna pagable, crear otra para la MISMA compra.
 */
export function pasoReintento(r: Retencion, compra: EstadoCompraIntento, ahora: Date, conPago: boolean): PasoReintento {
  if (r.estado === "liberado") return { paso: "rechazar", fallo: falloCupon("intento_vencido") };
  if (r.estado === "consumido") return conPago ? { paso: "rechazar", fallo: falloCupon("compra_ya_pagada") } : { paso: "completada" };
  if (compra === "completada") return conPago ? { paso: "rechazar", fallo: falloCupon("compra_ya_pagada") } : { paso: "completada" };
  if (conPago && r.preferencia_id && r.init_point && compra !== "fallida") {
    return { paso: "devolver", preferencia_id: r.preferencia_id, init_point: r.init_point };
  }
  // Otro pedido de este intento está creando o recuperando la preferencia.
  if (r.preparando_hasta && Date.parse(r.preparando_hasta) > ahora.getTime()) return { paso: "rechazar", fallo: falloCupon("intento_en_curso") };
  const enCurso = Date.parse(r.retenido_en) > ahora.getTime() - GRACIA_INTENTO_MS;
  if (compra === "fallida") return conPago ? { paso: "rehacer_preferencia" } : { paso: "rechazar", fallo: falloCupon("intento_vencido") };
  if (enCurso) return { paso: "rechazar", fallo: falloCupon("intento_en_curso") };
  if (compra === "en_preparacion") return conPago ? { paso: "rehacer_preferencia" } : { paso: "rechazar", fallo: falloCupon("intento_vencido") };
  return { paso: "crear_compra" };
}
