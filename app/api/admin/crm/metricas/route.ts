import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB4Rutas";

// Administración del CRM (B4): solo admin. Tablero de métricas y el detalle de cada cifra (?detalle=<id>), solo lectura.

export async function GET(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.metricasGet(req);
}
