import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isGa4Configured, runRealtime } from "@/lib/ga4";

// Realtime GA4 (usuarios activos + páginas activas). TTL corto; si falla, degrada sin
// romper el resto de la pestaña. Guard de admin/staff. Sin PII.
let cache: { at: number; data: unknown } | null = null;
const TTL = 20_000;

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  if (!isGa4Configured()) {
    return NextResponse.json({ configured: false }, { headers: { "X-Robots-Tag": "noindex" } });
  }
  try {
    if (cache && Date.now() - cache.at < TTL) {
      return NextResponse.json(cache.data, { headers: { "X-Robots-Tag": "noindex" } });
    }
    const data = await runRealtime();
    cache = { at: Date.now(), data };
    return NextResponse.json(data, { headers: { "X-Robots-Tag": "noindex" } });
  } catch {
    // No bloquear la pestaña por un fallo de realtime.
    return NextResponse.json({ configured: true, error: true, usuariosActivos: 0, paginas: [] }, { headers: { "X-Robots-Tag": "noindex" } });
  }
}
