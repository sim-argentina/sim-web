import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { normalizarMovimientoCaja, COLUMNAS_GASTO_COLECTIVO } from "@/lib/colectivo";
import { categoriaActivaCaja } from "@/lib/colectivoCaja";

// Un movimiento de la caja del evento (admin y staff). La caja del Colectivo es
// interna al evento y no forma parte de Finanzas SIM.
//   PATCH   edita el movimiento.
//   DELETE  eliminación lógica (eliminado_at / eliminado_por): deja de contar y
//           de listarse, pero la fila queda en la base.

// El movimiento vigente con el estado de su evento, o la respuesta de error.
async function movimientoEditable(id: string) {
  if (!isValidUuid(id)) return { error: NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 }) };
  const { data: mov, error } = await supabaseAdmin
    .from("colectivo_gastos")
    .select("id, categoria_id, eliminado_at, colectivo_eventos(estado)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/gastos/[id] lectura", error }) };
  if (!mov || mov.eliminado_at) return { error: NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 }) };
  const evento = mov.colectivo_eventos as unknown as { estado: string } | null;
  if (evento && (evento.estado === "finalizado" || evento.estado === "cancelado")) {
    return { error: NextResponse.json({ error: "El evento está cerrado. Reabrilo para editar la caja." }, { status: 400 }) };
  }
  return { mov };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const m = await movimientoEditable(id);
    if (m.error) return m.error;

    const r = normalizarMovimientoCaja(body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

    // Misma categoría: el movimiento conserva el tipo y el nombre con que se
    // registró, aunque la categoría haya cambiado o esté inactiva. Otra
    // categoría: tiene que estar activa y el movimiento toma su tipo y nombre.
    let cambioCategoria: { tipo: string; categoria_nombre: string } | null = null;
    if (r.movimiento.categoria_id !== m.mov.categoria_id) {
      const cat = await categoriaActivaCaja(r.movimiento.categoria_id);
      if (!cat.ok) {
        if (cat.status === 500) return failResponse(500, cat.error, { logContext: "colectivo/gastos/[id] categoría", error: cat.detalle });
        return NextResponse.json({ error: cat.error }, { status: cat.status });
      }
      cambioCategoria = { tipo: cat.valor.tipo, categoria_nombre: cat.valor.nombre };
    }

    const { data, error } = await supabaseAdmin
      .from("colectivo_gastos")
      .update({ ...r.movimiento, ...cambioCategoria, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("eliminado_at", null)
      .select(COLUMNAS_GASTO_COLECTIVO)
      .maybeSingle();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/gastos/[id] PATCH", error });
    if (!data) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, movimiento: data });
  } catch {
    return NextResponse.json({ error: "Error actualizando movimiento" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const m = await movimientoEditable(id);
  if (m.error) return m.error;

  const ahora = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("colectivo_gastos")
    .update({ eliminado_at: ahora, eliminado_por: auth.role, updated_at: ahora })
    .eq("id", id)
    .is("eliminado_at", null)
    .select("id")
    .maybeSingle();
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/gastos/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  logSecurityEvent("gasto_colectivo_eliminado", { id, role: auth.role });
  return NextResponse.json({ ok: true });
}
