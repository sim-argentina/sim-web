import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { validarCuerpoAnulacion } from "@/lib/interacciones";
import { anular } from "@/lib/interaccionesServer";
import { idDeRuta, inesperado, leerCuerpo, noExiste, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Anulación (baja lógica) con { version, motivo? }. Libera los turnos y lo informa
// en advertencias (turnos_liberados). Staff: hasta 48 h después del alta. Repetirla
// devuelve la misma interacción con sin_cambios: true.

export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const id = idDeRuta((await context.params).id);
    if (!id) return noExiste();
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarCuerpoAnulacion(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    const r = await anular(id, v.valor, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "anulación");
    return responder(r.valor);
  } catch (error) {
    return inesperado("anular", error);
  }
}
