import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { CLASIFICACIONES, TIPOS_MOVIMIENTO, registrarFinLog } from "@/lib/finanzas";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const patch: Record<string, unknown> = {};

  if (body.keyword !== undefined) {
    const keyword = String(body.keyword).trim().toLowerCase().slice(0, 60);
    if (keyword.length < 2) return NextResponse.json({ error: "Keyword inválida" }, { status: 400 });
    patch.keyword = keyword;
  }
  if (body.ambito !== undefined) {
    const ambito = body.ambito ? String(body.ambito).trim() : null;
    if (ambito && !["sim", "personal"].includes(ambito)) {
      return NextResponse.json({ error: "Ámbito inválido" }, { status: 400 });
    }
    patch.ambito = ambito;
  }
  if (body.tipo_sugerido !== undefined) {
    const tipo = body.tipo_sugerido ? String(body.tipo_sugerido).trim() : null;
    if (tipo && !(TIPOS_MOVIMIENTO as readonly string[]).includes(tipo)) {
      return NextResponse.json({ error: "Tipo sugerido inválido" }, { status: 400 });
    }
    patch.tipo_sugerido = tipo;
  }
  if (body.clasificacion_sugerida !== undefined) {
    const clasif = body.clasificacion_sugerida ? String(body.clasificacion_sugerida).trim() : null;
    if (clasif && !(CLASIFICACIONES as readonly string[]).includes(clasif)) {
      return NextResponse.json({ error: "Clasificación sugerida inválida" }, { status: 400 });
    }
    patch.clasificacion_sugerida = clasif;
  }
  if (body.categoria_id !== undefined) {
    const categoriaId = body.categoria_id ? String(body.categoria_id) : null;
    if (categoriaId && !isValidUuid(categoriaId)) {
      return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
    }
    patch.categoria_id = categoriaId;
  }
  if (body.cuenta_id !== undefined) {
    const cuentaId = body.cuenta_id ? String(body.cuenta_id) : null;
    if (cuentaId && !isValidUuid(cuentaId)) {
      return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
    }
    patch.cuenta_id = cuentaId;
  }
  if (body.prioridad !== undefined) patch.prioridad = Number(body.prioridad) || 100;
  if (body.activa !== undefined) patch.activa = Boolean(body.activa);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_reglas_clasificacion")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return failResponse(500, "Error actualizando regla", {
      logContext: "finanzas reglas PUT",
      error,
    });
  }
  if (!data) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  await registrarFinLog("editar", "fin_reglas_clasificacion", id, patch, auth.role);
  return NextResponse.json({ regla: data });
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("fin_reglas_clasificacion").delete().eq("id", id);
  if (error) {
    return failResponse(500, "Error eliminando regla", {
      logContext: "finanzas reglas DELETE",
      error,
    });
  }

  await registrarFinLog("eliminar", "fin_reglas_clasificacion", id, {}, auth.role);
  return NextResponse.json({ ok: true });
}
