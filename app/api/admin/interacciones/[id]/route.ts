import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { validarCuerpoEdicion } from "@/lib/interacciones";
import { detalle, editar } from "@/lib/interaccionesServer";
import { idDeRuta, inesperado, leerCuerpo, noExiste, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Una interacción (Bloque 2).
//   GET   → detalle (interaccion_detalle) con versión, estado del vínculo,
//           permisos del rol y advertencias.
//   PATCH → edición parcial con { version, cambios, confirmar_liberacion? }: lo
//           omitido no cambia, null vacía. Si el cambio libera turnos o retira un
//           cierre, sin confirmar_liberacion → 409 confirmar_liberacion.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: Ctx) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const id = idDeRuta((await context.params).id);
    if (!id) return noExiste();
    const r = await detalle(id, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "detalle");
    return responder({ interaccion: r.valor });
  } catch (error) {
    return inesperado("GET [id]", error);
  }
}

export async function PATCH(req: Request, context: Ctx) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const id = idDeRuta((await context.params).id);
    if (!id) return noExiste();
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarCuerpoEdicion(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    const r = await editar(id, v.valor, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "edición");
    return responder(r.valor);
  } catch (error) {
    return inesperado("PATCH [id]", error);
  }
}
