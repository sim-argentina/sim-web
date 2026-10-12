import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

// Catálogo de productos del Colectivo. SOLO admin: el staff vende con los
// productos habilitados del evento (GET /eventos/[id]/productos) pero no
// administra el catálogo.

const NOMBRE_MAX = 60;

function leerNombre(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s && s.length <= NOMBRE_MAX ? s : null;
}
function leerPrecio(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const r = Math.round(n);
  return Number.isSafeInteger(r) ? r : null;
}
// Dos productos no pueden llamarse igual, sin distinguir mayúsculas.
async function nombreOcupado(nombre: string, exceptoId?: string): Promise<boolean | "error"> {
  const { data, error } = await supabaseAdmin.from("colectivo_productos").select("id, nombre");
  if (error) return "error";
  const clave = nombre.toLocaleLowerCase("es");
  return (data ?? []).some((p) => p.id !== exceptoId && String(p.nombre).toLocaleLowerCase("es") === clave);
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const [prod, ventas] = await Promise.all([
    supabaseAdmin
      .from("colectivo_productos")
      .select("id, nombre, precio_predeterminado, activo, orden, created_at, updated_at")
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true }),
    supabaseAdmin.from("colectivo_ventas").select("producto_id").not("producto_id", "is", null),
  ]);
  if (prod.error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos GET", error: prod.error });
  if (ventas.error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos GET ventas", error: ventas.error });

  // Cuántas ventas (de cualquier estado) usan cada producto: con ventas, el
  // producto no se puede borrar, solo desactivar.
  const usos = new Map<string, number>();
  for (const v of ventas.data ?? []) usos.set(v.producto_id as string, (usos.get(v.producto_id as string) ?? 0) + 1);
  const productos = (prod.data ?? []).map((p) => ({ ...p, ventas: usos.get(p.id as string) ?? 0 }));
  return NextResponse.json({ productos });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const nombre = leerNombre(body.nombre);
    if (!nombre) return NextResponse.json({ error: `El nombre es obligatorio (hasta ${NOMBRE_MAX} caracteres)` }, { status: 400 });
    const precio = leerPrecio(body.precio_predeterminado);
    if (precio === null) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
    const activo = typeof body.activo === "boolean" ? body.activo : true;

    const ocupado = await nombreOcupado(nombre);
    if (ocupado === "error") return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos POST nombre" });
    if (ocupado) return NextResponse.json({ error: "Ya existe un producto con ese nombre" }, { status: 409 });

    // Va al final del catálogo.
    const { data: ultimo } = await supabaseAdmin
      .from("colectivo_productos")
      .select("orden")
      .order("orden", { ascending: false })
      .limit(1)
      .maybeSingle();
    const orden = (Number(ultimo?.orden) || 0) + 1;

    const { data, error } = await supabaseAdmin
      .from("colectivo_productos")
      .insert([{ nombre, precio_predeterminado: precio, activo, orden }])
      .select("id, nombre, precio_predeterminado, activo, orden")
      .single();
    if (error?.code === "23505") return NextResponse.json({ error: "Ya existe un producto con ese nombre" }, { status: 409 });
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos POST", error });
    return NextResponse.json({ ok: true, producto: data });
  } catch {
    return NextResponse.json({ error: "Error creando producto" }, { status: 500 });
  }
}

// Edita nombre, precio predeterminado o estado. Ninguno de los tres reescribe
// ventas: cada venta guarda su propio nombre, precio unitario y total.
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const id = String(body.id || "");
    if (!isValidUuid(id)) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (body.nombre !== undefined) {
      const nombre = leerNombre(body.nombre);
      if (!nombre) return NextResponse.json({ error: `El nombre es obligatorio (hasta ${NOMBRE_MAX} caracteres)` }, { status: 400 });
      const ocupado = await nombreOcupado(nombre, id);
      if (ocupado === "error") return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos PATCH nombre" });
      if (ocupado) return NextResponse.json({ error: "Ya existe un producto con ese nombre" }, { status: 409 });
      updates.nombre = nombre;
    }
    if (body.precio_predeterminado !== undefined) {
      const precio = leerPrecio(body.precio_predeterminado);
      if (precio === null) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
      updates.precio_predeterminado = precio;
    }
    if (body.activo !== undefined) {
      if (typeof body.activo !== "boolean") return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      updates.activo = body.activo;
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("colectivo_productos")
      .update(updates)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") return NextResponse.json({ error: "Ya existe un producto con ese nombre" }, { status: 409 });
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos PATCH", error });
    if (!data) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error actualizando producto" }, { status: 500 });
  }
}

// Eliminar: si el producto tiene ventas (de cualquier estado) NO se borra: se
// desactiva y conserva todo su historial. Solo un producto que nunca se vendió
// se elimina físicamente (junto con su disponibilidad en eventos).
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isValidUuid(id)) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { data: producto } = await supabaseAdmin.from("colectivo_productos").select("id").eq("id", id).maybeSingle();
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const archivar = async () => {
    const { error } = await supabaseAdmin
      .from("colectivo_productos")
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos DELETE archivar", error });
    logSecurityEvent("producto_colectivo_archivado", { id, role: auth.role });
    return NextResponse.json({ ok: true, resultado: "desactivado" });
  };

  const { count, error: errCount } = await supabaseAdmin
    .from("colectivo_ventas")
    .select("id", { count: "exact", head: true })
    .eq("producto_id", id);
  if (errCount) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos DELETE ventas", error: errCount });
  if ((count ?? 0) > 0) return archivar();

  const { error } = await supabaseAdmin.from("colectivo_productos").delete().eq("id", id);
  // Una venta registrada entre el conteo y el borrado: la FK lo impide → se desactiva.
  if (error?.code === "23503") return archivar();
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos DELETE", error });
  logSecurityEvent("producto_colectivo_eliminado", { id, role: auth.role });
  return NextResponse.json({ ok: true, resultado: "eliminado" });
}
