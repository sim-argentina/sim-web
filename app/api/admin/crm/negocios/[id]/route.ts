import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Administración del CRM (B1): solo admin.
// Ficha, edición, asignación y archivo. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.negocioGet(a.actor, id);
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.negocioPatch(a.actor, req, id);
}
