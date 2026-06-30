import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

// Resumen de penalizaciones generadas por cierre de fecha. Sin PII (solo el
// nombre para mostrar). Filtrable por campeonato.
export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const campeonato_id = new URL(req.url).searchParams.get("campeonato_id");
    let query = supabaseAdmin
      .from("campeonato_penalizaciones")
      .select(
        "id, campeonato_id, categoria, fecha_origen_id, fecha_destino_id, piloto_key, inscripcion_id, piloto_nombre, posicion, penalizacion_ms, created_at"
      )
      .order("created_at", { ascending: false });
    if (campeonato_id) {
      if (!isValidUuid(campeonato_id)) return NextResponse.json([]);
      query = query.eq("campeonato_id", campeonato_id);
    }
    const { data, error } = await query;
    if (error)
      return failResponse(500, "No se pudo completar la operación", {
        logContext: "admin/campeonatos/penalizaciones GET",
        error,
      });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
