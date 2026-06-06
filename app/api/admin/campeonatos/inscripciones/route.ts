import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const campeonato_id = url.searchParams.get("campeonato_id");
    const categoria = url.searchParams.get("categoria");
    const estado_pago = url.searchParams.get("estado_pago");
    const q = url.searchParams.get("q");

    let query = supabaseAdmin
      .from("campeonato_inscripciones")
      .select("*, campeonatos(nombre)")
      .order("created_at", { ascending: false });

    if (campeonato_id) query = query.eq("campeonato_id", campeonato_id);
    if (categoria) query = query.eq("categoria", categoria);
    if (estado_pago) query = query.eq("estado_pago", estado_pago);
    if (q) {
      query = query.or(
        `nombre_completo.ilike.%${q}%,dni.ilike.%${q}%,telefono.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
