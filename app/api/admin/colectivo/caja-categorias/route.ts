import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { CATEGORIA_CAJA_NOMBRE_MAX, claveCategoriaCaja, esTipoCaja, normalizarNombreCategoriaCaja } from "@/lib/colectivo";

// Categorías de la caja del Colectivo. SOLO admin: el staff usa las categorías
// activas al registrar movimientos (GET /eventos/[id]/caja) pero no las administra.
// La caja del Colectivo es interna al evento y no forma parte de Finanzas SIM:
// estas categorías no se relacionan con las de Finanzas.

// Dos categorías no pueden llamarse igual, sin distinguir mayúsculas ni espacios
// repetidos (el índice único de la base aplica la misma regla).
async function nombreOcupado(nombre: string, exceptoId?: string): Promise<boolean | "error"> {
  const { data, error } = await supabaseAdmin.from("colectivo_caja_categorias").select("id, nombre");
  if (error) return "error";
  const clave = claveCategoriaCaja(nombre);
  return (data ?? []).some((c) => c.id !== exceptoId && claveCategoriaCaja(String(c.nombre)) === clave);
}
const errorNombre = () =>
  NextResponse.json({ error: `El nombre es obligatorio (hasta ${CATEGORIA_CAJA_NOMBRE_MAX} caracteres)` }, { status: 400 });
const errorDuplicado = () => NextResponse.json({ error: "Ya existe una categoría con ese nombre" }, { status: 409 });

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const [cat, mov] = await Promise.all([
    supabaseAdmin
      .from("colectivo_caja_categorias")
      .select("id, nombre, tipo, activo, created_at, updated_at")
      .order("nombre", { ascending: true }),
    supabaseAdmin.from("colectivo_gastos").select("categoria_id").not("categoria_id", "is", null),
  ]);
  if (cat.error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias GET", error: cat.error });
  if (mov.error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias GET usos", error: mov.error });

  // Cuántos movimientos (de cualquier estado, también eliminados) usan cada
  // categoría: con movimientos, la categoría no se puede borrar, solo desactivar.
  const usos = new Map<string, number>();
  for (const m of mov.data ?? []) usos.set(m.categoria_id as string, (usos.get(m.categoria_id as string) ?? 0) + 1);
  const categorias = (cat.data ?? []).map((c) => ({ ...c, movimientos: usos.get(c.id as string) ?? 0 }));
  return NextResponse.json({ categorias });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const nombre = normalizarNombreCategoriaCaja(body.nombre);
    if (!nombre) return errorNombre();
    if (!esTipoCaja(body.tipo)) return NextResponse.json({ error: "Elegí si es costo o gasto" }, { status: 400 });
    const activo = typeof body.activo === "boolean" ? body.activo : true;

    const ocupado = await nombreOcupado(nombre);
    if (ocupado === "error") return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias POST nombre" });
    if (ocupado) return errorDuplicado();

    const { data, error } = await supabaseAdmin
      .from("colectivo_caja_categorias")
      .insert([{ nombre, tipo: body.tipo, activo }])
      .select("id, nombre, tipo, activo")
      .single();
    if (error?.code === "23505") return errorDuplicado();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias POST", error });
    return NextResponse.json({ ok: true, categoria: data });
  } catch {
    return NextResponse.json({ error: "Error creando categoría" }, { status: 500 });
  }
}

// Edita nombre, tipo o estado. Nada de esto reescribe movimientos ya cargados:
// cada uno guarda el tipo y el nombre con que se registró. Los movimientos
// nuevos toman la clasificación vigente.
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const id = String(body.id || "");
    if (!isValidUuid(id)) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (body.nombre !== undefined) {
      const nombre = normalizarNombreCategoriaCaja(body.nombre);
      if (!nombre) return errorNombre();
      const ocupado = await nombreOcupado(nombre, id);
      if (ocupado === "error") return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias PATCH nombre" });
      if (ocupado) return errorDuplicado();
      updates.nombre = nombre;
    }
    if (body.tipo !== undefined) {
      if (!esTipoCaja(body.tipo)) return NextResponse.json({ error: "Elegí si es costo o gasto" }, { status: 400 });
      updates.tipo = body.tipo;
    }
    if (body.activo !== undefined) {
      if (typeof body.activo !== "boolean") return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      updates.activo = body.activo;
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("colectivo_caja_categorias")
      .update(updates)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") return errorDuplicado();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias PATCH", error });
    if (!data) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error actualizando categoría" }, { status: 500 });
  }
}

// Eliminar: si la categoría tiene movimientos (de cualquier estado) NO se borra:
// se desactiva y conserva el histórico. Solo una categoría que nunca se usó se
// elimina físicamente.
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isValidUuid(id)) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

  const { data: categoria } = await supabaseAdmin.from("colectivo_caja_categorias").select("id").eq("id", id).maybeSingle();
  if (!categoria) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

  const desactivar = async () => {
    const { error } = await supabaseAdmin
      .from("colectivo_caja_categorias")
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias DELETE desactivar", error });
    logSecurityEvent("categoria_caja_colectivo_desactivada", { id, role: auth.role });
    return NextResponse.json({ ok: true, resultado: "desactivada" });
  };

  const { count, error: errCount } = await supabaseAdmin
    .from("colectivo_gastos")
    .select("id", { count: "exact", head: true })
    .eq("categoria_id", id);
  if (errCount) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias DELETE usos", error: errCount });
  if ((count ?? 0) > 0) return desactivar();

  const { error } = await supabaseAdmin.from("colectivo_caja_categorias").delete().eq("id", id);
  // Un movimiento registrado entre el conteo y el borrado: la FK lo impide → se desactiva.
  if (error?.code === "23503") return desactivar();
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja-categorias DELETE", error });
  logSecurityEvent("categoria_caja_colectivo_eliminada", { id, role: auth.role });
  return NextResponse.json({ ok: true, resultado: "eliminada" });
}
