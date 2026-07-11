import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { esFechaValida } from "@/lib/colectivo";

const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const CAMPOS_EDITABLES = [
  "nombre", "hora_inicio", "hora_fin", "localidad", "provincia",
  "ubicacion", "organizador", "telefono_contacto", "observaciones",
] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const { data: evento, error } = await supabaseAdmin.from("colectivo_eventos").select("*").eq("id", id).maybeSingle();
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos/[id] GET", error });
  if (!evento) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
  return NextResponse.json({ evento });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const { data: actual } = await supabaseAdmin.from("colectivo_eventos").select("estado").eq("id", id).maybeSingle();
  if (!actual) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const accion = typeof body.accion === "string" ? body.accion : null;

  // ── Transiciones de estado ──────────────────────────────────────────────────
  if (accion) {
    let updates: Record<string, unknown> | null = null;
    if (accion === "activar") updates = { estado: "activo" };
    else if (accion === "finalizar") updates = { estado: "finalizado", finalizado_at: new Date().toISOString() };
    else if (accion === "reabrir") {
      if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede reabrir eventos" }, { status: 403 });
      updates = { estado: "activo", finalizado_at: null };
    } else if (accion === "cancelar") {
      if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede cancelar eventos" }, { status: 403 });
      updates = { estado: "cancelado" };
    } else {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("colectivo_eventos").update(updates).eq("id", id);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos/[id] accion", error });
    return NextResponse.json({ ok: true });
  }

  // ── Edición de campos: no permitida en eventos finalizados sin reabrir ──────
  if (actual.estado === "finalizado") {
    return NextResponse.json({ error: "El evento está finalizado. Reabrilo para editarlo." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) updates[campo] = txt(body[campo]);
  }
  if ("nombre" in updates && !updates.nombre) {
    return NextResponse.json({ error: "El nombre del evento es obligatorio" }, { status: 400 });
  }
  if (esFechaValida(body.fecha_inicio)) updates.fecha_inicio = body.fecha_inicio;
  if (esFechaValida(body.fecha_fin)) updates.fecha_fin = body.fecha_fin;
  const fi = (updates.fecha_inicio as string) ?? null;
  const ff = (updates.fecha_fin as string) ?? null;
  if (fi && ff && ff < fi) {
    return NextResponse.json({ error: "La fecha de finalización no puede ser anterior a la de inicio" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin.from("colectivo_eventos").update(updates).eq("id", id);
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos/[id] PATCH", error });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede eliminar eventos" }, { status: 403 });
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  // Solo se puede eliminar si no tiene información asociada.
  const [{ count: turnos }, { count: ventas }] = await Promise.all([
    supabaseAdmin.from("colectivo_turnos").select("id", { count: "exact", head: true }).eq("evento_id", id),
    supabaseAdmin.from("colectivo_ventas").select("id", { count: "exact", head: true }).eq("evento_id", id),
  ]);
  if ((turnos ?? 0) > 0 || (ventas ?? 0) > 0) {
    return NextResponse.json({ error: "El evento tiene turnos o ventas asociados. No se puede eliminar." }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from("colectivo_eventos").delete().eq("id", id);
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos/[id] DELETE", error });
  return NextResponse.json({ ok: true });
}
