import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { normalizarGastoColectivo, COLUMNAS_GASTO_COLECTIVO } from "@/lib/colectivo";

// Un gasto de la caja del evento (admin y staff). La caja del Colectivo es
// interna al evento y no forma parte de Finanzas SIM.
//   PATCH   edita el gasto.
//   DELETE  eliminación lógica (eliminado_at / eliminado_por): deja de contar y
//           de listarse, pero la fila queda en la base.

// El gasto vigente con el estado de su evento, o la respuesta de error.
async function gastoEditable(id: string) {
  if (!isValidUuid(id)) return { error: NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 }) };
  const { data: gasto, error } = await supabaseAdmin
    .from("colectivo_gastos")
    .select("id, eliminado_at, colectivo_eventos(estado)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/gastos/[id] lectura", error }) };
  if (!gasto || gasto.eliminado_at) return { error: NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 }) };
  const evento = gasto.colectivo_eventos as unknown as { estado: string } | null;
  if (evento && (evento.estado === "finalizado" || evento.estado === "cancelado")) {
    return { error: NextResponse.json({ error: "El evento está cerrado. Reabrilo para editar la caja." }, { status: 400 }) };
  }
  return { gasto };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const g = await gastoEditable(id);
    if (g.error) return g.error;

    const r = normalizarGastoColectivo(body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("colectivo_gastos")
      .update({ ...r.gasto, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("eliminado_at", null)
      .select(COLUMNAS_GASTO_COLECTIVO)
      .maybeSingle();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/gastos/[id] PATCH", error });
    if (!data) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, gasto: data });
  } catch {
    return NextResponse.json({ error: "Error actualizando gasto" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const g = await gastoEditable(id);
  if (g.error) return g.error;

  const ahora = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("colectivo_gastos")
    .update({ eliminado_at: ahora, eliminado_por: auth.role, updated_at: ahora })
    .eq("id", id)
    .is("eliminado_at", null)
    .select("id")
    .maybeSingle();
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/gastos/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  logSecurityEvent("gasto_colectivo_eliminado", { id, role: auth.role });
  return NextResponse.json({ ok: true });
}
