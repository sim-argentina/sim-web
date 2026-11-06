// Marketing — piezas HTTP comunes de /api/promos/* y /api/admin/marketing/*.
// Respuestas sin caché, errores con { error, codigo, campo? } y nunca un mensaje
// SQL ni un detalle interno hacia el navegador.

import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { LIMITES, errorApi, type ErrorApi } from "@/lib/marketing/consentimiento";
import type { R } from "@/lib/marketing/consentimientoServer";

export const SIN_CACHE = { "Cache-Control": "no-store, max-age=0" };

export function responder(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

export function responderError(e: ErrorApi, extra: Record<string, unknown> = {}): NextResponse {
  const { status, ...cuerpo } = e;
  return responder({ ...cuerpo, ...extra }, status);
}

export const noEncontrado = () => responder({ error: "No encontrado." }, 404);

/** Llave maestra de campañas apagada (lib/featureFlags.ts → marketingCampaniasHabilitadas). */
export const campaniasDeshabilitadas = () =>
  responder({ error: "Deshabilitado. Las campañas de Marketing están apagadas en este entorno.", codigo: "marketing_deshabilitado", estado: "Deshabilitado" }, 503);

/** Captación apagada (MARKETING_CONSENTIMIENTO_ENABLED): sin altas ni textos nuevos. Las bajas siguen. */
export const captacionDeshabilitada = (que: string) =>
  responder({ error: `Deshabilitado. La captación de promociones está apagada: ${que}. Las bajas siguen funcionando.`, codigo: "captacion_apagada", estado: "Deshabilitado" }, 503);

/** Error conocido → su respuesta; inesperado → 500 genérico con requestId (detalle solo en el log). */
export function responderFallo(r: Extract<R<unknown>, { ok: false }>, contexto: string): NextResponse {
  if (r.e) return responderError(r.e);
  return failResponse(500, "No se pudo completar la operación.", { logContext: `marketing ${contexto}`, error: r.causa ?? "sin detalle" });
}

export function inesperado(contexto: string, causa: unknown): NextResponse {
  return failResponse(500, "No se pudo completar la operación.", { logContext: `marketing ${contexto}`, error: causa });
}

/** Cuerpo JSON acotado. Vacío, enorme o inválido → 400. */
export async function leerCuerpo(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; respuesta: NextResponse }> {
  const crudo = await req.text();
  if (crudo.length > LIMITES.cuerpoBytes) return { ok: false, respuesta: responderError(errorApi("datos_invalidos")) };
  try {
    return { ok: true, body: JSON.parse(crudo) };
  } catch {
    return { ok: false, respuesta: responderError(errorApi("datos_invalidos")) };
  }
}
