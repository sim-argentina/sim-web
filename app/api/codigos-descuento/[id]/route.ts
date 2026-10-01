import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { pickFields } from "@/lib/security";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { prepararDuracionesEdicion } from "@/lib/codigosComercial";

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
  "solo_dias_habiles",
  "dias_permitidos",
  "fechas_bloqueadas",
  "duraciones_permitidas",
  "activo",
] as const;

export async function PATCH(req: Request, { params }: RouteContext) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // Body malformado → null; pickFields lo trata como vacío y responde 400 abajo.
  const body = await req.json().catch(() => null);

  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const updates = pickFields(body, CAMPOS);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
  }

  // (B9) Solo si se editan las duraciones: valen las de la oferta vigente más las
  // que el código ya tenía (una duración legacy se conserva). Editar cualquier
  // otro campo no las toca.
  if ("duraciones_permitidas" in updates) {
    const { data: actual, error: errorLectura } = await supabaseAdmin
      .from("codigos_descuento").select("duraciones_permitidas").eq("id", id).maybeSingle();
    if (errorLectura) return NextResponse.json({ error: "Error actualizando código" }, { status: 500 });
    if (!actual) return NextResponse.json({ error: "Código no encontrado" }, { status: 404 });
    const duraciones = await prepararDuracionesEdicion(updates.duraciones_permitidas, actual.duraciones_permitidas);
    if (!duraciones.ok) {
      return NextResponse.json({ error: duraciones.error, codigo: duraciones.codigo }, { status: duraciones.status });
    }
    updates.duraciones_permitidas = duraciones.duraciones;
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

export async function DELETE(req: Request, { params }: RouteContext) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  // Soft delete: oculta el código de la lista sin romper la auditoría de usos
  // (FK usos_codigos_descuento.codigo_id) ni borrar registros históricos.
  const { error } = await supabaseAdmin
    .from("codigos_descuento")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Error eliminando código" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
