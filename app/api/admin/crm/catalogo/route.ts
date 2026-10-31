import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Administración del CRM (B1): solo admin.
// Rubros, zonas y usuarios comerciales; alta de rubro o zona. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function GET() {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.catalogoGet(a.actor);
}

export async function POST(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.catalogoGuardar(a.actor, req, null);
}
