import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB3Rutas";

// Administración del CRM (B3): solo admin. Oportunidad de recompra con un contacto existente.

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.recompraPost(req, id);
}
