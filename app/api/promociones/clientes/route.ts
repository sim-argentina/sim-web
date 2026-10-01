import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";
import { hoyEnSim, sumarDias } from "@/lib/agenda";
import { rankingPromociones, type RegistroPromo } from "@/lib/promocionesRanking";

// Promociones: agrega clientes del Turnero por ACTIVIDAD REAL.
// - (B9) La actividad se mide en minutos comerciales (lib/promocionesRanking):
//   legacy = cantidad_turnos × 15 (lo de siempre), v2 = minutos × personas. Así
//   un turno de 30 legacy y uno de 30 v2 pesan lo mismo; SUM(cantidad_turnos)
//   mezclaba bloques de 15 y de 10.
// - Solo personas con nombre Y teléfono válidos (no vacíos ni espacios).
// - Sin búsqueda: Top 10 por minutos. Con búsqueda: solo coincidencias.
// La agregación se hace server-side (en el route handler): el navegador solo
// recibe el Top 10 o los resultados de búsqueda, nunca todos los turnos.

const TOP_N = 10;
const MAX_BUSQUEDA = 50;
// PostgREST corta cada respuesta en 1000 filas: se lee en lotes (con "Histórico"
// el Turnero ya supera ese número y el ranking salía de un subconjunto).
const LOTE = 1000;

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  const q = sanitizeSearchTerm(searchParams.get("q")).trim();
  const diasRaw = Number(searchParams.get("dias") || 30);
  const dias = Number.isFinite(diasRaw) && diasRaw > 0 ? diasRaw : 30;
  const historico = searchParams.get("historico") === "true";
  // (B9) Ventana por la fecha comercial de Argentina (antes, fecha UTC).
  const fechaDesde = historico ? null : sumarDias(hoyEnSim(), -Math.floor(dias));

  const filas: RegistroPromo[] = [];
  for (let desde = 0; ; desde += LOTE) {
    let query = supabaseAdmin
      .from("turnos_stand")
      .select("nombre, telefono, fecha, total, cantidad_turnos, cantidad_personas, cantidad_simuladores, cantidad_minutos, modalidad")
      .neq("estado", "cancelado")
      .not("nombre", "is", null)
      .not("telefono", "is", null)
      .order("id", { ascending: true })
      .range(desde, desde + LOTE - 1);
    if (fechaDesde) query = query.gte("fecha", fechaDesde);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: "Error cargando clientes de promociones" },
        { status: 500 }
      );
    }
    const lote = (data ?? []) as RegistroPromo[];
    filas.push(...lote);
    if (lote.length < LOTE) break;
  }

  const clientes = rankingPromociones(filas, { q, topN: TOP_N, maxBusqueda: MAX_BUSQUEDA });
  return NextResponse.json({ clientes });
}
