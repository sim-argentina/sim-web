import { requireAdmin } from "@/lib/adminGuards";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { validarAccionTexto } from "@/lib/marketing/consentimiento";
import { listarTextos, publicarTexto, retirarTexto } from "@/lib/marketing/consentimientoServer";
import { captacionDeshabilitada, inesperado, leerCuerpo, responder, responderError, responderFallo } from "@/lib/marketing/http";

// Marketing · textos de la aceptación de promociones (solo admin).
//   GET  → todas las versiones (borradores incluidos).
//   POST → { accion: "publicar" | "retirar", version }.
// Publicar un borrador retira el vigente anterior; retirar sin publicar otro
// cierra las altas públicas al instante (las bajas siguen). Los borradores se
// redactan y corrigen por SQL, con la revisión legal: acá no se edita texto.
// Con la captación apagada (MARKETING_CONSENTIMIENTO_ENABLED) publicar responde
// 503 "Deshabilitado": un borrador sin aprobar no puede quedar vigente. Retirar sigue.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const r = await listarTextos();
    if (!r.ok) return responderFallo(r, "textos");
    return responder({ textos: r.valor });
  } catch (error) {
    return inesperado("panel textos GET", error);
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const v = validarAccionTexto(cuerpo.body);
    if (!v.ok) return responderError(v.e);
    if (v.valor.accion === "publicar" && !marketingConsentimientoHabilitado()) return captacionDeshabilitada("no se publican textos");
    const r = v.valor.accion === "publicar" ? await publicarTexto(v.valor.version) : await retirarTexto(v.valor.version);
    if (!r.ok) return responderFallo(r, `texto ${v.valor.accion}`);
    const textos = await listarTextos();
    if (!textos.ok) return responderFallo(textos, "textos");
    return responder({ resultado: r.valor, textos: textos.valor });
  } catch (error) {
    return inesperado("panel textos POST", error);
  }
}
