// ============================================================================
// Confirmación de una Reserva web pagada (Bloque B3). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Es el núcleo del webhook de Mercado Pago para Reservas, separado de la
// verificación de firma y de la consulta del pago para poder probarlo.
//
// Reglas:
//   · Los slots salen de la modalidad GUARDADA en la reserva, nunca de la
//     vigente: una reserva legacy creada el 30/09 23:55 y pagada el 01/10 00:05
//     sigue siendo legacy (mismos bloques, mismo precio, misma duración).
//   · Una reserva NUNCA queda 'activa' sin TODOS sus slots. Si la base los
//     rechaza —ocupado (23505), bloqueado (23514) o cualquier otro error— queda
//     en 'conflicto_pago' con su payment_id: pagada, sin turno, identificable
//     para resolverla desde la administración. No hay reembolso automático.
//   · Idempotente: una segunda notificación del mismo pago no duplica slots, ni
//     la reserva, ni Finanzas, ni cambia la modalidad.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filasSlotsReserva } from "@/lib/reservasSlots";
import { consumirCodigoDescuento } from "@/lib/codigosDescuento";
import { logSecurityEvent } from "@/lib/apiError";
import { registrarPagoWebSeguro, type PagoMpFinanzas } from "@/lib/mercadopagoPagos";

export const ESTADO_CONFLICTO_PAGO = "conflicto_pago";

export type MotivoConflicto = "ocupado" | "bloqueado" | "error_slots" | "sin_turno";

export type ResultadoPagoReserva = {
  http: number;
  body: Record<string, unknown>;
  /** Estado en que quedó la reserva si esta llamada la resolvió. */
  estado?: string;
  motivo?: MotivoConflicto;
};

/** Por qué la base no aceptó los slots. */
export function motivoDeError(error: { code?: string } | null): MotivoConflicto {
  if (error?.code === "23505") return "ocupado";
  if (error?.code === "23514") return "bloqueado";
  return "error_slots";
}

type Deps = {
  registrarPago?: typeof registrarPagoWebSeguro;
  consumirCodigo?: typeof consumirCodigoDescuento;
};

/**
 * Procesa un pago APROBADO de la reserva `reservaId`. Devuelve la respuesta
 * HTTP que tiene que dar el webhook. Con 500 no toca la reserva y Mercado Pago
 * reintenta; el pago ya registrado en Finanzas es idempotente por payment_id.
 */
export async function procesarPagoAprobadoReserva(args: {
  reservaId: number;
  paymentId: string;
  paymentData: PagoMpFinanzas;
  deps?: Deps;
}): Promise<ResultadoPagoReserva> {
  const { reservaId } = args;
  const paymentId = String(args.paymentId);
  const registrarPago = args.deps?.registrarPago ?? registrarPagoWebSeguro;
  const consumirCodigo = args.deps?.consumirCodigo ?? consumirCodigoDescuento;

  const { data: reserva, error: reservaError } = await supabaseAdmin
    .from("reservas")
    .select("*")
    .eq("id", reservaId)
    .maybeSingle();
  if (reservaError || !reserva) {
    return { http: 404, body: { error: "No se encontró la reserva" } };
  }

  // Idempotencia: si ya tiene payment_id, ya se procesó.
  if (reserva.mercado_pago_payment_id) {
    return { http: 200, body: { received: true } };
  }

  // Cargos reales de Checkout Pro. Idempotente por payment_id y aislado: si
  // falla, el pago queda como "comisión no disponible" en Finanzas.
  await registrarPago(paymentId, "reservas_online", args.paymentData, "webhook");

  // Slots por la modalidad GUARDADA. Un reintento puede encontrar los slots de
  // un intento anterior que no llegó a marcar la reserva: el insert es una sola
  // sentencia, así que están todos o ninguno.
  let estadoFinal = "activa";
  let motivo: MotivoConflicto | undefined;
  let filas: ReturnType<typeof filasSlotsReserva> = [];
  try {
    filas = filasSlotsReserva(reserva);
  } catch {
    filas = [];
  }

  if (filas.length === 0) {
    // Sin simuladores o con datos que no se pueden ubicar: no hay turno que tomar.
    estadoFinal = ESTADO_CONFLICTO_PAGO;
    motivo = "sin_turno";
  } else {
    const { count, error: countError } = await supabaseAdmin
      .from("reserva_slots")
      .select("id", { count: "exact", head: true })
      .eq("reserva_id", reservaId)
      .eq("estado", "activa");
    if (countError) {
      return { http: 500, body: { error: "No se pudo verificar el turno" } };
    }
    if ((count ?? 0) !== filas.length) {
      if ((count ?? 0) > 0) {
        // Restos parciales que no deberían existir: se limpian y se inserta completo.
        await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", reservaId).eq("estado", "activa");
      }
      const { error: slotErr } = await supabaseAdmin.from("reserva_slots").insert(filas);
      if (slotErr) {
        // Dos notificaciones del mismo pago a la vez: la segunda choca con los
        // slots que acaba de crear la primera. Si están TODOS los de esta
        // reserva, no hay conflicto con nadie.
        const { count: propios } = await supabaseAdmin
          .from("reserva_slots")
          .select("id", { count: "exact", head: true })
          .eq("reserva_id", reservaId)
          .eq("estado", "activa");
        if ((propios ?? 0) !== filas.length) {
          estadoFinal = ESTADO_CONFLICTO_PAGO;
          motivo = motivoDeError(slotErr as { code?: string });
          if (motivo === "error_slots") console.error("reserva_slots insert error:", slotErr.message);
        }
      }
    }
  }

  if (motivo) logSecurityEvent("reserva_conflicto_pago", { reservaId, motivo });

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("reservas")
    .update({ estado: estadoFinal, mercado_pago_payment_id: paymentId })
    .eq("id", reservaId)
    .is("mercado_pago_payment_id", null)
    .select("id");
  if (updateError) {
    return { http: 500, body: { error: "Error actualizando reserva" } };
  }

  // Consumir el código solo si esta llamada activó realmente la reserva.
  if (estadoFinal === "activa" && updated && updated.length > 0 && reserva.codigo_descuento) {
    await consumirCodigo(reserva.codigo_descuento, {
      reserva_id: reserva.id,
      nombre: reserva.nombre,
      telefono: reserva.telefono,
      fecha_reserva: reserva.fecha,
      hora_reserva: reserva.hora,
      total_original: reserva.total_original,
      descuento_aplicado: reserva.descuento_aplicado,
      total_final: reserva.total,
      mercado_pago_payment_id: paymentId,
    });
  }

  return { http: 200, body: { received: true }, estado: estadoFinal, motivo };
}
