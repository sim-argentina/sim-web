import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

// Reabrir una fecha cerrada (SOLO admin): vuelve a "abierta" y limpia la auditoría
// de cierre. NO borra las penalizaciones generadas (se preservan para auditoría);
// si luego se vuelve a cerrar, el cierre recomputa de forma idempotente.
export async function POST(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Fecha no encontrada" }, { status: 404 });
    }

    const { data: fecha, error: fErr } = await supabaseAdmin
      .from("campeonato_fechas")
      .select("id, estado")
      .eq("id", id)
      .maybeSingle();
    if (fErr)
      return failResponse(500, "No se pudo completar la operación", { logContext: "reabrir load", error: fErr });
    if (!fecha) return NextResponse.json({ error: "Fecha no encontrada" }, { status: 404 });

    if (fecha.estado !== "cerrada") {
      return NextResponse.json({ ok: true, ya_abierta: true, mensaje: "La fecha ya estaba abierta." });
    }

    const { error } = await supabaseAdmin
      .from("campeonato_fechas")
      .update({ estado: "abierta", cerrado_at: null, cerrado_por: null })
      .eq("id", id);
    if (error)
      return failResponse(500, "No se pudo completar la operación", { logContext: "reabrir update", error });

    return NextResponse.json({
      ok: true,
      reabierta: true,
      mensaje:
        "Fecha reabierta. Las penalizaciones generadas se mantienen; al volver a cerrar se recalculan (no se duplican).",
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
