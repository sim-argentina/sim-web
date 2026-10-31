import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Registro idempotente de una visita (clave + contenido). Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function POST(req: Request) {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  return H.visitasPost(a.actor, req);
}
