import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidDateStr } from "@/lib/security";

const MAX_DESC = 1000;

type RouteContext = { params: Promise<{ id: string }> };

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// PATCH: solo descripcion / fecha_limite / completado (anti mass-assignment).
export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const pid = parseId(id);
  if (pid === null) return NextResponse.json({ error: "Pendiente no encontrado" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ("descripcion" in body) {
    const desc = String(body.descripcion ?? "").trim();
    if (!desc) return NextResponse.json({ error: "La descripción es obligatoria" }, { status: 400 });
    if (desc.length > MAX_DESC) return NextResponse.json({ error: "La descripción es demasiado larga" }, { status: 400 });
    updates.descripcion = desc;
  }

  if ("fecha_limite" in body) {
    const v = body.fecha_limite;
    if (v === null || v === "" || v === undefined) updates.fecha_limite = null;
    else if (typeof v === "string" && isValidDateStr(v.trim())) updates.fecha_limite = v.trim();
    else return NextResponse.json({ error: "Fecha límite inválida (YYYY-MM-DD)" }, { status: 400 });
  }

  if (typeof body.completado === "boolean") {
    updates.completado = body.completado;
    updates.completado_at = body.completado ? new Date().toISOString() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin cambios válidos" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("pendientes")
    .update(updates)
    .eq("id", pid)
    .select()
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo actualizar el pendiente", { logContext: "pendientes PATCH", error });
  if (!data) return NextResponse.json({ error: "Pendiente no encontrado" }, { status: 404 });
  return NextResponse.json({ pendiente: data });
}

// DELETE: eliminación definitiva.
export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const pid = parseId(id);
  if (pid === null) return NextResponse.json({ error: "Pendiente no encontrado" }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from("pendientes")
    .delete()
    .eq("id", pid)
    .select("id")
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo eliminar el pendiente", { logContext: "pendientes DELETE", error });
  if (!data) return NextResponse.json({ error: "Pendiente no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
