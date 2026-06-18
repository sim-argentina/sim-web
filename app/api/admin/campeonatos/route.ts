import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin
      .from("campeonatos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();

    if (!body.nombre?.trim()) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("campeonatos")
      .insert([
        {
          nombre: body.nombre.trim(),
          descripcion: body.descripcion || null,
          estado: body.estado || "proximo",
          fecha_inicio: body.fecha_inicio || null,
          fecha_fin: body.fecha_fin || null,
          precio_inscripcion: Number(body.precio_inscripcion) || 0,
          cupos_maximos: Number(body.cupos_maximos) || 0,
          inscripcion_habilitada: body.inscripcion_habilitada !== false,
          categorias: body.categorias || ["oro", "plata", "bronce"],
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
