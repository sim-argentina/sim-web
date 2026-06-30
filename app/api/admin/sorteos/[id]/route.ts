import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
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
