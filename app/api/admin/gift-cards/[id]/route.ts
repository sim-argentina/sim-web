import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Actualiza el estado de uso / observaciones de una Gift Card.
// Disponible para admin y staff. No se elimina físicamente: se usan estados.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const role = cookieStore.get("sim-admin-role")?.value;
  if (!role) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  switch (body.accion) {
    case "marcar_usada":
      updates.estado_uso = "usada";
      updates.fecha_uso = new Date().toISOString();
      break;
    case "marcar_pendiente":
      updates.estado_uso = "pendiente";
      updates.fecha_uso = null;
      break;
    case "marcar_cancelada":
      updates.estado_uso = "cancelada";
      break;
    case "observaciones":
      updates.observaciones =
        typeof body.observaciones === "string" ? body.observaciones : null;
      break;
    default:
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("gift_cards")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
