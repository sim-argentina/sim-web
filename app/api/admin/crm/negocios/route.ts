import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Administración del CRM (B1): solo admin.
// Todos los negocios (filtros) y alta con responsable opcional. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function GET(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.negociosGet(a.actor, req);
}

export async function POST(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.negociosPost(a.actor, req);
}
