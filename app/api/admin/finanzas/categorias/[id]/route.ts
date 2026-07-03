import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { TIPOS_CATEGORIA, registrarFinLog } from "@/lib/finanzas";

type Params = { params: Promise<{ id: string }> };

async function getCategoria(id: string) {
  const { data, error } = await supabaseAdmin.from("fin_categorias").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  try {
    const cat = await getCategoria(id);
    if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const patch: Record<string, unknown> = {};

    if (body.nombre !== undefined) {
      const nombre = String(body.nombre).trim().slice(0, 80);
      if (!nombre) return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
      if (cat.protegida && nombre !== cat.nombre) {
        return NextResponse.json({ error: "Esta categoría es del sistema y no se puede renombrar" }, { status: 400 });
      }
      patch.nombre = nombre;
    }
    if (body.tipo !== undefined) {
      const tipo = String(body.tipo).trim();
      if (!(TIPOS_CATEGORIA as readonly string[]).includes(tipo)) {
        return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
      }
      if (cat.protegida && tipo !== cat.tipo) {
        return NextResponse.json({ error: "Esta categoría es del sistema y no se puede cambiar de tipo" }, { status: 400 });
      }
      patch.tipo = tipo;
    }
    if (body.activa !== undefined) {
      if (cat.protegida && body.activa === false) {
        return NextResponse.json({ error: "Esta categoría es del sistema y no se puede desactivar" }, { status: 400 });
      }
      patch.activa = Boolean(body.activa);
    }
    if (body.orden !== undefined) patch.orden = Number(body.orden) || 0;
    if (body.color !== undefined) patch.color = body.color ? String(body.color).slice(0, 20) : null;
    if (body.descripcion !== undefined) patch.descripcion = body.descripcion ? String(body.descripcion).slice(0, 300) : null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.from("fin_categorias").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

    await registrarFinLog("editar", "fin_categorias", id, patch, auth.role);
    return NextResponse.json({ categoria: data });
  } catch (error) {
    return failResponse(500, "Error actualizando categoría", { logContext: "finanzas categorias PUT", error });
  }
}

// Elimina físicamente solo si no tiene movimientos ni reglas asociadas y no es
// protegida. Si tiene movimientos, se rechaza (usar desactivar).
export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  try {
    const cat = await getCategoria(id);
    if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
    if (cat.protegida) {
      return NextResponse.json({ error: "Esta categoría es del sistema y no se puede eliminar" }, { status: 400 });
    }

    const [{ count: movs }, { count: reglas }, { count: clasif }] = await Promise.all([
      supabaseAdmin.from("fin_movimientos").select("id", { count: "exact", head: true }).eq("categoria_id", id),
      supabaseAdmin.from("fin_reglas_clasificacion").select("id", { count: "exact", head: true }).eq("categoria_id", id),
      supabaseAdmin.from("fin_clasificacion_ingresos").select("id", { count: "exact", head: true }).eq("categoria_id", id),
    ]);

    if ((movs || 0) > 0 || (reglas || 0) > 0 || (clasif || 0) > 0) {
      return NextResponse.json(
        { error: "Tiene movimientos o reglas asociadas. Desactivala en vez de eliminarla.", tiene_uso: true },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from("fin_categorias").delete().eq("id", id);
    if (error) throw error;

    await registrarFinLog("eliminar", "fin_categorias", id, { nombre: cat.nombre }, auth.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failResponse(500, "Error eliminando categoría", { logContext: "finanzas categorias DELETE", error });
  }
}
