import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Sus jornadas y apertura de la de hoy (una sola abierta). Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function GET(req: Request) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  return H.jornadasGet(a.actor, req);
}

export async function POST(req: Request) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  return H.jornadasPost(a.actor, req);
}
