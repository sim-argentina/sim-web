import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .select("*")
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ turnos: data });
  } catch {
    return NextResponse.json(
      { error: "Error cargando turnos" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      nombre,
      telefono,
      fecha,
      hora,
      hora_estimada_subida,
      hora_subida,
      simuladores,
      cantidad_personas,
      cantidad_minutos,
      cantidad_turnos,
      metodo_pago,
      total,
      observaciones,
    } = body;

    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .insert([
        {
          nombre,
          telefono,
          fecha,
          hora,
          hora_estimada_subida: hora_estimada_subida || null,
          hora_subida: hora_subida || null,
          simuladores: simuladores || [],
cantidad_simuladores: simuladores?.length || 0,
          cantidad_personas: Number(cantidad_personas) || 1,
          cantidad_minutos: Number(cantidad_minutos) || 15,
          cantidad_turnos: Number(cantidad_turnos) || 1,
          metodo_pago,
          total: Number(total) || 0,
          estado: "activo",
          duracion_minutos: Number(cantidad_minutos) || 15,
          observaciones,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json(
      { error: "Error creando turno" },
      { status: 500 }
    );
  }
}