import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/security";
import { estadoPublicoBracket } from "@/lib/bracketPublic";

type RouteContext = { params: Promise<{ id: string }> };

// GET público READ-ONLY del bracket de un campeonato de eliminación. Solo SELECT
// (reutiliza obtenerEstado, que no crea/persiste nada). DTO con allowlist: sin PII.
export async function GET(req: Request, { params }: RouteContext) {
  if (!(await rateLimit(`camp-bracket:${clientIp(req)}`, 120, 60_000))) {
    return tooManyResponse();
  }
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404, headers: { "X-Robots-Tag": "noindex" } });
    }

    const res = await estadoPublicoBracket(id);
    if (!res.ok) {
      return NextResponse.json({ error: "Campeonato no encontrado" }, { status: res.status, headers: { "X-Robots-Tag": "noindex" } });
    }

    // Caché de edge acorde al estado: corta durante el torneo (live), larga al finalizar.
    // La API nunca es indexable (noindex); la página /campeonatos sí lo es.
    const cache =
      res.estado === "finalizado" ? "public, s-maxage=300, stale-while-revalidate=600"
      : res.estado === "en_curso" ? "public, s-maxage=8, stale-while-revalidate=15"
      : res.estado === "no_aplica" ? "public, s-maxage=600, stale-while-revalidate=1200"
      : "public, s-maxage=15, stale-while-revalidate=30";

    return NextResponse.json(res.data, {
      status: 200,
      headers: { "Cache-Control": cache, "X-Robots-Tag": "noindex" },
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500, headers: { "X-Robots-Tag": "noindex" } });
  }
}
