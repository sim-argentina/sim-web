import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { registrarFinLog } from "@/lib/finanzas";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const patch: Record<string, unknown> = {};

  if (body.nombre !== undefined) {
    const nombre = String(body.nombre).trim().slice(0, 80);
    if (!nombre) return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
    patch.nombre = nombre;
  }
  if (body.activa !== undefined) patch.activa = Boolean(body.activa);
  if (body.orden !== undefined) patch.orden = Number(body.orden) || 0;
  if (body.color !== undefined) patch.color = body.color ? String(body.color).slice(0, 20) : null;
  if (body.descripcion !== undefined) {
    patch.descripcion = body.descripcion ? String(body.descripcion).slice(0, 300) : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_categorias")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return failResponse(500, "Error actualizando categoría", {
      logContext: "finanzas categorias PUT",
      error,
    });
  }
  if (!data) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

  await registrarFinLog("editar", "fin_categorias", id, patch, auth.role);
  return NextResponse.json({ categoria: data });
}
