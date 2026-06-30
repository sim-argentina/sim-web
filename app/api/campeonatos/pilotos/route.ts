import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";

// Busca pilotos en inscripciones y registros de campeonatos (uso interno del panel).
// Devuelve nombre, apellido, telefono, categoria y escuderia para autocompletar el formulario.

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = sanitizeSearchTerm(searchParams.get("q"));

  if (!q || q.length < 2) {
    return NextResponse.json({ pilotos: [] });
  }

  const [insRes, regRes] = await Promise.all([
    supabaseAdmin
      .from("campeonato_inscripciones")
      .select("id, nombre, apellido, nombre_completo, telefono, categoria, escuderia_favorita")
      .or(`nombre_completo.ilike.%${q}%,telefono.ilike.%${q}%`)
      .eq("estado_pago", "pagado")
      .is("eliminada_at", null)
      .limit(10),
    supabaseAdmin
      .from("campeonato_registros")
      .select("nombre, apellido, nombre_completo, telefono, categoria, escuderia_favorita, inscripcion_id")
      .or(`nombre_completo.ilike.%${q}%,telefono.ilike.%${q}%`)
      .neq("estado", "anulado")
      .limit(10),
  ]);

  // Las inscripciones aportan el inscripcion_id estable (su propio id) → identidad híbrida.
  const insMapped = (insRes.data ?? []).map((p: Record<string, unknown>) => ({
    nombre: p.nombre,
    apellido: p.apellido,
    nombre_completo: p.nombre_completo,
    telefono: p.telefono,
    categoria: p.categoria,
    escuderia_favorita: p.escuderia_favorita,
    inscripcion_id: p.id,
  }));
  const combined = [...insMapped, ...(regRes.data ?? [])];

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
