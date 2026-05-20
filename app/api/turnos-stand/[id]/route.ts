import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .update({
        nombre: body.nombre,
        telefono: body.telefono,
        fecha: body.fecha,
        hora: body.hora,
        hora_estimada_subida: body.hora_estimada_subida || null,
        hora_subida: body.hora_subida || null,
        hora_bajada: body.hora_bajada || null,
        simuladores: body.simuladores || [],
        cantidad_simuladores: body.simuladores?.length || 0,
        cantidad_personas: Number(body.cantidad_personas) || 1,
        cantidad_minutos: Number(body.cantidad_minutos) || 15,
        cantidad_turnos: Number(body.cantidad_turnos) || 1,
        posnet_pago: body.posnet_pago || null,
        metodo_pago: body.metodo_pago,
        total: Number(body.total) || 0,
        observaciones: body.observaciones,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json(
      { error: "Error actualizando turno" },
      { status: 500 }
    );
  }
}