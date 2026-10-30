import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Reprogramar o cancelar una revisita propia. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.tareaPatch(a.actor, req, id);
}
