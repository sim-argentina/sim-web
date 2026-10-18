// Interacciones del stand — piezas HTTP comunes de las rutas /api/admin/interacciones.
// Respuestas sin caché, errores con { error, codigo, campo?, turno_stand_id?, turnos? }
// y nunca un mensaje SQL ni un detalle interno hacia el navegador.

import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { MAX_CUERPO_BYTES, errorApi, esUuid, type ErrorApi } from "@/lib/interacciones";
import type { R } from "@/lib/interaccionesServer";

export const SIN_CACHE = { "Cache-Control": "no-store, max-age=0" };

export function responder(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

export function responderError(e: ErrorApi): NextResponse {
  const { status, ...cuerpo } = e;
  return responder(cuerpo, status);
}

/** Error conocido → su respuesta; inesperado → 500 genérico con requestId (detalle solo en el log). */
export function responderFallo(r: Extract<R<unknown>, { ok: false }>, contexto: string): NextResponse {
  if (r.e) return responderError(r.e);
  return failResponse(500, "No se pudo completar la operación.", { logContext: `interacciones ${contexto}`, error: r.causa ?? "sin detalle" });
}

export function inesperado(contexto: string, causa: unknown): NextResponse {
  return failResponse(500, "No se pudo completar la operación.", { logContext: `interacciones ${contexto}`, error: causa });
}

/** Cuerpo JSON acotado. Vacío o inválido → 400. */
export async function leerCuerpo(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; respuesta: NextResponse }> {
  const crudo = await req.text();
  if (crudo.length > MAX_CUERPO_BYTES) return { ok: false, respuesta: responderError(errorApi("datos_invalidos")) };
  try {
    return { ok: true, body: JSON.parse(crudo) };
  } catch {
    return { ok: false, respuesta: responderError(errorApi("datos_invalidos")) };
  }
}

/** ID de interacción de la URL: un uuid que no lo es no existe (404). */
export function idDeRuta(id: string): string | null {
  return esUuid(id) ? id.toLowerCase() : null;
}

export const noExiste = () => responderError(errorApi("interaccion_inexistente"));
