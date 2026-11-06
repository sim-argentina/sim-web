import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { estadoMarketing } from "@/lib/marketing/estadoMarketing";
import { responder } from "@/lib/marketing/http";

// Marketing · diagnóstico PRIVADO (staff y admin): qué llaves de entorno están
// encendidas. Con todo apagado dice "Deshabilitado". No lee la base ni muestra
// valores de variables. Lo usa el encabezado de /admin/marketing.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  return responder(estadoMarketing());
}
