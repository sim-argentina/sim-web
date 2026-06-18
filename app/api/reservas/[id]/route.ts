import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { getOccupiedSlots } from "@/lib/reservasSlots";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ESTADOS_PERMITIDOS = new Set(["activa", "cancelada"]);

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "ID de reserva inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const nuevoEstado = body?.estado ?? "cancelada";

    if (!ESTADOS_PERMITIDOS.has(nuevoEstado)) {
      return NextResponse.json({ error: "Estado no permitido" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("reservas")
      .update({ estado: nuevoEstado })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "No se pudo actualizar la reserva" }, { status: 500 });
    }

    // Mantener reserva_slots en sync: cancelar libera el turno; reactivar lo vuelve a tomar.
    if (nuevoEstado === "cancelada") {
      await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", id);
    } else if (nuevoEstado === "activa" && data) {
      const sims: string[] = Array.isArray(data.simuladores)
        ? data.simuladores.map((s: unknown) => String(s))
        : [];
      const dur = Number(data.duracion_minutos) || 15;
      const rows = getOccupiedSlots(data.fecha, data.hora, dur).flatMap((slot) =>
        sims.map((sim) => ({
          reserva_id: Number(id),
          fecha: data.fecha,
          hora: slot,
          simulador: sim,
          estado: "activa",
        }))
      );
      await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", id);
      if (rows.length > 0) {
        const { error: slotErr } = await supabaseAdmin.from("reserva_slots").insert(rows);
        if (slotErr) console.error("reserva_slots reactivación:", slotErr.message);
      }
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
