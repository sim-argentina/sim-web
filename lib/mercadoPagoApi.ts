// ============================================================================
// Acceso a Mercado Pago para el checkout de Reservas y Gift Cards. SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Un único lugar para lo que el checkout y la conciliación de cupones le piden a
// la API (crear / obtener / buscar preferencias, obtener / buscar pagos). Usa el
// SDK oficial, salvo en el entorno local de pruebas con el proveedor simulado
// (lib/mercadoPagoSimulado.ts), que nunca se activa en producción.
// El SDK reintenta solo los errores 5xx y los cortes de red (2 intentos).
// ============================================================================

import MercadoPagoConfig, { Payment, Preference } from "mercadopago";
import { modoSimulado, simulador } from "@/lib/mercadoPagoSimulado";

/** Lo que se usa de una preferencia (documentación: Obtener / Buscar en preferencias). */
export type PreferenciaMp = {
  id: string;
  init_point?: string | null;
  sandbox_init_point?: string | null;
  external_reference?: string | null;
  expires?: boolean;
  expiration_date_to?: string | null;
};

/** Lo que se usa de un pago (documentación: Obtener / Buscar en pagos). */
export type PagoMpApi = { id: string | number; status?: string | null; external_reference?: string | null } & Record<string, unknown>;

function configuracion(): MercadoPagoConfig {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error("Mercado Pago sin MERCADOPAGO_ACCESS_TOKEN");
  return new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } });
}

export const mercadoPago = {
  simulado: modoSimulado,

  async crearPreferencia(body: Record<string, unknown>): Promise<PreferenciaMp> {
    if (modoSimulado()) return simulador.crearPreferencia(body);
    const r = await new Preference(configuracion()).create({ body: body as never });
    return { id: String(r.id), init_point: r.init_point ?? null, sandbox_init_point: r.sandbox_init_point ?? null };
  },

  async obtenerPreferencia(id: string): Promise<PreferenciaMp> {
    if (modoSimulado()) return simulador.obtenerPreferencia(id);
    const r = await new Preference(configuracion()).get({ preferenceId: id });
    return {
      id: String(r.id), init_point: r.init_point ?? null, sandbox_init_point: r.sandbox_init_point ?? null,
      external_reference: r.external_reference ?? null, expires: r.expires, expiration_date_to: r.expiration_date_to ?? null,
    };
  },

  /** Una página de "Buscar en preferencias" (últimos 90 días). */
  async buscarPreferencias(o: { external_reference: string; offset: number }): Promise<{ elements: PreferenciaMp[]; total: number | null; next_offset: number | null }> {
    const r = modoSimulado()
      ? simulador.buscarPreferencias(o)
      : await new Preference(configuracion()).search({ options: { external_reference: o.external_reference, offset: o.offset } });
    const elements = (r.elements ?? []).map((e) => ({
      id: String(e.id), external_reference: e.external_reference ?? null,
      expires: typeof e.expires === "boolean" ? e.expires : undefined, expiration_date_to: e.expiration_date_to ?? null,
    }));
    return { elements, total: typeof r.total === "number" ? r.total : null, next_offset: typeof r.next_offset === "number" ? r.next_offset : null };
  },

  async obtenerPago(id: string): Promise<PagoMpApi> {
    if (modoSimulado()) return simulador.obtenerPago(id) as unknown as PagoMpApi;
    return (await new Payment(configuracion()).get({ id })) as unknown as PagoMpApi;
  },

  /** Una página de "Buscar en pagos" (últimos 12 meses; máximo 50 por página). */
  async buscarPagos(o: { external_reference: string; offset: number; limit: number }): Promise<{ results: PagoMpApi[]; total: number | null }> {
    const r = modoSimulado()
      ? simulador.buscarPagos(o)
      : await new Payment(configuracion()).search({
          options: {
            external_reference: o.external_reference, offset: o.offset, limit: o.limit,
            sort: "date_created", criteria: "desc", range: "date_created", begin_date: "NOW-364DAYS", end_date: "NOW",
          },
        });
    const results = ((r as { results?: PagoMpApi[] }).results ?? []) as PagoMpApi[];
    const total = (r as { paging?: { total?: unknown } }).paging?.total;
    return { results, total: typeof total === "number" ? total : null };
  },
};
