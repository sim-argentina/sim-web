import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Procesador ÚNICO de pagos de Mensualidades (Bloque M3).
// Lo usan el webhook y la reconciliación desde la pantalla de resultado: la
// lógica crítica vive acá una sola vez. Nunca se confía en lo que llega en la
// notificación (status, importe, email, metadata, external_reference): todo se
// vuelve a consultar a Mercado Pago con las credenciales del servidor.
//
// NO depende de la feature flag: apagar la venta no puede dejar sin acreditar a
// alguien que ya pagó.

export const PREFIJO_EXT_REF = "mensualidad_";
const MONEDA = "ARS";
// Tolerancia de centavo para comparar importes en coma flotante devueltos por MP.
const EPSILON = 0.01;

export type ResultadoPago =
  | { ok: true; estado: "aplicado"; compraId: string; yaEstaba: boolean }
  | { ok: true; estado: "registrado"; compraId: string; mpStatus: string }
  | { ok: true; estado: "ignorado"; motivo: string }
  | { ok: false; motivo: string; status: number };

type FeeDetail = { type?: string; amount?: number; fee_payer?: string };

// Forma mínima del pago de Mercado Pago que este módulo necesita. Tenerla
// explícita permite testear TODA la verificación sin llamar a Mercado Pago.
export type PagoMp = {
  id?: string | number | null;
  status?: string | null;
  status_detail?: string | null;
  external_reference?: string | null;
  currency_id?: string | null;
  transaction_amount?: number | null;
  date_approved?: string | null;
  metadata?: Record<string, unknown> | null;
  fee_details?: FeeDetail[] | null;
  transaction_details?: { net_received_amount?: number | null } | null;
};

const ignorado = (motivo: string): ResultadoPago => ({ ok: true, estado: "ignorado", motivo });
const falla = (motivo: string, status = 400): ResultadoPago => ({ ok: false, motivo, status });

function clienteMp(): MercadoPagoConfig | null {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return null;
  return new MercadoPagoConfig({ accessToken });
}

