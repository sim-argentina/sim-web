import { requireAdmin } from "@/lib/adminGuards";
import { errorApi } from "@/lib/interacciones";
import { validarParamsMetricas } from "@/lib/interaccionesMetricas";
import { metricas } from "@/lib/interaccionesMetricasServer";
import { inesperado, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Análisis de Interacciones: SOLO admin (staff → 403, sin sesión → 401).
// ?desde&hasta (fechas inclusivas de Córdoba) [&comp_desde&comp_hasta] [&filtros].
// Calcula sobre TODAS las filas del período (paginación verificada contra un
// conteo exacto), nunca sobre la primera página. Sin caché.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const p = validarParamsMetricas(new URL(req.url).searchParams);
    if (!p.ok) return responderError(errorApi("campo_invalido", { campo: p.campo }));
    const r = await metricas(p.valor, new Date());
    if (!r.ok) return responderFallo(r, "métricas");
    return responder(r.valor);
  } catch (error) {
    return inesperado("métricas", error);
  }
}
