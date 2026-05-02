import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ReservaBody = {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  cantidad_turnos: number;
  total: number;
  acepto_condiciones: boolean;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get("fecha");

    let query = supabaseAdmin
      .from("reservas")
      .select("*")
      .order("created_at", { ascending: false });

    if (fecha) {
      query = query.eq("fecha", fecha);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Error al obtener reservas", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? [], { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error al obtener reservas",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: ReservaBody = await req.json();

    const {
      nombre,
      telefono,
      fecha,
      hora,
      simuladores,
      cantidad_turnos,
      total,
      acepto_condiciones,
    } = body;

    if (
      !nombre ||
      !telefono ||
      !fecha ||
      !hora ||
      !Array.isArray(simuladores) ||
      simuladores.length === 0 ||
      !cantidad_turnos ||
      !total ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios o no se aceptaron las condiciones" },
        { status: 400 }
      );
    }

    const { data: existentes, error: checkError } = await supabaseAdmin
      .from("reservas")
      .select("id, simuladores")
      .eq("fecha", fecha)
      .eq("hora", hora)
      .eq("estado", "activa");

    if (checkError) {
      return NextResponse.json(
        {
          error: "Error al validar disponibilidad",
          details: checkError.message,
        },
        { status: 500 }
      );
    }

    const ocupados = new Set<string>();

    for (const reserva of existentes || []) {
      const sims = Array.isArray(reserva.simuladores)
        ? reserva.simuladores
        : [];

      for (const sim of sims) {
        ocupados.add(sim);
      }
    }

    const conflicto = simuladores.some((sim) => ocupados.has(sim));

    if (conflicto) {
      return NextResponse.json(
        { error: "Uno o más simuladores ya están reservados en ese horario" },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("reservas")
      .insert([
        {
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos,
          total,
          estado: "activa",
          acepto_condiciones,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Error al guardar la reserva", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}