import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { COOKIE_SESION, leerSesion, opcionesCookieBorrada, tokenDeRequest } from "@/lib/mensualidadSesion";
import { getMiPlan } from "@/lib/mensualidadesMiPlan";

// Datos de la mensualidad de la sesión (Bloque M4).
//
// NO depende de la feature flag: la flag gobierna los accesos NUEVOS
// (identificarse y comprar). Quien ya tiene una sesión válida tiene que poder
// seguir consultando aunque la venta se apague.
// Sin sesión válida devuelve 404 neutral: no revela que la función existe.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

// Misma respuesta para "no hay cookie", "token inválido" y "sesión vencida".
function sinSesion() {
  const res = NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  // Si venía una cookie inservible, se borra.
  res.cookies.set(COOKIE_SESION, "", opcionesCookieBorrada());
  return res;
}

export async function GET(req: Request) {
  if (!(await rateLimit(`mens-miplan:${clientIp(req)}`, 60, 60_000))) return tooManyResponse();

  try {
    const sesion = await leerSesion(tokenDeRequest(req));
    if (!sesion) return sinSesion();

    const plan = await getMiPlan(sesion.mensualidadId);
    // La mensualidad podría haber desaparecido (borrado administrativo).
    if (!plan) return sinSesion();

    return NextResponse.json(plan, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No pudimos consultar tu mensualidad.", {
      logContext: "mens-miplan", error,
    });
  }
}
