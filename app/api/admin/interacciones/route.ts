import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { LIMITES, errorApi, validarCuerpoAlta, validarFiltrosListado } from "@/lib/interacciones";
import { estadoModulo, listar, registrar } from "@/lib/interaccionesServer";
import { inesperado, leerCuerpo, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Interacciones del stand (Bloque 2). Contrato: docs/interacciones.md.
//   GET  → listado paginado + estado del módulo (staff y admin; staff acotado a
//          hoy − 2 … hoy, salvo estado=pendiente).
//   POST → alta idempotente (staff y admin). El rol sale de la sesión firmada;
//          rol, registrador o auditoría en el cuerpo → 400.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const ahora = new Date();
    const f = validarFiltrosListado(new URL(req.url).searchParams, auth.role, ahora);
    if (!f.ok) return responderError(f.e);
    const modulo = await estadoModulo();
    if (!modulo.ok) return responderFallo(modulo, "estado");
    if (!modulo.valor.instalado) return responderError(errorApi("modulo_no_instalado"));
    const r = await listar(f.valor, auth.role, ahora);
    if (!r.ok) return responderFallo(r, "listado");
    return responder({
      items: r.valor.items,
      siguiente: r.valor.siguiente,
      filtros: { ...f.valor, cursor: undefined },
      modulo: { ...modulo.valor, limites: LIMITES },
    });
  } catch (error) {
    return inesperado("GET", error);
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarCuerpoAlta(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    const r = await registrar(v.valor, auth.role, new Date());
    if (!r.ok) return responderFallo(r, "alta");
    return responder(r.valor, r.valor.repetida ? 200 : 201);
  } catch (error) {
    return inesperado("POST", error);
  }
}
