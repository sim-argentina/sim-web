import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import {
  limpiarPagosColectivo, resumirPagos, normalizarSimuladoresColectivo,
  esFechaValida, fechaDentroDelEvento,
} from "@/lib/colectivo";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const fecha = new URL(req.url).searchParams.get("fecha");
  let query = supabaseAdmin
    .from("colectivo_turnos")
    .select("*")
    .eq("evento_id", id)
    .order("fecha", { ascending: true })
    .order("id", { ascending: true });
  if (fecha && FECHA_RE.test(fecha)) query = query.eq("fecha", fecha);

  const { data, error } = await query;
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/turnos GET", error });
  return NextResponse.json({ turnos: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const body = await req.json();

    const { data: evento } = await supabaseAdmin
      .from("colectivo_eventos")
      .select("id, estado, fecha_inicio, fecha_fin")
      .eq("id", id)
      .maybeSingle();
    if (!evento) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (evento.estado === "finalizado") return NextResponse.json({ error: "El evento está finalizado. Reabrilo para cargar turnos." }, { status: 400 });
    if (evento.estado === "cancelado") return NextResponse.json({ error: "El evento está cancelado." }, { status: 400 });

    const fecha = body.fecha;
    if (!esFechaValida(fecha)) return NextResponse.json({ error: "Falta la fecha del turno" }, { status: 400 });
    if (!fechaDentroDelEvento(fecha, evento.fecha_inicio, evento.fecha_fin)) {
      return NextResponse.json({ error: "La fecha del turno debe estar dentro del evento" }, { status: 400 });
    }
    if (!txt(body.hora)) return NextResponse.json({ error: "Falta la hora de toma" }, { status: 400 });

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
      .insert([{
        evento_id: id,
        created_by: auth.role,
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
        estado: "activo",
        observaciones: txt(body.observaciones),
      }])
      .select()
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/turnos POST", error });

    // Un evento próximo pasa a activo al empezar a cargar turnos.
    if (evento.estado === "proximo") {
      await supabaseAdmin.from("colectivo_eventos").update({ estado: "activo", updated_at: new Date().toISOString() }).eq("id", id);
    }
    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json({ error: "Error creando turno" }, { status: 500 });
  }
}
