import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { eventoParaListado, telefonoDeConsulta, validarAccionPanel } from "@/lib/marketing/consentimiento";
import {
  consultarTelefono,
  moduloInstalado,
  recientes,
  registrar,
  resumen,
  textoVigente,
} from "@/lib/marketing/consentimientoServer";
import { inesperado, leerCuerpo, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Marketing · registro de consentimiento y bajas en el panel (staff y admin).
//   GET  → estado del módulo, resumen de 14 días, últimos eventos (teléfono
//          enmascarado, sin nombre ni evidencia) y, con ?telefono=, el estado y
//          el historial completo de ese número.
//   POST → { accion: "baja" } staff o admin, a pedido por otro canal.
//          { accion: "alta" } SOLO admin, con evidencia escrita y versión del
//          texto. Un alta del panel no revierte una baja (409 baja_vigente).
// El rol sale de la sesión firmada; nada del cuerpo decide autoridad.

export const dynamic = "force-dynamic";

const DIAS_RESUMEN = 14;

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const q = telefonoDeConsulta(new URL(req.url).searchParams.get("telefono"));
    if (!q.ok) return responderError(q.e);
    const formulario_publico = marketingConsentimientoHabilitado();
    const instalado = await moduloInstalado();
    if (!instalado.ok) return responderFallo(instalado, "estado");
    if (!instalado.valor) return responder({ modulo: { instalado: false, formulario_publico, texto_vigente: null }, rol: auth.role });

    const desde = new Date(Date.now() - DIAS_RESUMEN * 86_400_000);
    const [vigente, res, rec, consulta] = await Promise.all([
      textoVigente(),
      resumen(desde),
      recientes(30),
      q.valor ? consultarTelefono(q.valor) : Promise.resolve(null),
    ]);
    if (!vigente.ok) return responderFallo(vigente, "texto vigente");
    if (!res.ok) return responderFallo(res, "resumen");
    if (!rec.ok) return responderFallo(rec, "recientes");
    if (consulta && !consulta.ok) return responderFallo(consulta, "consulta");

    return responder({
      rol: auth.role,
      modulo: {
        instalado: true,
        formulario_publico,
        texto_vigente: vigente.valor
          ? { version: vigente.valor.version, titulo: vigente.valor.titulo, publicado_en: vigente.valor.publicado_en }
          : null,
      },
      resumen: { ...res.valor, dias: DIAS_RESUMEN },
      recientes: rec.valor.map(eventoParaListado),
      consulta: consulta && consulta.ok ? { telefono: q.valor, ...consulta.valor } : null,
    });
  } catch (error) {
    return inesperado("panel consentimientos GET", error);
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarAccionPanel(cuerpo.body, auth.role, new Date());
    if (!v.ok) return responderError(v.e);
    const r = await registrar(v.valor.clave, v.valor.datos, auth.role);
    if (!r.ok) return responderFallo(r, "panel registro");
    return responder({ registrado: r.valor }, r.valor.repetida ? 200 : 201);
  } catch (error) {
    return inesperado("panel consentimientos POST", error);
  }
}
