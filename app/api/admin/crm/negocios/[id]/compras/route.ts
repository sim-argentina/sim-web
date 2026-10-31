import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB3Rutas";

// Administración del CRM (B3): solo admin. Historial de compras del negocio (ficha).

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.comprasGet(id);
}
