import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("novedades")
    .select("*")
    .eq("activo", true)
    .order("destacado", { ascending: false })
    .order("orden", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("novedades GET:", error.message);
    return NextResponse.json({ error: "Error al cargar novedades" }, { status: 500 });
  }

  return NextResponse.json({ novedades: data });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json();

  const { titulo, subtitulo, descripcion, categoria, tag, link, boton, destacado, orden, fecha_inicio, fecha_fin } = body;

  if (!titulo || !descripcion || !categoria) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("novedades")
    .insert({
      titulo,
      subtitulo: subtitulo || null,
      descripcion,
      categoria,
      tag: tag || null,
      link: link || null,
      boton: boton || null,
      destacado: destacado ?? false,
      orden: orden ?? 0,
      fecha_inicio: fecha_inicio || null,
      fecha_fin: fecha_fin || null,
      activo: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ novedad: data }, { status: 201 });
}
