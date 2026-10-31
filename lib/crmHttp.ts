// Piezas HTTP de las rutas del CRM (B1): actor de la sesión, cuerpo de las
// mutaciones (origen, límite, tamaño) y respuesta de un R<T> sin detalles internos.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { requireCrmActor, SIN_CACHE } from "@/lib/crmAuth";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import type { ActorRpc, R } from "@/lib/crmB1Server";

type Fallo = { ok: false; response: NextResponse };

export function json(cuerpo: unknown, status = 200): NextResponse {
  return NextResponse.json(cuerpo, { status, headers: SIN_CACHE });
}

/** Interfaz comercial: solo un usuario comercial (admin y staff, 403; sin sesión, 401). */
export async function actorComercial(): Promise<{ ok: true; actor: { rol: "comercial"; usuarioId: string }; nombre: string } | Fallo> {
  const auth = await requireCrmActor();
  if (!auth.ok) return auth;
  if (auth.actor.tipo !== "comercial") {
    return { ok: false, response: json({ error: "Esta acción es de la interfaz comercial." }, 403) };
  }
  return { ok: true, actor: { rol: "comercial", usuarioId: auth.actor.usuarioId }, nombre: auth.actor.nombre };
}

/** Administración del CRM: solo admin (staff 403; sin sesión o con cookie comercial, 401). */
export async function actorAdmin(): Promise<{ ok: true; actor: ActorRpc } | Fallo> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  return { ok: true, actor: { rol: "admin" } };
}

/** Cuerpo JSON de una mutación: origen propio, límite por IP y tamaño acotado. */
export async function cuerpoMutacion(req: Request, maxBytes = 16_384): Promise<{ ok: true; cuerpo: Record<string, unknown> } | Fallo> {
  if (!isAllowedOrigin(req)) return { ok: false, response: forbiddenOrigin() };
  if (!(await rateLimit(`crm-escritura:${clientIp(req)}`, 120, 60_000))) return { ok: false, response: tooManyResponse() };
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return { ok: false, response: json({ error: "Solicitud demasiado grande." }, 413) };
  const cuerpo = await req.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { ok: false, response: json({ error: "Cuerpo inválido." }, 400) };
  return { ok: true, cuerpo: cuerpo as Record<string, unknown> };
}

/** Respuesta de una RPC: error conocido con su código; inesperado, 500 genérico (el detalle va al log). */
export function responder<T>(r: R<T>, contexto: string, ok: (v: T) => unknown, status = 200): NextResponse {
  if (r.ok) return json(ok(r.valor), status);
  if (r.e) return json({ error: r.e.error, codigo: r.e.codigo, ...(r.e.campo ? { campo: r.e.campo } : {}) }, r.e.status);
  return failResponse(500, "No se pudo completar la operación.", { logContext: `${contexto} ${r.causa ?? ""}` });
}

/** Lectura: si la base falla, 500 genérico (el detalle va al log). */
export async function leer<T>(contexto: string, f: () => Promise<T>): Promise<{ ok: true; valor: T } | Fallo> {
  try {
    return { ok: true, valor: await f() };
  } catch (error) {
    return { ok: false, response: failResponse(500, "No se pudieron cargar los datos.", { logContext: contexto, error }) };
  }
}

export const noEncontrado = (que = "No existe.") => json({ error: que }, 404);
export const entero = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
export const textoOpcional = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
