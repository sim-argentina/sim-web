import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("tienda_productos")
    .select("*")
    .eq("activo", true)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ productos: data });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { nombre, descripcion, imagenes, caracteristicas, orden } = body;

  if (!nombre || !descripcion) {
    return NextResponse.json({ error: "Nombre y descripción son obligatorios" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("tienda_productos")
    .insert({
      nombre,
      descripcion,
      imagenes: imagenes ?? [],
      caracteristicas: caracteristicas ?? [],
      orden: orden ?? 0,
      activo: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ producto: data }, { status: 201 });
}
