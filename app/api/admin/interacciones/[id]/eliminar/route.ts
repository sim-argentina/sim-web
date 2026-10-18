import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { validarCuerpoEliminacion } from "@/lib/interacciones";
import { eliminar } from "@/lib/interaccionesServer";
import { idDeRuta, inesperado, leerCuerpo, noExiste, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Borrado administrativo con { version, motivo? }: SOLO admin (staff → 403 por
// requireAdmin, y la RPC lo vuelve a exigir con el rol de la sesión). Cualquier
// estado y fecha, también con las altas pausadas. Libera todos los vínculos (los
// turnos siguen en el Turnero) y la interacción deja de aparecer en listados,
// detalle y métricas. Versión vieja → 409; repetirlo → sin_cambios: true.

export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const id = idDeRuta((await context.params).id);
    if (!id) return noExiste();
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarCuerpoEliminacion(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    const r = await eliminar(id, v.valor, auth.role);
    if (!r.ok) return responderFallo(r, "eliminación");
    return responder(r.valor);
  } catch (error) {
    return inesperado("eliminar", error);
  }
}
