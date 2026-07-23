import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import {
  limpiarPagosColectivo, resumirPagos, normalizarSimuladoresColectivo,
  esFechaValida, fechaDentroDelEvento,
} from "@/lib/colectivo";

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const turnoId = Number(id);
  if (!Number.isInteger(turnoId) || turnoId <= 0) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });

  try {
    const body = await req.json();

    const { data: turno } = await supabaseAdmin
      .from("colectivo_turnos")
      .select("id, evento_id, colectivo_eventos(estado, fecha_inicio, fecha_fin)")
      .eq("id", turnoId)
      .maybeSingle();
    if (!turno) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
    const evento = turno.colectivo_eventos as unknown as { estado: string; fecha_inicio: string; fecha_fin: string } | null;
    if (evento && (evento.estado === "finalizado" || evento.estado === "cancelado")) {
      return NextResponse.json({ error: "El evento está cerrado. Reabrilo para editar turnos." }, { status: 400 });
    }

    const fecha = body.fecha;
    if (!esFechaValida(fecha)) return NextResponse.json({ error: "Falta la fecha del turno" }, { status: 400 });
    if (evento && !fechaDentroDelEvento(fecha, evento.fecha_inicio, evento.fecha_fin)) {
      return NextResponse.json({ error: "La fecha del turno debe estar dentro del evento" }, { status: 400 });
    }

    const minutos = Number(body.cantidad_minutos);
    if (!Number.isFinite(minutos) || minutos <= 0) return NextResponse.json({ error: "Los minutos deben ser mayores a 0" }, { status: 400 });
    const personas = Number(body.cantidad_personas);
    if (!Number.isFinite(personas) || personas <= 0) return NextResponse.json({ error: "Las personas deben ser mayores a 0" }, { status: 400 });

    const simuladores = normalizarSimuladoresColectivo(body.simuladores);
    const gratis = body.metodo_pago === "gratis" || body.turno_gratis === true;

    let pagos: ReturnType<typeof limpiarPagosColectivo> = [];
    let metodo_pago = "gratis";
    let posnet_pago: string | null = null;
    let total = 0;
    if (!gratis) {
      pagos = limpiarPagosColectivo(body.pagos_detalle);
      if (pagos.length === 0) return NextResponse.json({ error: "Cargá al menos un pago mayor a 0 (o marcá turno gratis)" }, { status: 400 });
      const r = resumirPagos(pagos);
      metodo_pago = r.metodo_pago;
      posnet_pago = r.posnet_pago;
      total = r.total;
    }

    const { data, error } = await supabaseAdmin
      .from("colectivo_turnos")
      .update({
        nombre: txt(body.nombre),
        telefono: txt(body.telefono),
        fecha,
        hora: txt(body.hora),
        hora_estimada_subida: txt(body.hora_estimada_subida),
        hora_subida: txt(body.hora_subida),
        hora_bajada: txt(body.hora_bajada),
        simuladores,
        cantidad_simuladores: simuladores.length,
        cantidad_personas: Math.round(personas),
        cantidad_minutos: Math.round(minutos),
        cantidad_turnos: Math.max(1, Math.round(Number(body.cantidad_turnos) || 1)),
        metodo_pago,
        posnet_pago,
        pagos_detalle: pagos,
        turno_listo: Boolean(body.turno_listo),
        total,
        observaciones: txt(body.observaciones),
        updated_at: new Date().toISOString(),
      })
      .eq("id", turnoId)
      .select()
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/turnos/[id] PATCH", error });
    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json({ error: "Error actualizando turno" }, { status: 500 });
  }
}

// DELETE: eliminación física DEFINITIVA de un turno del Colectivo. SOLO admin.
// El turno no tiene hijos (pagos en el JSON de la fila). NO toca colectivo_ventas
// (gorras/buzos/productos) ni ningún otro turno o evento: son filas
// independientes. El resumen del evento (turnos/personas/minutos/recaudación de
// simuladores) recalcula solo porque se lee en vivo. Sin historial del turno.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const turnoId = Number(id);
  if (!Number.isInteger(turnoId) || turnoId <= 0) {
    return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("colectivo_turnos")
    .delete()
    .eq("id", turnoId)
    .select("id")
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/turnos/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  logSecurityEvent("turno_colectivo_eliminado", { id: turnoId, role: auth.role });
  return NextResponse.json({ ok: true });
}
