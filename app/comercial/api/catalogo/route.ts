import { actorComercial } from "@/lib/crmHttp";
import * as H from "@/lib/crmB1Rutas";

// Interfaz comercial del CRM (B1): solo usuarios comerciales; alcance = sus negocios, jornadas y revisitas.
// Rubros y zonas activos para los formularios. Lógica y permisos: lib/crmB1Rutas.ts, lib/crmB1Server.ts y las RPCs.

export async function GET() {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  return H.catalogoGet(a.actor);
}
