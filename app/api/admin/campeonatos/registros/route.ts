import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function tiempoASegundos(tiempo: string): number {
  if (!tiempo?.trim()) return 999999;
  const t = tiempo.trim();
  if (t.includes(":")) {
    const [mins, secs] = t.split(":");
    return parseFloat(mins) * 60 + parseFloat(secs || "0");
  }
  return parseFloat(t) || 999999;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const nombre = url.searchParams.get("nombre");
    const campeonato_id = url.searchParams.get("campeonato_id");
    const categoria = url.searchParams.get("categoria");
    const circuito = url.searchParams.get("circuito");
    const estado = url.searchParams.get("estado");
    const fecha = url.searchParams.get("fecha");

    let query = supabaseAdmin
      .from("campeonato_registros")
      .select("*, campeonatos(nombre)")
      .order("created_at", { ascending: false });

    if (nombre) query = query.ilike("nombre_completo", `%${nombre}%`);
    if (campeonato_id) query = query.eq("campeonato_id", campeonato_id);
    if (categoria) query = query.eq("categoria", categoria);
    if (circuito) query = query.eq("circuito", circuito);
    if (estado) query = query.eq("estado", estado);
    if (fecha) query = query.eq("fecha", fecha);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.nombre?.trim() || !body.fecha || !body.categoria) {
      return NextResponse.json(
        { error: "Nombre, fecha y categoría son obligatorios" },
        { status: 400 }
      );
    }

    const nombre_completo = `${body.nombre || ""} ${body.apellido || ""}`.trim();
    const tiempo_segundos = tiempoASegundos(body.tiempo || "");

    const { data, error } = await supabaseAdmin
      .from("campeonato_registros")
      .insert([
        {
          fecha: body.fecha,
          hora: body.hora || null,
          nombre: body.nombre.trim(),
          apellido: body.apellido?.trim() || null,
          nombre_completo,
          telefono: body.telefono || null,
          categoria: body.categoria,
          campeonato_id: body.campeonato_id || null,
          campeonato_fecha_id: body.campeonato_fecha_id || null,
          circuito: body.circuito || null,
          tiempo: body.tiempo || null,
          tiempo_segundos,
          simulador: body.simulador || null,
          puntos: Number(body.puntos) || 0,
          semana: Number(body.semana) || 1,
          escuderia_favorita: body.escuderia_favorita || null,
          observaciones: body.observaciones || null,
          estado: body.estado || "valido",
        },
      ])
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
