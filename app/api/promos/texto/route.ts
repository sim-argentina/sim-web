import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { errorApi } from "@/lib/marketing/consentimiento";
import { textoParaFormulario } from "@/lib/marketing/consentimientoServer";
import { inesperado, noEncontrado, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Texto vigente de la aceptación de promociones (público), con el token firmado
// del momento en que se muestra. El formulario y la casilla del checkout lo
// muestran tal cual y devuelven versión, huella y token al confirmar.
//   · Captación apagada (MARKETING_CONSENTIMIENTO_ENABLED) → 404.
//   · Sin texto publicado (o sin secreto para firmar) → 503 consentimiento_no_habilitado.
// No recibe ningún teléfono ni dice nada de ningún contacto.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!marketingConsentimientoHabilitado()) return noEncontrado();
  if (!(await rateLimit(`promos-texto:${clientIp(req)}`, 60, 60_000))) return responderError(errorApi("demasiados_intentos"));
  try {
    const t = await textoParaFormulario(new Date());
    if (!t.ok) return responderFallo(t, "texto");
    if (!t.valor) return responderError(errorApi("consentimiento_no_habilitado"));
    return responder(t.valor);
  } catch (error) {
    return inesperado("promos texto GET", error);
  }
}
