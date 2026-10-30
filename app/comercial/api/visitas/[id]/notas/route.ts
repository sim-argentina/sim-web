import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Observación posterior sobre una visita propia (no reemplaza la original). Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.visitaNotaPost(a.actor, req, id);
}
