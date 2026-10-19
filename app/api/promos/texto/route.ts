import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { errorApi, textoPublico } from "@/lib/marketing/consentimiento";
import { textoVigente } from "@/lib/marketing/consentimientoServer";
import { inesperado, noEncontrado, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Texto vigente de la aceptación de promociones (público). El formulario lo
// muestra tal cual y devuelve su versión y huella al confirmar.
//   · Llave de entorno apagada (MARKETING_CONSENTIMIENTO_ENABLED) → 404.
//   · Sin texto publicado → 503 consentimiento_no_habilitado.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!marketingConsentimientoHabilitado()) return noEncontrado();
  if (!(await rateLimit(`promos-texto:${clientIp(req)}`, 60, 60_000))) return responderError(errorApi("demasiados_intentos"));
  try {
    const t = await textoVigente();
    if (!t.ok) return responderFallo(t, "texto");
    if (!t.valor) return responderError(errorApi("consentimiento_no_habilitado"));
    return responder({ texto: textoPublico(t.valor) });
  } catch (error) {
    return inesperado("promos texto GET", error);
  }
}
