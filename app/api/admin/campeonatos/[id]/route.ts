import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import { pickFields, isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

const CAMPOS = [
  "nombre",
  "descripcion",
  "estado",
  "fecha_inicio",
  "fecha_fin",
  "precio_inscripcion",
  "cupos_maximos",
  "inscripcion_habilitada",
  "categorias",
  "imagen_url",
] as const;

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });
    }

    const body = await req.json();

    // ── Restaurar (des-archivar): solo admin. Limpia deleted_at/deleted_by. ──
    if (body?.accion === "restaurar") {
      if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede restaurar campeonatos" }, { status: 403 });
      const { data, error } = await supabaseAdmin
        .from("campeonatos")
        .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/[id] restaurar", error });
      if (!data) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });
      logSecurityEvent("campeonato_restaurado", { id, role: auth.role });
      return NextResponse.json(data);
    }

    const updates: Record<string, unknown> = pickFields(body, CAMPOS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("campeonatos")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/[id]", error });
    if (!data) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE: eliminación lógica (archivado). SOLO admin. No borra la fila ni sus
// hijos (fechas, inscripciones, registros, penalizaciones): solo la marca como
// eliminada para ocultarla de listados y bloquear nuevas inscripciones. Todo el
// historial (rankings, tiempos, pagos) se conserva.
export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("campeonatos")
    .update({ deleted_at: new Date().toISOString(), deleted_by: auth.role, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });
  logSecurityEvent("campeonato_eliminado", { id, role: auth.role });
  return NextResponse.json({ ok: true });
}
