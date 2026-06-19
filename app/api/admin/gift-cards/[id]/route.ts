import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";

// Actualiza el estado de uso / observaciones de una Gift Card.
// Disponible para admin y staff. No se elimina físicamente: se usan estados.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: nowIso };

  // Acciones que dependen de los usos actuales necesitan leer la fila.
  type UsosRow = { usos_totales: number; usos_disponibles: number };
  let fila: UsosRow | null = null;
  if (body.accion === "registrar_uso" || body.accion === "marcar_pendiente") {
    const { data } = await supabaseAdmin
      .from("gift_cards")
      .select("usos_totales, usos_disponibles")
      .eq("id", id)
      .maybeSingle();
    fila = (data as UsosRow | null) ?? null;
  }

  switch (body.accion) {
    case "registrar_uso": {
      // Descuenta un uso; cuando llega a 0, la gift card queda "usada".
      const disponibles = Math.max(0, (fila?.usos_disponibles ?? 1) - 1);
      updates.usos_disponibles = disponibles;
      updates.estado_uso = disponibles <= 0 ? "usada" : "pendiente";
      updates.fecha_uso = disponibles <= 0 ? nowIso : null;
      break;
    }
    case "marcar_usada":
      updates.estado_uso = "usada";
      updates.usos_disponibles = 0;
      updates.fecha_uso = nowIso;
      break;
    case "marcar_pendiente":
      updates.estado_uso = "pendiente";
      updates.usos_disponibles = fila?.usos_totales ?? 1;
      updates.fecha_uso = null;
      break;
    case "marcar_vencida":
      updates.estado_uso = "vencida";
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

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/gift-cards/[id]", error });
  return NextResponse.json({ ok: true });
}
