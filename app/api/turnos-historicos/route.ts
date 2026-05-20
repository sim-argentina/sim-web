import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TurnoHistoricoBody = {
  archivo_nombre: string;
  archivo_key: string;
  fecha: string;
  hora_subida?: string;
  hora_bajada?: string;
  hora_tomado?: string;
  metodo_pago: string;
  total: number;
  cantidad_simuladores: number;
  cantidad_turnos: number;
  duracion: number;
  escuderia?: string;
  hash_unico: string;
};

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("turnos_historicos")
      .select("*")
      .order("fecha", { ascending: true })
      .order("hora_subida", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ turnos: data || [] });
  } catch (error) {
    console.error("GET turnos_historicos error:", error);
    return NextResponse.json(
      { error: "Error interno cargando turnos históricos" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const turnos = body.turnos as TurnoHistoricoBody[];

    if (!Array.isArray(turnos) || turnos.length === 0) {
      return NextResponse.json(
        { error: "No se recibieron turnos para guardar" },
        { status: 400 }
      );
    }

    const rows = turnos.map((t) => ({
      archivo_nombre: t.archivo_nombre,
      archivo_key: t.archivo_key,
      fecha: t.fecha,
      hora_subida: t.hora_subida || null,
      hora_bajada: t.hora_bajada || null,
      hora_tomado: t.hora_tomado || null,
      metodo_pago: t.metodo_pago,
      total: Number(t.total || 0),
      cantidad_simuladores: Number(t.cantidad_simuladores || 1),
      cantidad_turnos: Number(t.cantidad_turnos || 1),
      duracion: Number(t.duracion || 15),
      escuderia: t.escuderia || null,
      hash_unico: t.hash_unico,
      origen: "excel",
    }));

    const { error } = await supabaseAdmin
      .from("turnos_historicos")
      .upsert(rows, {
        onConflict: "hash_unico",
        ignoreDuplicates: true,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      recibidos: rows.length,
    });
  } catch (error) {
    console.error("POST turnos_historicos error:", error);
    return NextResponse.json(
      { error: "Error interno guardando turnos históricos" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const archivoKey = searchParams.get("archivo_key");

    if (!archivoKey) {
      return NextResponse.json(
        { error: "Falta archivo_key" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("turnos_historicos")
      .delete()
      .eq("archivo_key", archivoKey);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE turnos_historicos error:", error);
    return NextResponse.json(
      { error: "Error interno borrando importación" },
      { status: 500 }
    );
  }
}