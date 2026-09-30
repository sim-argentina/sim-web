// ============================================================================
// Cancelar o reactivar una Reserva desde la administración (Bloque B3).
// SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Cancelar: estado 'cancelada' y se liberan TODOS sus slots. En v2 el buffer
// vive dentro de la misma fila (ocupacion_min), así que también se libera.
// No cambia duracion_minutos ni la modalidad.
//
// Reactivar, en este orden y sin atajos:
//   1. verificar disponibilidad con el motor B2 (sin contarse a sí misma);
//   2. crear TODOS los slots en UNA sentencia: entran todos o ninguno;
//   3. recién entonces marcar 'activa', y solo si el estado no cambió en el
//      medio. Si no se pudo, se borran los slots recién creados.
// Si algo falla, la reserva conserva su estado y no quedan slots parciales.
// Los slots salen de SU modalidad guardada: una legacy reactivada después del
// corte sigue legacy; una v2 sigue v2. Una 'conflicto_pago' (pagada, sin turno)
// que se logra activar consume además el código que el webhook no consumió.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSecurityEvent } from "@/lib/apiError";
import { filasSlotsReserva } from "@/lib/reservasSlots";
import { modalidadDeReserva } from "@/lib/disponibilidadIntervalos";
import type { ProductoAgenda } from "@/lib/agendaIntervalos";
import { evaluarTurno } from "@/lib/reservasComercial";
import { ESTADO_CONFLICTO_PAGO, motivoDeError } from "@/lib/reservasWebhook";
import { consumirCodigoDescuento } from "@/lib/codigosDescuento";

export type ResultadoEstado =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; motivo?: string };

const fallo = (status: number, error: string, motivo?: string): ResultadoEstado => ({ ok: false, status, error, motivo });

/** Con qué reglas de grilla se valida el turno de una reserva existente. */
function productoDe(origen: unknown): ProductoAgenda {
  if (origen === "mensualidad") return "mensualidad";
  if (origen === "empresa") return "empresa";
  return "reserva";
}

async function contarSlotsActivos(id: number): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("reserva_slots")
    .select("id", { count: "exact", head: true })
    .eq("reserva_id", id)
    .eq("estado", "activa");
  return error ? null : count ?? 0;
}

