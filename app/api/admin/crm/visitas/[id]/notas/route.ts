import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Administración del CRM (B1): solo admin.
// Observación posterior sobre una visita. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.visitaNotaPost(a.actor, req, id);
}
