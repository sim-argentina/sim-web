import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { pickFields } from "@/lib/security";

const CAMPOS = ["nombre", "descripcion", "imagenes", "caracteristicas", "orden", "activo"] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json();
  const updates = pickFields(body, CAMPOS);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("tienda_productos")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "tienda/[id]", error });
  return NextResponse.json({ producto: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { error } = await supabaseAdmin.from("tienda_productos").delete().eq("id", id);
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "tienda/[id]", error });
  return NextResponse.json({ ok: true });
}