export async function cambiarEstadoReserva(
  id: number,
  nuevoEstado: "activa" | "cancelada",
  opts: { ahora?: Date; consumirCodigo?: typeof consumirCodigoDescuento } = {},
): Promise<ResultadoEstado> {
  const { data: reserva, error: leerError } = await supabaseAdmin
    .from("reservas")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (leerError) return fallo(500, "No se pudo actualizar la reserva");
  if (!reserva) return fallo(404, "La reserva no existe.");

  // Una reserva reembolsada es terminal: la baja de cupo ya la hizo el reembolso.
  if (reserva.estado === "reembolsada") {
    return fallo(409, "La reserva está reembolsada y no puede modificarse.");
  }

  if (nuevoEstado === "cancelada") {
    const { data, error } = await supabaseAdmin
      .from("reservas")
      .update({ estado: "cancelada" })
      .eq("id", id)
      .select()
      .single();
    if (error || !data) return fallo(500, "No se pudo actualizar la reserva");
    const { error: slotErr } = await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", id);
    if (slotErr) console.error("reserva_slots cancelación:", slotErr.message);
    return { ok: true, data };
  }

  // ── Reactivar ─────────────────────────────────────────────────────────────
  let filas: ReturnType<typeof filasSlotsReserva>;
  try {
    filas = filasSlotsReserva(reserva);
  } catch {
    filas = [];
  }
  if (filas.length === 0) {
    logSecurityEvent("reserva_reactivacion_rechazada", { reservaId: id, motivo: "sin_turno" });
    return fallo(409, "La reserva no tiene un turno válido para reactivar.", "sin_turno");
  }

  // Ya activa y con todos sus slots: no hay nada que hacer.
  const actuales = await contarSlotsActivos(id);
  if (actuales === null) return fallo(500, "No se pudo verificar el turno de la reserva.");
  if (reserva.estado === "activa" && actuales === filas.length) return { ok: true, data: reserva };

  // 1) Disponibilidad con el motor, por SU modalidad, sin contarse a sí misma.
  const simuladores = Array.isArray(reserva.simuladores) ? reserva.simuladores.map((s: unknown) => String(s)) : [];
  const veredicto = await evaluarTurno({
    modalidad: modalidadDeReserva(reserva.modalidad),
    producto: productoDe(reserva.origen),
    fecha: reserva.fecha,
    hora: reserva.hora,
    duracion: Number(reserva.duracion_minutos) || 15,
    simuladores,
    excluirReservaId: id,
    ahora: opts.ahora,
  });
  if (veredicto.bloqueado) {
    logSecurityEvent("reserva_reactivacion_rechazada", { reservaId: id, motivo: "bloqueado" });
    return fallo(409, "Ese horario está bloqueado: la reserva no se reactivó.", "bloqueado");
  }
  if (veredicto.ocupado) {
    logSecurityEvent("reserva_reactivacion_rechazada", { reservaId: id, motivo: "ocupado" });
    return fallo(409, "El turno ya no está disponible: la reserva no se reactivó.", "ocupado");
  }

  // 2) Todos los slots en una sentencia (primero se limpian restos propios).
  if (actuales > 0) {
    const { error } = await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", id);
    if (error) return fallo(500, "No se pudo preparar el turno de la reserva.");
  }
  const { error: slotErr } = await supabaseAdmin.from("reserva_slots").insert(filas);
  if (slotErr) {
    const motivo = motivoDeError(slotErr as { code?: string });
    logSecurityEvent("reserva_reactivacion_rechazada", { reservaId: id, motivo });
    if (motivo === "error_slots") {
      console.error("reserva_slots reactivación:", slotErr.message);
      return fallo(500, "No se pudo reservar el turno: la reserva no se reactivó.", motivo);
    }
    return fallo(409, motivo === "bloqueado"
      ? "Ese horario está bloqueado: la reserva no se reactivó."
      : "El turno ya no está disponible: la reserva no se reactivó.", motivo);
  }

  // 3) Recién ahora, 'activa'; solo si el estado sigue siendo el que se leyó.
  const { data, error: updError } = await supabaseAdmin
    .from("reservas")
    .update({ estado: "activa" })
    .eq("id", id)
    .eq("estado", reserva.estado)
    .select();
  if (updError || !data || data.length === 0) {
    const { error: deshacer } = await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", id);
    if (deshacer) console.error("reserva_slots reactivación (deshacer):", deshacer.message);
    logSecurityEvent("reserva_reactivacion_rechazada", { reservaId: id, motivo: "estado_cambiado" });
    return fallo(409, "La reserva cambió mientras se reactivaba. Volvé a intentarlo.", "estado_cambiado");
  }

  // 4) Una reserva PAGADA que el webhook dejó sin turno recién ahora queda
  // confirmada: se completa lo único que el webhook no hizo, consumir el código
  // de descuento (el webhook solo lo consume al activar). Best-effort, como
  // allá: la reserva ya está paga y activa.
  if (reserva.estado === ESTADO_CONFLICTO_PAGO && reserva.codigo_descuento && reserva.mercado_pago_payment_id) {
    const consumir = opts.consumirCodigo ?? consumirCodigoDescuento;
    const consumido = await consumir(reserva.codigo_descuento, {
      reserva_id: reserva.id,
      nombre: reserva.nombre,
      telefono: reserva.telefono,
      fecha_reserva: reserva.fecha,
      hora_reserva: reserva.hora,
      total_original: reserva.total_original,
      descuento_aplicado: reserva.descuento_aplicado,
      total_final: reserva.total,
      mercado_pago_payment_id: reserva.mercado_pago_payment_id,
    });
    if (!consumido) logSecurityEvent("reserva_codigo_no_consumido", { reservaId: id });
  }
  return { ok: true, data: data[0] };
}
