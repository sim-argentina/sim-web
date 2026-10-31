import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB2Rutas";

// Administración del CRM (B2): solo admin.
// Bandeja "Contactos para seguir": grupos, contadores y filas sobre la misma lista. Lógica: lib/crmB2Rutas.ts y lib/crmB2Server.ts.

export async function GET(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.seguimientoGet(req);
}
