import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB3Rutas";

// Administración del CRM (B3): solo admin. Catálogo de productos y comisiones de lista.

export async function GET() {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.productosGet();
}

export async function PATCH(req: Request) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  return H.productoPatch(req);
}
