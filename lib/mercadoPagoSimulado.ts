// ============================================================================
// Mercado Pago SIMULADO para probar el checkout en el navegador local.
// ----------------------------------------------------------------------------
// Solo existe con las TRES condiciones (modoSimulado): MERCADOPAGO_SIMULADO=1,
// NODE_ENV distinto de production y sin Vercel, y la base apuntando a un
// loopback (el stack local de pruebas). En cualquier otro caso, todo lo de acá
// responde como si no existiera y /pruebas/mercadopago da 404.
//
// Imita lo que el checkout usa de la API real (y lo que dice su documentación):
// preferencias con external_reference, expires/expiration_date_to (vencida no se
// paga), búsqueda de preferencias y de pagos paginada, y pagos con estado. Los
// pagos los "hace" la página /pruebas/mercadopago, que después avisa al webhook
// real de la app igual que Mercado Pago. No hay dinero ni red: todo en memoria
// del proceso (globalThis, sobrevive a la recarga de módulos de next dev).
// ============================================================================

import { randomInt } from "node:crypto";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function modoSimulado(): boolean {
  if (process.env.MERCADOPAGO_SIMULADO !== "1") return false;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV) return false;
  try {
    return LOOPBACK.has(new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL)).hostname);
  } catch {
    return false;
  }
}

export type ModoCrear = "ok" | "falla" | "sin_respuesta" | "falla_busqueda";

export type PreferenciaSimulada = {
  id: string;
  init_point: string;
  sandbox_init_point: null;
  external_reference: string;
  expires: boolean;
  expiration_date_from: string | null;
  expiration_date_to: string | null;
  items: { title?: string; quantity?: number; unit_price?: number }[];
  back_urls: Record<string, string>;
  notification_url: string | null;
  date_created: string;
};

export type PagoSimulado = {
  id: string;
  status: string;
  status_detail: string;
  external_reference: string;
  preference_id: string;
  transaction_amount: number;
  currency_id: "ARS";
  date_created: string;
  date_approved: string | null;
};

type Estado = { preferencias: Map<string, PreferenciaSimulada>; pagos: Map<string, PagoSimulado>; modo: ModoCrear };

function estado(): Estado {
  const g = globalThis as { __simMercadoPago?: Estado };
  g.__simMercadoPago ??= { preferencias: new Map(), pagos: new Map(), modo: "ok" };
  return g.__simMercadoPago;
}

function exigir() {
  if (!modoSimulado()) throw new Error("Mercado Pago simulado no disponible fuera del entorno local de pruebas");
}

const errorMp = (status: number, message: string) => Object.assign(new Error(message), { status, message });

export const simulador = {
  modo(m?: ModoCrear): ModoCrear {
    exigir();
    if (m) estado().modo = m;
    return estado().modo;
  },

  crearPreferencia(body: Record<string, unknown>): PreferenciaSimulada {
    exigir();
    const e = estado();
    if (e.modo === "falla") throw errorMp(503, "simulado: Mercado Pago no disponible");
    const id = `SIM-${Date.now().toString(36)}-${randomInt(1000, 9999)}`;
    const p: PreferenciaSimulada = {
      id,
      init_point: `/pruebas/mercadopago?pref=${encodeURIComponent(id)}`,
      sandbox_init_point: null,
      external_reference: String(body.external_reference ?? ""),
      expires: body.expires === true,
      expiration_date_from: typeof body.expiration_date_from === "string" ? body.expiration_date_from : null,
      expiration_date_to: typeof body.expiration_date_to === "string" ? body.expiration_date_to : null,
      items: Array.isArray(body.items) ? (body.items as PreferenciaSimulada["items"]) : [],
      back_urls: (body.back_urls as Record<string, string>) ?? {},
      notification_url: typeof body.notification_url === "string" ? body.notification_url : null,
      date_created: new Date().toISOString(),
    };
    e.preferencias.set(id, p);
    if (e.modo === "sin_respuesta") throw errorMp(504, "simulado: la preferencia se creó pero la respuesta no llegó");
    return p;
  },

  obtenerPreferencia(id: string): PreferenciaSimulada {
    exigir();
    const p = estado().preferencias.get(id);
    if (!p) throw errorMp(404, "simulado: preferencia inexistente");
    return p;
  },

  buscarPreferencias(o: { external_reference?: string; offset?: number; limit?: number }) {
    exigir();
    if (estado().modo === "falla_busqueda") throw errorMp(503, "simulado: búsqueda no disponible");
    const todas = [...estado().preferencias.values()].filter((p) => !o.external_reference || p.external_reference === o.external_reference);
    const offset = Number(o.offset ?? 0);
    const limit = Math.min(Number(o.limit ?? 30), 50);
    const elements = todas.slice(offset, offset + limit).map(({ id, external_reference, expires, expiration_date_from, expiration_date_to, date_created }) =>
      ({ id, external_reference, expires, expiration_date_from, expiration_date_to, date_created }));
    return { elements, total: todas.length, next_offset: offset + elements.length };
  },

  obtenerPago(id: string): PagoSimulado {
    exigir();
    const p = estado().pagos.get(id);
    if (!p) throw errorMp(404, "simulado: pago inexistente");
    return p;
  },

  buscarPagos(o: { external_reference?: string; offset?: number; limit?: number }) {
    exigir();
    if (estado().modo === "falla_busqueda") throw errorMp(503, "simulado: búsqueda no disponible");
    const todos = [...estado().pagos.values()].filter((p) => !o.external_reference || p.external_reference === o.external_reference);
    const offset = Number(o.offset ?? 0);
    const limit = Math.min(Number(o.limit ?? 30), 50);
    return { results: todos.slice(offset, offset + limit), paging: { total: todos.length, limit, offset } };
  },

  /** La persona "paga" en la página simulada. Una preferencia vencida no se paga (como la real). */
  pagar(prefId: string, status: "approved" | "rejected" | "in_process"): PagoSimulado {
    exigir();
    const p = this.obtenerPreferencia(prefId);
    if (p.expires && p.expiration_date_to && Date.parse(p.expiration_date_to) < Date.now()) throw errorMp(400, "simulado: la preferencia venció");
    const monto = p.items.reduce((acc, i) => acc + Number(i.unit_price ?? 0) * Number(i.quantity ?? 1), 0);
    const id = String(90_000_000_000 + estado().pagos.size * 7 + randomInt(1, 6));
    const ahora = new Date().toISOString();
    const pago: PagoSimulado = {
      id, status, status_detail: status === "approved" ? "accredited" : status === "rejected" ? "cc_rejected_other_reason" : "pending_contingency",
      external_reference: p.external_reference, preference_id: p.id, transaction_amount: monto, currency_id: "ARS",
      date_created: ahora, date_approved: status === "approved" ? ahora : null,
    };
    estado().pagos.set(id, pago);
    return pago;
  },

  /** Para probar la liberación: la preferencia queda vencida (como si hubiera pasado el tiempo). */
  vencer(prefId: string) {
    exigir();
    const p = this.obtenerPreferencia(prefId);
    p.expiration_date_to = new Date(Date.now() - 60 * 60_000).toISOString();
  },

  /** Cambia el estado de un pago existente (p. ej. en proceso → aprobado). */
  cambiarPago(id: string, status: "approved" | "rejected") {
    exigir();
    const p = this.obtenerPago(id);
    p.status = status;
    p.date_approved = status === "approved" ? new Date().toISOString() : null;
    return p;
  },

  estado() {
    exigir();
    const e = estado();
    return { modo: e.modo, preferencias: [...e.preferencias.values()], pagos: [...e.pagos.values()] };
  },
};
