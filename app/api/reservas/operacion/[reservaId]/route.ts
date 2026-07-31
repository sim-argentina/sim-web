import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";

const HORA_RE = /^\d{1,2}:\d{2}$/;

// Sanitiza una hora "HH:MM". Cadena vacía o inválida → null (borra el valor).
function horaONull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return HORA_RE.test(s) ? s : null;
}

// PATCH: guarda SOLO datos operativos (hora_subida / hora_bajada / listo) de una
// reserva en reserva_operacion. Nunca modifica la fila de `reservas` (cliente,
// hora, duración, pago, estado, etc.) ni crea filas en turnos_stand.
// Disponible para admin y staff (misma operación que hora subida/bajada del stand).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ reservaId: string }> }
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { reservaId } = await params;
  const id = Number(reservaId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // La reserva debe existir y estar confirmada (activa). No se opera sobre
  // reservas canceladas / pendientes de pago.
  const { data: reserva } = await supabaseAdmin
    .from("reservas")
    .select("id, estado")
    .eq("id", id)
    .maybeSingle();
  if (!reserva || reserva.estado !== "activa") {
    return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  }

  const cambios: Record<string, unknown> = { reserva_id: id, updated_at: new Date().toISOString() };
  if ("hora_subida" in body) cambios.hora_subida = horaONull(body.hora_subida);
  if ("hora_bajada" in body) cambios.hora_bajada = horaONull(body.hora_bajada);
  if (typeof body.listo === "boolean") cambios.listo = body.listo;

  // Upsert 1:1: en el primer guardado inserta; luego actualiza solo los campos
  // provistos (los demás conservan su valor por ON CONFLICT DO UPDATE).
  const { error } = await supabaseAdmin
    .from("reserva_operacion")
    .upsert(cambios, { onConflict: "reserva_id" });

  if (error) {
    return failResponse(500, "No se pudo guardar la operación de la reserva", {
      logContext: "reservas/operacion/[reservaId] PATCH",
      error,
    });
  }

  return NextResponse.json({ ok: true });
}