// Bruto / comisión / neto REALES del pago. No se estima con un porcentaje fijo:
// se suman los cargos que paga el cobrador y se contrasta con el neto que informa
// Mercado Pago. Si MP no manda el neto, se deriva de bruto − comisión.
export function calcularMontos(pago: {
  transaction_amount?: number | null;
  fee_details?: FeeDetail[] | null;
  transaction_details?: { net_received_amount?: number | null } | null;
}): { bruto: number; comision: number; neto: number } {
  const bruto = Number(pago.transaction_amount) || 0;

  const fees = Array.isArray(pago.fee_details) ? pago.fee_details : [];
  // fee_payer 'collector' = lo paga SIM. Si MP no lo informa, se asume nuestro
  // (es el caso normal de una venta) para no subestimar la comisión.
  const comision = fees
    .filter((f) => !f?.fee_payer || f.fee_payer === "collector")
    .reduce((acc, f) => acc + (Number(f?.amount) || 0), 0);

  const netoInformado = Number(pago.transaction_details?.net_received_amount);
  const neto = Number.isFinite(netoInformado) && netoInformado > 0
    ? netoInformado
    : bruto - comision;

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return { bruto: round2(bruto), comision: round2(comision), neto: round2(neto) };
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
// El webhook puede tardar o perderse. Desde la pantalla de resultado se puede
// pedir que el SERVIDOR le pregunte a Mercado Pago por los pagos de esta compra.
// El cliente nunca indica qué payment_id acreditar: solo tiene el token, y el id
// se descubre buscando por external_reference. Después pasa por exactamente el
// mismo procesador que el webhook.
export async function reconciliarCompra(externalReference: string): Promise<ResultadoPago | null> {
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

  // Si hay uno aprobado, es el que importa; si no, el más reciente.
  const aprobado = encontrados.find((p) => p.status === "approved");
  const elegido = aprobado ?? [...encontrados].sort((a, b) =>
    String(b.date_created ?? "").localeCompare(String(a.date_created ?? ""))
  )[0];
  if (!elegido?.id) return null;

  return procesarPagoMensualidad(String(elegido.id));
}

// ── Procesamiento central ───────────────────────────────────────────────────
// Devuelve 'ignorado' cuando el pago no es de Mensualidades (el webhook responde
// 200 igual: no es un error, simplemente no es nuestro).
export async function procesarPagoMensualidad(paymentId: string): Promise<ResultadoPago> {
  const id = String(paymentId || "").trim();
  if (!id) return falla("payment_id_ausente", 400);

  const client = clienteMp();
  if (!client) return falla("servicio_no_disponible", 500);

  // La verdad la tiene Mercado Pago, consultada con NUESTRAS credenciales: nada
  // de lo que venga en la notificación se usa como dato.
  let pago: PagoMp;
  try {
    pago = (await new Payment(client).get({ id })) as PagoMp;
  } catch {
    return falla("pago_no_consultable", 502);
  }
  return procesarPagoVerificado(id, pago);
}

// Verificación + aplicación sobre un pago YA traído de Mercado Pago. Separada
// para que los tests puedan ejercitar todas las validaciones sin red.
export async function procesarPagoVerificado(id: string, pago: PagoMp): Promise<ResultadoPago> {
  // 2) ¿Es nuestro? El prefijo de external_reference separa productos.
  const extRef = String(pago.external_reference || "");
  if (!extRef.startsWith(PREFIJO_EXT_REF)) return ignorado("otro_producto");

  // 3) La compra tiene que existir en nuestra base.
  const { data: compra, error } = await supabaseAdmin
    .from("mensualidad_compras")
    .select("id, plan_precio, procesamiento, estado_pago, mp_payment_id, external_reference")
    .eq("external_reference", extRef)
    .maybeSingle();
  if (error) return falla("error_leyendo_compra", 500);
  if (!compra) return ignorado("compra_inexistente");

  // 4) Metadata: si viene, tiene que ser coherente. Nunca reemplaza lo persistido.
  const meta = (pago.metadata ?? {}) as Record<string, unknown>;
  const metaProducto = meta.producto ?? meta.Producto;
  if (metaProducto && String(metaProducto) !== "mensualidad") {
    return falla("metadata_producto_invalida", 409);
  }
  const metaCompra = meta.compra_id ?? meta.compraId;
  if (metaCompra && String(metaCompra) !== compra.id) {
    return falla("metadata_compra_invalida", 409);
  }

  // 5) Moneda e importe contra el SNAPSHOT (no contra el catálogo, que puede haber
  //    cambiado después de crear la preferencia).
  if (String(pago.currency_id || "") !== MONEDA) return falla("moneda_invalida", 409);

  const montos = calcularMontos(pago);
  const esperado = Number(compra.plan_precio);
  if (!Number.isFinite(esperado) || Math.abs(montos.bruto - esperado) > EPSILON) {
    return falla("importe_no_coincide", 409);
  }

  const estadoMp = String(pago.status || "desconocido");
  const detalleMp = pago.status_detail ? String(pago.status_detail) : null;

  // 6) Aprobado → acreditar por la ÚNICA vía atómica que existe.
  if (estadoMp === "approved") {
    const yaEstaba = compra.procesamiento === "aplicado";
    const { error: rpcError } = await supabaseAdmin.rpc("mensualidad_aplicar_compra", {
      p_external_reference: extRef,
      p_mp_payment_id: id,
      p_importe_bruto: montos.bruto,
      p_comision_mp: montos.comision,
      p_importe_neto: montos.neto,
      p_aprobado_at: pago.date_approved || new Date().toISOString(),
    });
    if (rpcError) {
      // 23505 = ese payment_id ya pertenece a otra compra (error controlado de M2).
      const code = (rpcError as { code?: string }).code;
      if (code === "23505") return falla("payment_id_de_otra_compra", 409);
      return falla("no_se_pudo_aplicar", 500);
    }
    await supabaseAdmin
      .from("mensualidad_compras")
      .update({ mp_status: estadoMp, mp_status_detail: detalleMp })
      .eq("id", compra.id);
    return { ok: true, estado: "aplicado", compraId: compra.id, yaEstaba };
  }

  // 7) Pendiente / rechazado / cancelado: se registra el estado real y NADA MÁS.
  //    estado_pago sigue en 'pendiente' a propósito: la preferencia se puede
  //    volver a pagar y ese pago posterior tiene que poder acreditarse.
  await supabaseAdmin
    .from("mensualidad_compras")
    .update({ mp_status: estadoMp, mp_status_detail: detalleMp })
    .eq("id", compra.id);

  return { ok: true, estado: "registrado", compraId: compra.id, mpStatus: estadoMp };
}
