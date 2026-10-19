import { logSecurityEvent } from "@/lib/apiError";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { MENSAJE_BAJA_OK, RUTA_BAJA, errorApi, validarBajaPublica } from "@/lib/marketing/consentimiento";
import { registrar } from "@/lib/marketing/consentimientoServer";
import { huellaIp } from "@/lib/marketing/huellaIp";
import { inesperado, leerCuerpo, noEncontrado, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Baja pública de promociones (formulario /promos/baja). Ley 25.326 art. 27: el
// retiro se puede pedir siempre y sin explicar nada.
//   · Se registra aunque el número nunca se haya anotado (lista de supresión).
//   · La respuesta es siempre la misma: no confirma si el número estaba anotado.
//   · No depende del texto vigente: con las altas cerradas, las bajas siguen.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!marketingConsentimientoHabilitado()) return noEncontrado();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const ip = clientIp(req);
  if (!(await rateLimit(`promos-baja:${ip}`, 10, 60_000))) return responderError(errorApi("demasiados_intentos"));
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarBajaPublica(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    if (v.valor.bot) {
      logSecurityEvent("promos_trampa_bot", { ruta: "baja" });
      return responder({ ok: true, mensaje: MENSAJE_BAJA_OK });
    }
    const evidencia: Record<string, string> = { pagina: RUTA_BAJA };
    const h = huellaIp(ip);
    if (h) evidencia.ip_hash = h;
    const r = await registrar(v.valor.clave, { ...v.valor.datos, evidencia }, "publico");
    if (!r.ok) return responderFallo(r, "baja pública");
    return responder({ ok: true, mensaje: MENSAJE_BAJA_OK });
  } catch (error) {
    return inesperado("promos baja POST", error);
  }
}
