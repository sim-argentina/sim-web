import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Busca pilotos en inscripciones y registros de campeonatos.
// Devuelve nombre, apellido, telefono, categoria y escuderia para autocompletar el formulario.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ pilotos: [] });
  }

  const [insRes, regRes] = await Promise.all([
    supabaseAdmin
      .from("campeonato_inscripciones")
      .select("nombre, apellido, nombre_completo, telefono, categoria, escuderia_favorita")
      .or(`nombre_completo.ilike.%${q}%,telefono.ilike.%${q}%`)
      .eq("estado_pago", "pagado")
      .limit(10),
    supabaseAdmin
      .from("campeonato_registros")
      .select("nombre, apellido, nombre_completo, telefono, categoria, escuderia_favorita")
      .or(`nombre_completo.ilike.%${q}%,telefono.ilike.%${q}%`)
      .neq("estado", "anulado")
      .limit(10),
  ]);

  const combined = [...(insRes.data ?? []), ...(regRes.data ?? [])];

  // Deduplicar por teléfono (o nombre_completo si no hay teléfono)
  const seen = new Set<string>();
  const pilotos = combined.filter((p) => {
    const key = p.telefono?.trim() || p.nombre_completo?.trim() || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({ pilotos });
}
