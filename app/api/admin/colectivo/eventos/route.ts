import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { ESTADOS_EVENTO, esFechaValida } from "@/lib/colectivo";

const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const [{ data: eventos, error }, turnosRes, ventasRes] = await Promise.all([
      supabaseAdmin.from("colectivo_eventos").select("*").order("fecha_inicio", { ascending: false }),
      supabaseAdmin.from("colectivo_turnos").select("evento_id, total, estado, cantidad_turnos"),
      supabaseAdmin.from("colectivo_ventas").select("evento_id, total, estado"),
    ]);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos GET", error });

    // Agregados por evento (solo válidos: turnos no cancelados, ventas activas).
    const agg: Record<string, { turnos: number; facturacion_simuladores: number; ventas_productos: number }> = {};
    const get = (id: string) => (agg[id] = agg[id] || { turnos: 0, facturacion_simuladores: 0, ventas_productos: 0 });
    for (const t of turnosRes.data ?? []) {
      if (t.estado === "cancelado" || !t.evento_id) continue;
      const a = get(t.evento_id);
      a.turnos += Number(t.cantidad_turnos) || 1;
      a.facturacion_simuladores += Number(t.total) || 0;
    }
    for (const v of ventasRes.data ?? []) {
      if (v.estado !== "activa" || !v.evento_id) continue;
      get(v.evento_id).ventas_productos += Number(v.total) || 0;
    }

    const enriched = (eventos ?? []).map((e) => {
      const a = agg[e.id] || { turnos: 0, facturacion_simuladores: 0, ventas_productos: 0 };
      return { ...e, ...a, recaudacion_total: a.facturacion_simuladores + a.ventas_productos };
    });
    return NextResponse.json({ eventos: enriched });
  } catch {
    return NextResponse.json({ error: "Error cargando eventos" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const nombre = txt(body.nombre);
    const fecha_inicio = body.fecha_inicio;
    const fecha_fin = body.fecha_fin;

    if (!nombre) return NextResponse.json({ error: "El nombre del evento es obligatorio" }, { status: 400 });
    if (!esFechaValida(fecha_inicio) || !esFechaValida(fecha_fin)) {
      return NextResponse.json({ error: "Fechas de inicio y finalización obligatorias (YYYY-MM-DD)" }, { status: 400 });
    }
    if (fecha_fin < fecha_inicio) {
      return NextResponse.json({ error: "La fecha de finalización no puede ser anterior a la de inicio" }, { status: 400 });
    }
    const estado = ESTADOS_EVENTO.includes(body.estado) ? body.estado : "proximo";

    const { data, error } = await supabaseAdmin
      .from("colectivo_eventos")
      .insert([{
        nombre,
        fecha_inicio,
        fecha_fin,
        hora_inicio: txt(body.hora_inicio),
        hora_fin: txt(body.hora_fin),
        localidad: txt(body.localidad),
        provincia: txt(body.provincia),
        ubicacion: txt(body.ubicacion),
        organizador: txt(body.organizador),
        telefono_contacto: txt(body.telefono_contacto),
        observaciones: txt(body.observaciones),
        estado,
        created_by: auth.role,
      }])
      .select()
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos POST", error });
    return NextResponse.json({ ok: true, evento: data });
  } catch {
    return NextResponse.json({ error: "Error creando evento" }, { status: 500 });
  }
}
