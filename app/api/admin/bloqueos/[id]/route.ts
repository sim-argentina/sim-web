import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// PATCH: activar/desactivar un bloqueo.
export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof body.activo !== "boolean") {
    return NextResponse.json(
      { error: "Sin campos válidos para actualizar" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("bloqueos_reservas")
    .update({ activo: body.activo })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error actualizando bloqueo" }, { status: 500 });
  }
  return NextResponse.json({ bloqueo: data });
}

// DELETE: eliminar un bloqueo. No toca reservas existentes (solo borra la regla).
export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("bloqueos_reservas")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Error eliminando bloqueo" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
