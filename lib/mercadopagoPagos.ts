// Persistencia de la conciliación financiera de los cobros web de Mercado Pago.
//
// El cálculo puro vive en @/lib/mercadopagoPagosCalculo (sin DB, testeable sin
// credenciales) y se re-exporta acá para no cambiar ningún import existente.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filaPagoWeb, type FilaPagoWeb, type OrigenRegistro, type PagoMpFinanzas, type ProductoWeb } from "@/lib/mercadopagoPagosCalculo";

export * from "@/lib/mercadopagoPagosCalculo";


// Guarda (o actualiza) la foto financiera de un pago web. Idempotente por
// payment_id: reprocesar el mismo webbook o correr el backfill dos veces deja
// exactamente la misma fila, nunca una duplicada ni un cargo sumado dos veces.
//
// NO toca ninguna tabla operativa: no crea inscripciones, no cambia estados, no
// consume cupos. Es solo el registro contable del pago.
export async function registrarPagoWeb(
  paymentId: string,
  producto: ProductoWeb,
  pago: PagoMpFinanzas,
  origen: OrigenRegistro
): Promise<{ ok: true; fila: FilaPagoWeb } | { ok: false; motivo: string }> {
  const id = String(paymentId || "").trim();
  if (!id) return { ok: false, motivo: "payment_id_ausente" };

  const fila = filaPagoWeb(id, producto, pago, origen);
  const { error } = await supabaseAdmin
    .from("fin_pagos_web")
    .upsert({ ...fila, updated_at: new Date().toISOString() }, { onConflict: "payment_id" });
  if (error) return { ok: false, motivo: error.message };
  return { ok: true, fila };
}

// Versión para los webhooks: registrar la comisión NUNCA puede romper la
// confirmación de una compra. Si falla, se loguea y el pago queda sin conciliar
// (visible como advertencia en Finanzas), pero el cliente igual recibe su compra.
export async function registrarPagoWebSeguro(
  paymentId: string,
  producto: ProductoWeb,
  pago: PagoMpFinanzas,
  origen: OrigenRegistro
): Promise<void> {
  try {
    const r = await registrarPagoWeb(paymentId, producto, pago, origen);
    if (!r.ok) console.error(`[fin_pagos_web] ${producto} ${paymentId}: ${r.motivo}`);
  } catch (e) {
    console.error(`[fin_pagos_web] ${producto} ${paymentId}:`, e instanceof Error ? e.message : e);
  }
}
