import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { calcularCajaEvento, normalizarMovimientoCaja, COLUMNAS_GASTO_COLECTIVO } from "@/lib/colectivo";
import { categoriaActivaCaja, categoriasCaja } from "@/lib/colectivoCaja";

// Caja del evento del Colectivo (admin y staff, igual que turnos y ventas).
// La caja del Colectivo es interna al evento y no forma parte de Finanzas SIM:
// no escribe ni lee nada de fin_*, y ninguna pantalla de Finanzas la consulta.
//   GET   resumen (ingresos, costos, gastos, neto), movimientos vigentes del
//         evento y el catálogo de categorías (para cargar y filtrar).
//   POST  registra un movimiento; su tipo (costo/gasto) y el nombre de la
//         categoría se toman del catálogo en ese momento y quedan guardados.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const [ev, tu, ve, mo, cat] = await Promise.all([
    supabaseAdmin.from("colectivo_eventos").select("id").eq("id", id).maybeSingle(),
    supabaseAdmin.from("colectivo_turnos").select("total, estado, metodo_pago").eq("evento_id", id),
    supabaseAdmin.from("colectivo_ventas").select("total, estado").eq("evento_id", id),
    supabaseAdmin
      .from("colectivo_gastos")
      .select(COLUMNAS_GASTO_COLECTIVO)
      .eq("evento_id", id)
      .is("eliminado_at", null)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }),
    categoriasCaja(),
  ]);
  const error = ev.error || tu.error || ve.error || mo.error;
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja GET", error });
  if (!cat.ok) return failResponse(500, cat.error, { logContext: "colectivo/caja GET categorías", error: cat.detalle });
  if (!ev.data) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const movimientos = mo.data ?? [];
  const resumen = calcularCajaEvento({ turnos: tu.data ?? [], ventas: ve.data ?? [], movimientos });
  return NextResponse.json({ resumen, movimientos, categorias: cat.valor });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const body = await req.json().catch(() => ({}));
    const { data: evento } = await supabaseAdmin.from("colectivo_eventos").select("id, estado").eq("id", id).maybeSingle();
    if (!evento) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (evento.estado === "finalizado" || evento.estado === "cancelado") {
      return NextResponse.json({ error: "El evento está cerrado. Reabrilo para cargar movimientos." }, { status: 400 });
    }

    const r = normalizarMovimientoCaja(body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const cat = await categoriaActivaCaja(r.movimiento.categoria_id);
    if (!cat.ok) {
      if (cat.status === 500) return failResponse(500, cat.error, { logContext: "colectivo/caja POST categoría", error: cat.detalle });
      return NextResponse.json({ error: cat.error }, { status: cat.status });
    }

    const { data, error } = await supabaseAdmin
      .from("colectivo_gastos")
      .insert([{
        evento_id: id,
        ...r.movimiento,
        tipo: cat.valor.tipo,
        categoria_nombre: cat.valor.nombre,
        created_by: auth.role,
      }])
      .select(COLUMNAS_GASTO_COLECTIVO)
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/caja POST", error });
    return NextResponse.json({ ok: true, movimiento: data });
  } catch {
    return NextResponse.json({ error: "Error registrando movimiento" }, { status: 500 });
  }
}
