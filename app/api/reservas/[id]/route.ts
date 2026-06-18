import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";

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

    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
