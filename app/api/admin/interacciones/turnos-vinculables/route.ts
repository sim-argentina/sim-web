import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { validarParamsVinculables } from "@/lib/interacciones";
import { turnosVinculables } from "@/lib/interaccionesServer";
import { inesperado, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Turnos del Turnero para vincular (staff y admin). Solo turnos_stand activos,
// con los datos mínimos para reconocerlos (sin nombre, teléfono, observaciones
// ni cabina). Por defecto las 2 h previas a la interacción; ?alcance=dia|tolerancia
// amplía sin salir de la tolerancia. Orienta la pantalla: la RPC revalida al vincular.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const p = validarParamsVinculables(new URL(req.url).searchParams);
    if (!p.ok) return responderError(p.e);
    const r = await turnosVinculables(p.valor, new Date());
    if (!r.ok) return responderFallo(r, "turnos vinculables");
    return responder(r.valor);
  } catch (error) {
    return inesperado("turnos vinculables", error);
  }
}
