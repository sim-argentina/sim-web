import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { validarCuerpoCierre } from "@/lib/interacciones";
import { cerrarSinVinculo } from "@/lib/interaccionesServer";
import { idDeRuta, inesperado, leerCuerpo, noExiste, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Cierre sin vínculo: SOLO admin (staff → 403 por requireAdmin, y la RPC lo
// vuelve a exigir). { version, motivo, nota? }; 'otro' exige nota. Sigue siendo
// una subida DECLARADA: no verifica la subida ni una venta.

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
    const v = validarCuerpoCierre(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    const r = await cerrarSinVinculo(id, v.valor, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "cierre");
    return responder(r.valor);
  } catch (error) {
    return inesperado("cierre", error);
  }
}
