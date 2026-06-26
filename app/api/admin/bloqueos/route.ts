import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { SIMULADORES_VALIDOS } from "@/lib/reservasValidation";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import { turnoBloqueado, type BloqueoReserva } from "@/lib/bloqueos";

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("bloqueos_reservas")
    .select("*")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return failResponse(500, "Error cargando bloqueos", {
      logContext: "bloqueos GET",
      error,
    });
  }
  return NextResponse.json({ bloqueos: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const fecha = String(body.fecha || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }

  const todoElDia = body.todo_el_dia !== false; // default true
  const horaInicio = body.hora_inicio ? String(body.hora_inicio).slice(0, 5) : null;
  const horaFin = body.hora_fin ? String(body.hora_fin).slice(0, 5) : null;

  let simulador: string | null = body.simulador ? String(body.simulador).trim() : null;
  if (simulador && !(SIMULADORES_VALIDOS as readonly string[]).includes(simulador)) {
    return NextResponse.json({ error: "Simulador inválido" }, { status: 400 });
  }

  if (!todoElDia) {
    if (!horaInicio || !horaFin || !HORA_RE.test(horaInicio) || !HORA_RE.test(horaFin)) {
      return NextResponse.json(
        { error: "Indicá hora de inicio y fin válidas, o marcá todo el día" },
        { status: 400 }
      );
    }
    if (horaFin < horaInicio) {
      return NextResponse.json(
        { error: "La hora de fin debe ser posterior a la de inicio" },
        { status: 400 }
      );
    }
  }

  const motivo = body.motivo ? String(body.motivo).slice(0, 200) : null;

  const nuevo = {
    fecha,
    todo_el_dia: todoElDia,
    hora_inicio: todoElDia ? null : horaInicio,
    hora_fin: todoElDia ? null : horaFin,
    simulador,
    motivo,
    activo: true,
  };

  const { data, error } = await supabaseAdmin
    .from("bloqueos_reservas")
    .insert([nuevo])
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error creando bloqueo", {
      logContext: "bloqueos POST",
      error,
    });
  }

  // Advertencia (no se borra nada): reservas activas que el nuevo bloqueo pisa.
  let reservasAfectadas = 0;
  try {
    const { data: reservas } = await supabaseAdmin
      .from("reservas")
      .select("hora, simuladores, duracion_minutos")
      .eq("fecha", fecha)
      .eq("estado", "activa");

    const bloqueoArr: BloqueoReserva[] = [
      {
        fecha,
        todo_el_dia: nuevo.todo_el_dia,
        hora_inicio: nuevo.hora_inicio,
        hora_fin: nuevo.hora_fin,
        simulador: nuevo.simulador,
      },
    ];

    for (const r of reservas || []) {
      const sims = Array.isArray(r.simuladores) ? r.simuladores.map(String) : [];
      const slots = getOccupiedSlots(
        fecha,
        String(r.hora),
        Number(r.duracion_minutos) || 15
      );
      if (turnoBloqueado(bloqueoArr, slots, sims)) reservasAfectadas++;
    }
  } catch {
    /* el conteo es best-effort; no bloquea la creación del bloqueo */
  }

  return NextResponse.json(
    { bloqueo: data, reservas_afectadas: reservasAfectadas },
    { status: 201 }
  );
}
