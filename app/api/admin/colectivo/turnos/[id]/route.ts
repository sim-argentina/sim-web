import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import {
  limpiarPagosColectivo, resumirPagos, normalizarSimuladoresColectivo,
  esFechaValida, fechaDentroDelEvento, normalizarPersonasColectivo,
  normalizarHoraOpcional, turnosColectivo, COLUMNAS_TURNO_COLECTIVO,
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
      .select("id, evento_id, cantidad_personas, colectivo_eventos(estado, fecha_inicio, fecha_fin)")
      .eq("id", turnoId)
      .maybeSingle();
    if (!turno) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
    const evento = turno.colectivo_eventos as unknown as { estado: string; fecha_inicio: string; fecha_fin: string } | null;
    if (evento && (evento.estado === "finalizado" || evento.estado === "cancelado")) {
      return NextResponse.json({ error: "El evento está cerrado. Reabrilo para editar turnos." }, { status: 400 });
    }

    // ── Marcar / desmarcar "listo": solo esa columna. No reescribe el resto del
    // turno (ni recalcula turnos de un registro histórico).
    if (body.accion === "listo") {
      if (typeof body.turno_listo !== "boolean") return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
      const { data, error } = await supabaseAdmin
        .from("colectivo_turnos")
        .update({ turno_listo: body.turno_listo, updated_at: new Date().toISOString() })
        .eq("id", turnoId)
        .select(COLUMNAS_TURNO_COLECTIVO)
        .single();
      if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/turnos/[id] listo", error });
      return NextResponse.json({ ok: true, turno: data });
    }

    const fecha = body.fecha;
    if (!esFechaValida(fecha)) return NextResponse.json({ error: "Falta la fecha del turno" }, { status: 400 });
    if (evento && !fechaDentroDelEvento(fecha, evento.fecha_inicio, evento.fecha_fin)) {
      return NextResponse.json({ error: "La fecha del turno debe estar dentro del evento" }, { status: 400 });
    }

    const minutos = Number(body.cantidad_minutos);
    if (!Number.isFinite(minutos) || minutos <= 0) return NextResponse.json({ error: "Los minutos deben ser mayores a 0" }, { status: 400 });
    // Un turno histórico con más de 6 personas puede editarse si no cambia ese valor.
    const personas = normalizarPersonasColectivo(body.cantidad_personas, Number(turno.cantidad_personas) || null);
    if (personas === null) return NextResponse.json({ error: "Elegí entre 1 y 6 personas" }, { status: 400 });
    const subida = normalizarHoraOpcional(body.hora_subida);
    if (!subida.ok) return NextResponse.json({ error: "Hora de subida inválida" }, { status: 400 });
    const bajada = normalizarHoraOpcional(body.hora_bajada);
    if (!bajada.ok) return NextResponse.json({ error: "Hora de bajada inválida" }, { status: 400 });

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

    // Las columnas legacy (nombre, telefono, hora_estimada_subida) no se tocan:
    // conservan lo que tuvieran.
    const { data, error } = await supabaseAdmin
      .from("colectivo_turnos")
      .update({
        fecha,
        hora: txt(body.hora),
        hora_subida: subida.hora,
        hora_bajada: bajada.hora,
        simuladores,
        cantidad_simuladores: simuladores.length,
        cantidad_personas: personas,
        cantidad_minutos: Math.round(minutos),
        // turnos = personas, siempre: lo que mande el cliente en cantidad_turnos se ignora.
        cantidad_turnos: turnosColectivo(personas),
        metodo_pago,
        posnet_pago,
        pagos_detalle: pagos,
        turno_listo: Boolean(body.turno_listo),
        total,
        observaciones: txt(body.observaciones),
        updated_at: new Date().toISOString(),
      })
      .eq("id", turnoId)
      .select(COLUMNAS_TURNO_COLECTIVO)
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/turnos/[id] PATCH", error });
    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json({ error: "Error actualizando turno" }, { status: 500 });
  }
}

// DELETE: eliminación física DEFINITIVA de un turno del Colectivo. SOLO admin.
// El turno no tiene hijos (pagos en el JSON de la fila). NO toca colectivo_ventas
// (productos) ni ningún otro turno o evento: son filas
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
