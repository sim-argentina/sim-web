import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Administración del CRM (B1): solo admin.
// Registro de una visita realizada por un comercial (realizada por ≠ cargada por). Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function POST(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.visitasPost(a.actor, req);
}
