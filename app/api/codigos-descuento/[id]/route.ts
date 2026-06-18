import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { pickFields } from "@/lib/security";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const CAMPOS = [
  "descripcion",
  "tipo_descuento",
  "valor_descuento",
  "usos_maximos",
  "fecha_inicio",
  "fecha_fin",
  "creado_para",
  "activo",
] as const;

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json();

  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const updates = pickFields(body, CAMPOS);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("codigos_descuento")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error actualizando código" }, { status: 500 });
  }

  return NextResponse.json({ codigo: data });
}
