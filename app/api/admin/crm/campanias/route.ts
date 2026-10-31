import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB3Rutas";

// Administración del CRM (B3): solo admin. Búsqueda de campañas de Empresas para vincular (solo lectura).

export async function GET(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.campaniasGet(req);
}
