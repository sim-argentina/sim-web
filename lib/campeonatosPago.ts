import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PREFIJO_EXT_REF, TTL_PENDIENTES_MIN, GRACIA_CUPO_MIN } from "@/lib/campeonatosCheckout";

// Procesador ÚNICO de pagos de inscripciones a campeonatos.
// Lo usan el webhook y la reconciliación de la pantalla de resultado: la lógica
// crítica vive acá una sola vez.
//
// Nunca se confía en lo que llega en la notificación (status, importe, metadata,
// external_reference) ni en los query params del redirect: el pago se vuelve a
// consultar a Mercado Pago con las credenciales del servidor, y la inscripción
// se crea dentro de una función transaccional de Postgres.

// Flujo VIEJO (anterior a campeonato_checkouts): la inscripción ya existía en
// estado pendiente y el pago solo la marcaba pagada. Se mantiene para que las
// preferencias emitidas antes del cambio se sigan acreditando.
export const PREFIJO_EXT_REF_LEGACY = "campeonato_inscripcion_";

const MONEDA = "ARS";
// Tolerancia de centavo para comparar importes en coma flotante devueltos por MP.
const EPSILON = 0.01;

export type ResultadoPago =
  | { ok: true; estado: "creado"; inscripcionId: string }
  | { ok: true; estado: "ya_aprobado"; inscripcionId: string | null }
  | { ok: true; estado: "sin_cupo" }
  | { ok: true; estado: "registrado"; mpStatus: string }
  | { ok: true; estado: "ignorado"; motivo: string }
  | { ok: false; motivo: string; status: number };

export type PagoMp = {
  id?: string | number | null;
  status?: string | null;
  status_detail?: string | null;
  external_reference?: string | null;
  currency_id?: string | null;
  transaction_amount?: number | null;
  // Momento en que Mercado Pago aprobó el pago. Viene del pago traído con las
  // credenciales del servidor (no de la notificación) y decide si la reserva de
  // cupo seguía viva cuando se pagó.
  date_approved?: string | null;
  metadata?: Record<string, unknown> | null;
};

const ignorado = (motivo: string): ResultadoPago => ({ ok: true, estado: "ignorado", motivo });
const falla = (motivo: string, status = 400): ResultadoPago => ({ ok: false, motivo, status });

function clienteMp(): MercadoPagoConfig | null {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return null;
  return new MercadoPagoConfig({ accessToken });
}

// Extrae el id de pago de una notificación de Mercado Pago (body o query).
export function idDePagoDeNotificacion(req: Request, body: unknown): string | null {
  const b = body as { data?: { id?: unknown }; id?: unknown } | null;
  const deBody = b?.data?.id ?? b?.id;
  if (deBody) return String(deBody);
  const url = new URL(req.url);
  return url.searchParams.get("data.id") || url.searchParams.get("id");
}

// ── Reconciliación ──────────────────────────────────────────────────────────
// El webhook puede tardar o perderse. Desde la pantalla de resultado se le pide
// al SERVIDOR que consulte los pagos de este intento. El cliente nunca indica qué
// payment_id acreditar: solo tiene el token, y el id se descubre buscando por
// external_reference. Después pasa por el MISMO procesador que el webhook.
export async function reconciliarCheckout(externalReference: string): Promise<ResultadoPago | null> {
  const client = clienteMp();
  if (!client) return null;

  let encontrados: Array<{ id?: string; status?: string; date_created?: string }> = [];
  try {
    const r = await new Payment(client).search({
      options: { external_reference: externalReference, limit: 10 },
    });
    encontrados = (r?.results ?? []) as typeof encontrados;
  } catch {
    return null;
  }
  if (encontrados.length === 0) return null;

  const aprobado = encontrados.find((p) => p.status === "approved");
  const elegido = aprobado ?? [...encontrados].sort((a, b) =>
    String(b.date_created ?? "").localeCompare(String(a.date_created ?? ""))
  )[0];
  if (!elegido?.id) return null;

  return procesarPagoCampeonato(String(elegido.id));
}

// ── Procesamiento central ───────────────────────────────────────────────────

export async function procesarPagoCampeonato(paymentId: string): Promise<ResultadoPago> {
  const id = String(paymentId || "").trim();
  if (!id) return falla("payment_id_ausente", 400);

  const client = clienteMp();
  if (!client) return falla("servicio_no_disponible", 500);

  // La verdad la tiene Mercado Pago, consultada con NUESTRAS credenciales.
  let pago: PagoMp;
  try {
    pago = (await new Payment(client).get({ id })) as PagoMp;
  } catch {
    return falla("pago_no_consultable", 502);
  }
  return procesarPagoVerificado(id, pago);
}

// Verificación + aplicación sobre un pago YA traído de Mercado Pago. Separada
// para que los tests ejerciten TODAS las validaciones sin red y sin pagos reales.
export async function procesarPagoVerificado(id: string, pago: PagoMp): Promise<ResultadoPago> {
  const extRef = String(pago.external_reference || "");

  if (extRef.startsWith(PREFIJO_EXT_REF)) return procesarCheckout(id, pago, extRef);
  if (extRef.startsWith(PREFIJO_EXT_REF_LEGACY)) return procesarLegacy(id, pago, extRef);
  return ignorado("otro_producto");
}

