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
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      turnos: data,
    });
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
      simuladores,
      cantidad_turnos,
      metodo_pago,
      total,
      observaciones,
    } = body;

    const cantidad_simuladores =
      simuladores?.length || 0;

    const { data, error } =
      await supabaseAdmin
        .from("turnos_stand")
        .insert([
          {
            nombre,
            telefono,
            fecha,
            hora,

            simuladores,

            cantidad_simuladores,

            cantidad_turnos:
              cantidad_turnos || 1,

            metodo_pago:
              metodo_pago || "efectivo",

            total:
              Number(total) || 0,

            estado: "activo",

            duracion_minutos: 20,

            observaciones,
          },
        ])
        .select()
        .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      turno: data,
    });
  } catch {
    return NextResponse.json(
      { error: "Error creando turno" },
      { status: 500 }
    );
  }
}