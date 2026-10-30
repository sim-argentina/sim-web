import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Sus negocios (búsqueda) y alta: queda asignado a quien lo crea. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function GET(req: Request) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  return H.negociosGet(a.actor, req);
}

export async function POST(req: Request) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  return H.negociosPost(a.actor, req);
}
