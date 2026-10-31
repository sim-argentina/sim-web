import { actorComercial, json, leer } from "@/lib/crmHttp";
import { inicioComercial } from "@/lib/crmB1Server";

// Interfaz comercial del CRM (B1): pantalla de inicio del comercial — jornada
// abierta, jornadas y visitas de hoy, revisitas pendientes y contadores de SUS
// negocios. Solo usuarios comerciales.
export async function GET() {
  const a = await actorComercial();
  if (!a.ok) return a.response;
  const r = await leer("crm inicio", () => inicioComercial(a.actor, a.nombre));
  return r.ok ? json(r.valor) : r.response;
}
