import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Detalle, km y gastos, y cierre de una jornada propia. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.jornadaGet(a.actor, id);
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.jornadaPatch(a.actor, req, id);
}
