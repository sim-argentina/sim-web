import { logSecurityEvent } from "@/lib/apiError";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { MENSAJE_ALTA_OK, RUTA_ALTA, errorApi, textoPublico, validarAltaPublica } from "@/lib/marketing/consentimiento";
import { registrar, textoVigente } from "@/lib/marketing/consentimientoServer";
import { huellaIp } from "@/lib/marketing/huellaIp";
import { inesperado, leerCuerpo, noEncontrado, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Alta pública de promociones (formulario /promos). Contrato: lib/marketing/consentimiento.ts.
//   · La respuesta es la misma para cualquier número: no dice si ya estaba anotado.
//   · Evidencia: versión y huella del texto aceptado, página y huella de la IP
//     (nunca la IP). El rol lo fija la ruta: 'publico'.
//   · Si el texto cambió mientras la persona lo leía → 409 con el texto nuevo.
//   · Campo trampa lleno → misma respuesta, nada registrado.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!marketingConsentimientoHabilitado()) return noEncontrado();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const ip = clientIp(req);
  if (!(await rateLimit(`promos-alta:${ip}`, 5, 60_000))) return responderError(errorApi("demasiados_intentos"));
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarAltaPublica(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    if (v.valor.bot) {
      logSecurityEvent("promos_trampa_bot", { ruta: "alta" });
      return responder({ ok: true, mensaje: MENSAJE_ALTA_OK }, 201);
    }
    const evidencia: Record<string, string> = { pagina: RUTA_ALTA };
    const h = huellaIp(ip);
    if (h) evidencia.ip_hash = h;
    const r = await registrar(v.valor.clave, { ...v.valor.datos, evidencia }, "publico");
    if (!r.ok) {
      if (r.e?.codigo === "texto_desactualizado") {
        const t = await textoVigente();
        return responderError(r.e, t.ok && t.valor ? { texto: textoPublico(t.valor) } : {});
      }
      return responderFallo(r, "alta pública");
    }
    return responder({ ok: true, mensaje: MENSAJE_ALTA_OK }, r.valor.repetida ? 200 : 201);
  } catch (error) {
    return inesperado("promos alta POST", error);
  }
}
