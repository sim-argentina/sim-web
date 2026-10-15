import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { armarInformeEvento, COLUMNAS_GASTO_COLECTIVO } from "@/lib/colectivo";

// Informe del evento del Colectivo (admin y staff, igual que la caja). Solo
// lectura: se arma en el momento desde los turnos, las ventas y los movimientos
// de caja del evento, con las mismas reglas que la caja (armarInformeEvento usa
// calcularCajaEvento). No guarda copias.
// El informe del Colectivo es interno y no forma parte de Finanzas SIM: no lee
// ni escribe nada de fin_*.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const [ev, tu, ve, mo] = await Promise.all([
    supabaseAdmin
      .from("colectivo_eventos")
      .select("id, nombre, fecha_inicio, fecha_fin, localidad, provincia, ubicacion, estado")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("colectivo_turnos")
      .select("total, estado, metodo_pago, pagos_detalle, cantidad_turnos, cantidad_personas, cantidad_minutos")
      .eq("evento_id", id),
    supabaseAdmin
      .from("colectivo_ventas")
      .select("total, estado, metodo_pago, pagos_detalle, producto_nombre, cantidad")
      .eq("evento_id", id),
    supabaseAdmin
      .from("colectivo_gastos")
      .select(COLUMNAS_GASTO_COLECTIVO)
      .eq("evento_id", id)
      .is("eliminado_at", null)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const error = ev.error || tu.error || ve.error || mo.error;
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/informe GET", error });
  if (!ev.data) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const movimientos = mo.data ?? [];
  const informe = armarInformeEvento({ turnos: tu.data ?? [], ventas: ve.data ?? [], movimientos });
  return NextResponse.json({ evento: ev.data, informe, movimientos });
}
