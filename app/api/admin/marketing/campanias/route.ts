import { requireAdmin, requireStaffOrAdmin } from "@/lib/adminGuards";
import { marketingCampaniasHabilitadas } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import {
  PROPUESTA_SIN_APROBAR,
  SIMULACION_POR_DEFECTO,
  VARIABLES_MENSAJE,
  capacidadesCodigos,
  errorCampanias,
  validarDatosCampania,
} from "@/lib/marketing/campanias";
import {
  campaniasInstaladas,
  evaluarEntornoCampanias,
  guardarCampania,
  listarCampanias,
  vistaPrevia,
} from "@/lib/marketing/campaniasServer";
import { campaniasDeshabilitadas, inesperado, leerCuerpo, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Marketing · campañas (SIMULACIÓN). Ver lib/marketing/campaniasServer.ts.
// Con la llave maestra apagada (MARKETING_CAMPANIAS_ENABLED) todo responde 503
// "Deshabilitado" antes de mirar la sesión o la base.
//   GET  → staff o admin: campañas, entorno (si esta base admite escribir) y
//          lo que hace cumplir hoy el módulo de Códigos.
//   POST → SOLO admin:
//          { accion: "vista_previa", datos }   audiencia calculada, sin escribir nada.
//          { accion: "guardar", id?, version?, clave?, datos }   crea (clave = doble
//          clic) o edita un borrador; solo en la base local de pruebas.
// El rol sale de la sesión firmada; nada del cuerpo decide autoridad.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  if (!marketingCampaniasHabilitadas()) return campaniasDeshabilitadas();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const entorno = evaluarEntornoCampanias();
    const instaladas = await campaniasInstaladas();
    if (!instaladas.ok) return responderFallo(instaladas, "campanias estado");
    const lista = instaladas.valor ? await listarCampanias() : { ok: true as const, valor: [] };
    if (!lista.ok) return responderFallo(lista, "campanias lista");
    return responder({
      rol: auth.role,
      instaladas: instaladas.valor,
      entorno: { escritura: entorno.escritura, motivo: entorno.motivo },
      campanias: lista.valor,
      propuesta_sin_aprobar: PROPUESTA_SIN_APROBAR,
      simulacion_por_defecto: SIMULACION_POR_DEFECTO,
      variables: VARIABLES_MENSAJE,
      capacidades: capacidadesCodigos(["reserva", "gift_card"]),
    });
  } catch (error) {
    return inesperado("campanias GET", error);
  }
}

export async function POST(req: Request) {
  if (!marketingCampaniasHabilitadas()) return campaniasDeshabilitadas();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const b = (cuerpo.body ?? {}) as Record<string, unknown>;
    const v = validarDatosCampania(b.datos);
    if (!v.ok) return responder({ ...errorCampanias("datos_invalidos"), errores: v.errores }, 400);

    if (b.accion === "vista_previa") {
      const r = await vistaPrevia(v.valor, new Date(), v.advertencias, typeof b.id === "string" && UUID_RE.test(b.id) ? b.id : null);
      if (!r.ok) return responderFallo(r, "campanias vista previa");
      return responder({ vista_previa: r.valor });
    }
    if (b.accion === "guardar") {
      const id = b.id === undefined || b.id === null ? null : typeof b.id === "string" && UUID_RE.test(b.id) ? b.id : "invalido";
      const clave = typeof b.clave === "string" && UUID_RE.test(b.clave) ? b.clave : null;
      const version = Number.isInteger(b.version) ? Number(b.version) : null;
      if (id === "invalido" || (id === null && !clave) || (id !== null && version === null)) return responderError(errorCampanias("datos_invalidos"));
      const r = await guardarCampania({ id, version, clave, datos: v.valor });
      if (!r.ok) return responderFallo(r, "campanias guardar");
      return responder({ campania: r.valor.campania, repetida: r.valor.repetida, advertencias: v.advertencias }, id === null && !r.valor.repetida ? 201 : 200);
    }
    return responderError(errorCampanias("datos_invalidos", "accion"));
  } catch (error) {
    return inesperado("campanias POST", error);
  }
}