// ── Flujo actual: intento de checkout → inscripción ─────────────────────────
async function procesarCheckout(id: string, pago: PagoMp, extRef: string): Promise<ResultadoPago> {
  const { data: chk, error } = await supabaseAdmin
    .from("campeonato_checkouts")
    .select("id, campeonato_id, monto, estado, inscripcion_id")
    .eq("external_reference", extRef)
    .maybeSingle();
  if (error) return falla("error_leyendo_checkout", 500);
  if (!chk) return ignorado("checkout_inexistente");

  // Metadata: si viene, tiene que ser coherente. Nunca reemplaza lo persistido.
  const meta = (pago.metadata ?? {}) as Record<string, unknown>;
  const metaProducto = meta.producto ?? meta.Producto;
  if (metaProducto && String(metaProducto) !== "campeonato") {
    return falla("metadata_producto_invalida", 409);
  }
  const metaCheckout = meta.checkout_id ?? meta.checkoutId;
  if (metaCheckout && String(metaCheckout) !== chk.id) {
    return falla("metadata_checkout_invalida", 409);
  }
  const metaCamp = meta.campeonato_id ?? meta.campeonatoId;
  if (metaCamp && String(metaCamp) !== chk.campeonato_id) {
    return falla("metadata_campeonato_invalida", 409);
  }

  // Moneda e importe contra el MONTO GUARDADO al crear el intento (no contra el
  // precio actual del campeonato, que puede haber cambiado desde entonces).
  if (String(pago.currency_id || "") !== MONEDA) return falla("moneda_invalida", 409);
  const bruto = Number(pago.transaction_amount);
  const esperado = Number(chk.monto);
  if (!Number.isFinite(bruto) || !Number.isFinite(esperado) || Math.abs(bruto - esperado) > EPSILON) {
    return falla("importe_no_coincide", 409);
  }

  const estadoMp = String(pago.status || "desconocido");
  const detalleMp = pago.status_detail ? String(pago.status_detail) : null;

  // Aprobado → la inscripción nace por la ÚNICA vía atómica que existe.
  if (estadoMp === "approved") {
    const { data, error: rpcError } = await supabaseAdmin.rpc("campeonato_checkout_confirmar", {
      p_external_reference: extRef,
      p_payment_id: id,
      p_mp_status: estadoMp,
      p_mp_status_detail: detalleMp,
      // Momento REAL de la aprobación. Si el pago entró dentro de la ventana de
      // reserva, la inscripción se confirma aunque el aviso llegue después: una
      // notificación demorada no le quita el lugar a quien pagó en tiempo.
      p_aprobado_at: pago.date_approved ?? null,
      p_ttl_pendientes_min: TTL_PENDIENTES_MIN,
      p_gracia_min: GRACIA_CUPO_MIN,
    });
    if (rpcError) return falla("no_se_pudo_confirmar", 500);

    const r = (data ?? {}) as { resultado?: string; inscripcion_id?: string | null };
    if (r.resultado === "creado") return { ok: true, estado: "creado", inscripcionId: String(r.inscripcion_id) };
    if (r.resultado === "ya_aprobado") return { ok: true, estado: "ya_aprobado", inscripcionId: r.inscripcion_id ?? null };
    if (r.resultado === "sin_cupo") return { ok: true, estado: "sin_cupo" };
    return falla("confirmacion_inesperada", 500);
  }

  // Pendiente / rechazado / cancelado: se registra el estado REAL y nada más.
  // El intento NO se cierra: la preferencia puede volver a pagarse mientras no
  // venza, y ese pago posterior tiene que poder acreditarse.
  await supabaseAdmin
    .from("campeonato_checkouts")
    .update({ mp_status: estadoMp, mp_status_detail: detalleMp })
    .eq("id", chk.id)
    .eq("estado", "pendiente");

  return { ok: true, estado: "registrado", mpStatus: estadoMp };
}

// ── Flujo legacy: la inscripción ya existía en estado pendiente ──────────────
// Solo alcanza a las preferencias emitidas ANTES de este cambio. No crea filas
// nuevas: únicamente marca como pagada/rechazada la que ya está.
async function procesarLegacy(id: string, pago: PagoMp, extRef: string): Promise<ResultadoPago> {
  const inscripcionId = extRef.slice(PREFIJO_EXT_REF_LEGACY.length);

  const { data: insc } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id, payment_id")
    .eq("id", inscripcionId)
    .maybeSingle();
  if (!insc) return ignorado("inscripcion_inexistente");
  if (insc.payment_id) return { ok: true, estado: "ya_aprobado", inscripcionId: insc.id };

  const estadoMp = String(pago.status || "");
  let estado_pago: string;
  if (estadoMp === "approved") estado_pago = "pagado";
  else if (estadoMp === "rejected" || estadoMp === "cancelled") estado_pago = "rechazado";
  else return { ok: true, estado: "registrado", mpStatus: estadoMp || "desconocido" };

  await supabaseAdmin
    .from("campeonato_inscripciones")
    .update({ estado_pago, payment_id: id, updated_at: new Date().toISOString() })
    .eq("id", inscripcionId)
    .is("payment_id", null);

  return estado_pago === "pagado"
    ? { ok: true, estado: "creado", inscripcionId: insc.id }
    : { ok: true, estado: "registrado", mpStatus: estadoMp };
}
