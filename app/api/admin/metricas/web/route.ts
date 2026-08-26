import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { resolveRange, esRangeKey, type RangeKey } from "@/lib/metricasWebRange";
import { isGa4Configured, runWeb } from "@/lib/ga4";
import { negocioWeb } from "@/lib/metricasWebNegocio";

// Analítica Web (Admin → Métricas → Web). SOLO servidor, guard de admin/staff. Nunca
// devuelve secretos ni PII. Cache server-side corto para no golpear la GA4 Data API.
type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL = 5 * 60 * 1000; // histórico: 5 min

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(req.url);
    const rangeKey: RangeKey = esRangeKey(url.searchParams.get("range")) ? (url.searchParams.get("range") as RangeKey) : "7d";
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const { current, previous } = resolveRange(rangeKey, { start, end });

    // Datos reales de negocio (Supabase): siempre disponibles, incluso sin GA4.
    const negocio = await negocioWeb(current);

    if (!isGa4Configured()) {
      // Estado "no configurado": la UI muestra los bloques GA4 como no disponibles,
      // pero conserva los datos reales de negocio.
      return NextResponse.json({ configured: false, range: current, previous, negocio }, { headers: { "X-Robots-Tag": "noindex" } });
    }

    const cacheKey = `${rangeKey}:${current.start}:${current.end}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL) {
      return NextResponse.json({ ...(hit.data as object), negocio }, { headers: { "X-Robots-Tag": "noindex" } });
    }

    const web = await runWeb(current, previous);
    cache.set(cacheKey, { at: Date.now(), data: web });
    if (cache.size > 40) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);

    return NextResponse.json({ ...web, negocio }, { headers: { "X-Robots-Tag": "noindex" } });
  } catch {
    return NextResponse.json({ error: "No se pudo obtener la analítica web." }, { status: 500 });
  }
}
