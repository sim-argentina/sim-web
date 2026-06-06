import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("sorteos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.titulo?.trim() || !body.premio?.trim()) {
      return NextResponse.json({ error: "Título y premio son obligatorios" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("sorteos")
      .insert([
        {
          titulo: body.titulo.trim(),
          descripcion: body.descripcion || null,
          premio: body.premio.trim(),
          estado: body.estado || "proximo",
          fecha_inicio: body.fecha_inicio || null,
          fecha_fin: body.fecha_fin || null,
          condiciones: body.condiciones || null,
          imagen_url: body.imagen_url || null,
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
