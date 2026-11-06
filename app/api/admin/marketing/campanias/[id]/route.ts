import { requireAdmin, requireStaffOrAdmin } from "@/lib/adminGuards";
import { marketingCampaniasHabilitadas } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { errorCampanias } from "@/lib/marketing/campanias";
import {
  cambiarEstado,
  detalleCampania,
  ejecutarLote,
  prepararCampania,
  resolverIncierto,
  type AccionEstado,
} from "@/lib/marketing/campaniasServer";
import { campaniasDeshabilitadas, inesperado, leerCuerpo, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Marketing · una campaña (SIMULACIÓN). Con la llave maestra apagada
// (MARKETING_CAMPANIAS_ENABLED) todo responde 503 "Deshabilitado".
//   GET  → staff o admin: configuración, conteos, destinatarios (teléfono
//          enmascarado, sin nombre), historial y atribución.
//   POST → SOLO admin, solo en la base local de pruebas:
//          { accion: "preparar", version }            fija audiencia y beneficios ficticios.
//          { accion: "iniciar" | "pausar" | "reanudar" | "cancelar" }
//          { accion: "ejecutar_lote", tamano? }       un lote breve y reanudable.
//          { accion: "resolver_incierto", destinatario_id, decision: "reintentar" | "fallido" }
// Repetir cualquier acción es seguro: la base la reconoce como repetida.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADOS: AccionEstado[] = ["iniciar", "pausar", "reanudar", "cancelar"];

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!marketingCampaniasHabilitadas()) return campaniasDeshabilitadas();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return responderError(errorCampanias("campania_inexistente"));
  try {
    const r = await detalleCampania(id);
    if (!r.ok) return responderFallo(r, "campania detalle");
    return responder({ rol: auth.role, ...r.valor });
  } catch (error) {
    return inesperado("campania GET", error);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  if (!marketingCampaniasHabilitadas()) return campaniasDeshabilitadas();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return responderError(errorCampanias("campania_inexistente"));
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const b = (cuerpo.body ?? {}) as Record<string, unknown>;
    const accion = String(b.accion ?? "");

    if (accion === "preparar") {
      if (!Number.isInteger(b.version)) return responderError(errorCampanias("datos_invalidos", "version"));
      const r = await prepararCampania(id, Number(b.version), new Date());
      if (!r.ok) return responderFallo(r, "campania preparar");
      return responder(r.valor);
    }
    if ((ESTADOS as string[]).includes(accion)) {
      const r = await cambiarEstado(id, accion as AccionEstado);
      if (!r.ok) return responderFallo(r, `campania ${accion}`);
      return responder(r.valor);
    }
    if (accion === "ejecutar_lote") {
      const tamano = b.tamano === undefined ? undefined : Number(b.tamano);
      if (tamano !== undefined && !(Number.isInteger(tamano) && tamano >= 1 && tamano <= 50)) return responderError(errorCampanias("datos_invalidos", "tamano"));
      const r = await ejecutarLote(id, { tamano });
      if (!r.ok) return responderFallo(r, "campania lote");
      return responder({ lote: r.valor });
    }
    if (accion === "resolver_incierto") {
      const dest = typeof b.destinatario_id === "string" && UUID_RE.test(b.destinatario_id) ? b.destinatario_id : null;
      const decision = b.decision === "reintentar" || b.decision === "fallido" ? b.decision : null;
      if (!dest || !decision) return responderError(errorCampanias("datos_invalidos"));
      const r = await resolverIncierto(dest, decision);
      if (!r.ok) return responderFallo(r, "campania incierto");
      return responder(r.valor);
    }
    return responderError(errorCampanias("datos_invalidos", "accion"));
  } catch (error) {
    return inesperado("campania POST", error);
  }
}
