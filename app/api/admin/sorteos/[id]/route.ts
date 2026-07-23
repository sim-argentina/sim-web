import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import { pickFields, isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

const CAMPOS = [
  "titulo",
  "descripcion",
  "premio",
  "estado",
  "fecha_inicio",
  "fecha_fin",
  "condiciones",
  "imagen_url",
] as const;

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Sorteo no encontrado" }, { status: 404 });
    }

    const body = await req.json();

    // ── Restaurar (des-archivar): solo admin. ──
    if (body?.accion === "restaurar") {
      if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede restaurar sorteos" }, { status: 403 });
      const { data, error } = await supabaseAdmin
        .from("sorteos")
        .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/sorteos/[id] restaurar", error });
      if (!data) return NextResponse.json({ error: "Sorteo no encontrado" }, { status: 404 });
      logSecurityEvent("sorteo_restaurado", { id, role: auth.role });
      return NextResponse.json(data);
    }

    const updates: Record<string, unknown> = pickFields(body, CAMPOS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("sorteos")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/sorteos/[id]", error });
    if (!data) return NextResponse.json({ error: "Sorteo no encontrado" }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE: eliminación lógica (archivado). SOLO admin. Conserva la fila y todo su
// historial (participantes/ganador/config): solo la oculta de listados y de la
// parte pública, e impide nuevas inscripciones.
export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Sorteo no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("sorteos")
    .update({ deleted_at: new Date().toISOString(), deleted_by: auth.role, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/sorteos/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Sorteo no encontrado" }, { status: 404 });
  logSecurityEvent("sorteo_eliminado", { id, role: auth.role });
  return NextResponse.json({ ok: true });
}
