import { logSecurityEvent } from "@/lib/apiError";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { MENSAJE_ALTA_RECIBIDA, RUTA_ALTA, errorApi, validarAltaPublica } from "@/lib/marketing/consentimiento";
import { registrar, textoParaFormulario } from "@/lib/marketing/consentimientoServer";
import { huellaIp } from "@/lib/marketing/huellaIp";
import { inesperado, leerCuerpo, noEncontrado, responder, responderError, responderFallo } from "@/lib/marketing/http";
import { verificarTokenFormulario } from "@/lib/marketing/tokenFormulario";

// Alta pública de promociones (formulario /promos). Contrato: lib/marketing/consentimiento.ts.
//   · La respuesta de éxito es la misma para cualquier número E HISTORIAL: no dice
//     si ya estaba anotado ni si pidió la baja. Un formulario mostrado antes de una
//     baja se registra y responde igual, pero no la revierte (la base lo resuelve
//     por la fecha de origen); por eso el mensaje dice la condición y no confirma.
//   · Evidencia: versión y huella del texto aceptado, momento FIRMADO en que se
//     mostró (token), página y huella de la IP (nunca la IP). Rol fijo: 'publico'.
//   · Texto cambiado (es igual para todos) o token vencido/inválido (depende solo
//     del formulario) → 409 con el texto y un token nuevos: volver a leer y confirmar.
//   · Campo trampa lleno → misma respuesta de éxito, nada registrado.

export const dynamic = "force-dynamic";

/** 409 con el texto vigente y un token nuevo; si ya no hay texto que mostrar, 503. */
async function conTextoNuevo(codigo: "texto_desactualizado" | "formulario_vencido") {
  // Ninguno de los dos depende del número: el texto es el mismo para todos y el
  // vencimiento sale del token que tiene en la mano quien envía.
  const t = await textoParaFormulario(new Date());
  if (!t.ok) return responderFallo(t, "texto nuevo");
  if (!t.valor) return responderError(errorApi("consentimiento_no_habilitado"));
  return responderError(errorApi(codigo), t.valor);
}

export async function POST(req: Request) {
  if (!marketingConsentimientoHabilitado()) return noEncontrado();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const ip = clientIp(req);
  if (!(await rateLimit(`promos-alta:${ip}`, 5, 60_000))) return responderError(errorApi("demasiados_intentos"));
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarAltaPublica(cuerpo.body);
    if (!v.ok) return v.e.codigo === "formulario_vencido" ? conTextoNuevo("formulario_vencido") : responderError(v.e);
    if (v.valor.bot) {
      logSecurityEvent("promos_trampa_bot", { ruta: "alta" });
      return responder({ ok: true, mensaje: MENSAJE_ALTA_RECIBIDA }, 201);
    }
    const token = verificarTokenFormulario(v.valor.token, v.valor.datos.texto_version ?? "", new Date());
    if (!token.ok) {
      if (token.motivo === "sin_secreto") return responderError(errorApi("consentimiento_no_habilitado"));
      return conTextoNuevo("formulario_vencido");
    }
    const evidencia: Record<string, string> = { pagina: RUTA_ALTA };
    const h = huellaIp(ip);
    if (h) evidencia.ip_hash = h;
    const r = await registrar(v.valor.clave, { ...v.valor.datos, evidencia, solicitado_en: token.emitidoEn.toISOString() }, "publico");
    if (!r.ok) {
      if (r.e?.codigo === "texto_desactualizado") return conTextoNuevo(r.e.codigo);
      return responderFallo(r, "alta pública");
    }
    return responder({ ok: true, mensaje: MENSAJE_ALTA_RECIBIDA }, r.valor.repetida ? 200 : 201);
  } catch (error) {
    return inesperado("promos alta POST", error);
  }
}
