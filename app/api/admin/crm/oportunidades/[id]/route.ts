import { actorAdmin } from "@/lib/crmHttp";
import * as H from "@/lib/crmB2Rutas";

// Administración del CRM (B2): solo admin.
// Detalle de una oportunidad (consultar no la gestiona) y toda su gestión por la RPC crm_oportunidad_gestionar.

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.oportunidadGet(id);
}

export async function POST(req: Request, { params }: RouteContext) {
  const a = await actorAdmin();
  if (!a.ok) return a.response;
  const { id } = await params;
  return H.oportunidadPost(req, id);
}
