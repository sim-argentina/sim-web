import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { validarCuerpoVinculo, validarDesvinculo } from "@/lib/interacciones";
import { desvincular, vincular } from "@/lib/interaccionesServer";
import { idDeRuta, inesperado, leerCuerpo, noExiste, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Vínculos con el Turnero (solo turnos_stand).
//   POST   { version, turnos: ["<id>", …] } → vincula (también completa una
//          pendiente vieja: sin ventana de tiempo). La tolerancia se mide contra la
//          fecha de la INTERACCIÓN. Si había un cierre sin turno, se retira
//          (advertencia cierre_retirado).
//   DELETE ?turno=<id>&version=<n> → desvincula. Staff: hasta 48 h del alta.
// Los IDs de turnos viajan como cadenas decimales.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Ctx) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const id = idDeRuta((await context.params).id);
    if (!id) return noExiste();
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarCuerpoVinculo(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    const r = await vincular(id, v.valor, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "vínculo");
    return responder(r.valor);
  } catch (error) {
    return inesperado("POST turnos", error);
  }
}

export async function DELETE(req: Request, context: Ctx) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const id = idDeRuta((await context.params).id);
    if (!id) return noExiste();
    const v = validarDesvinculo(new URL(req.url).searchParams);
    if (!v.ok) return responderError(v.e);
    const r = await desvincular(id, v.valor, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "desvínculo");
    return responder(r.valor);
  } catch (error) {
    return inesperado("DELETE turnos", error);
  }
}
