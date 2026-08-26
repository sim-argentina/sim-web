// Cliente GA4 Data API — SOLO servidor (se importa únicamente desde route handlers
// bajo /api/admin, nunca desde el cliente). Las credenciales vienen EXCLUSIVAMENTE de
// variables de entorno server-side (no NEXT_PUBLIC_*). Si faltan, el módulo reporta
// "no configurado" sin romper.
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import {
  normalizeRows, buildResumen, buildSerie, buildList, indexarConteos,
  funnelReservas, funnelGiftCards, totalPurchases, buildPromociones, buildErrores,
  type Item, type FunnelStage,
} from "@/lib/ga4Transform";
import { credencialesFromEnv, ga4Configured } from "@/lib/ga4Config";
import type { DateRange } from "@/lib/metricasWebRange";

// ── Configuración desde entorno (lógica pura en lib/ga4Config) ────────────────
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const credenciales = () => credencialesFromEnv(process.env);

export function isGa4Configured(): boolean {
  return ga4Configured(process.env);
}

let _client: BetaAnalyticsDataClient | null = null;
function client(): BetaAnalyticsDataClient {
  if (_client) return _client;
  _client = new BetaAnalyticsDataClient({ credentials: credenciales()! });
  return _client;
}
const property = () => `properties/${PROPERTY_ID}`;

// ── Tipos de salida ──────────────────────────────────────────────────────────
export type WebData = {
  configured: true;
  range: DateRange;
  previous: DateRange;
  resumen: ReturnType<typeof buildResumen>;
  serie: ReturnType<typeof buildSerie>;
  canales: Item[];
  fuentes: Item[];
  paginas: Item[];
  dispositivos: Item[];
  ciudades: Item[];
  funnelReservas: FunnelStage[];
  funnelGiftCards: FunnelStage[];
  promociones: ReturnType<typeof buildPromociones> | null;
  errores: ReturnType<typeof buildErrores> | null;
  partial: string[]; // bloques que fallaron (degradación parcial)
};
export type WebNotConfigured = { configured: false };

type Req = Record<string, unknown>;
const dim = (name: string) => ({ name });
const met = (name: string) => ({ name });
const dr = (r: DateRange) => ({ startDate: r.start, endDate: r.end });
const inList = (fieldName: string, values: string[]) => ({ filter: { fieldName, inListFilter: { values } } });

// Ejecuta un batch (≤5 reports) y devuelve reports normalizados (o [] por report si falla).
async function batch(requests: Req[]) {
  const [resp] = await client().batchRunReports({ property: property(), requests: requests as never });
  return (resp.reports ?? []).map((rep) => normalizeRows(rep as never));
}

// ── Reporte histórico completo (agrupado, con degradación por bloque) ────────
export async function runWeb(current: DateRange, previous: DateRange): Promise<WebData> {
  const partial: string[] = [];

  // Batch 1: resumen actual/previo, serie, canales, páginas.
  let b1: ReturnType<typeof normalizeRows>[] = [];
  try {
    b1 = await batch([
      { dateRanges: [dr(current)], metrics: ["totalUsers", "newUsers", "sessions", "screenPageViews", "userEngagementDuration"].map(met) },
      { dateRanges: [dr(previous)], metrics: ["totalUsers", "newUsers", "sessions", "screenPageViews", "userEngagementDuration"].map(met) },
      { dateRanges: [dr(current)], dimensions: [dim("date")], metrics: ["totalUsers", "sessions", "screenPageViews"].map(met), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 },
      { dateRanges: [dr(current)], dimensions: [dim("sessionDefaultChannelGroup")], metrics: ["sessions", "totalUsers"].map(met), orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 12 },
      { dateRanges: [dr(current)], dimensions: [dim("pagePath")], metrics: ["screenPageViews", "totalUsers"].map(met), orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 40 },
    ]);
  } catch { partial.push("resumen", "evolucion", "adquisicion", "contenido"); }

  // Batch 2: fuentes, dispositivos, ciudades, funnel (item), funnel (evento).
  let b2: ReturnType<typeof normalizeRows>[] = [];
  try {
    b2 = await batch([
      { dateRanges: [dr(current)], dimensions: [dim("sessionSourceMedium")], metrics: [met("sessions")], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 12 },
      { dateRanges: [dr(current)], dimensions: [dim("deviceCategory")], metrics: [met("sessions")] },
      { dateRanges: [dr(current)], dimensions: [dim("city")], metrics: [met("totalUsers")], orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }], limit: 10 },
      { dateRanges: [dr(current)], dimensions: [dim("eventName"), dim("itemCategory")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["view_item", "select_item", "begin_checkout", "purchase"]), limit: 100 },
      { dateRanges: [dr(current)], dimensions: [dim("eventName"), dim("customEvent:funnel")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["select_date", "select_time", "payment_redirect"]), limit: 100 },
    ]);
  } catch { partial.push("audiencia", "funnels"); }

  // Batch 3: errores (checkout / pago) + purchases del período anterior (para conversión).
  let b3: ReturnType<typeof normalizeRows>[] = [];
  try {
    b3 = await batch([
      { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:error_stage")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["checkout_error"]), limit: 50 },
      { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:status")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["payment_result"]), limit: 50 },
      { dateRanges: [dr(previous)], dimensions: [dim("itemCategory")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["purchase"]), limit: 20 },
    ]);
  } catch { partial.push("errores"); }

  // Promociones aislado: usa una custom metric (discount_value) que podría no existir
  // todavía. Se intenta con descuento y, si falla, se reintenta sin él (degrada solo esto).
  let promociones: WebData["promociones"] = null;
  try {
    const [rows] = await batch([
      { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:promotion_type")], metrics: [met("eventCount"), met("discount_value")], dimensionFilter: inList("eventName", ["apply_promotion"]), limit: 50 },
    ]);
    promociones = buildPromociones(rows ?? [], true);
  } catch {
    try {
      const [rows] = await batch([
        { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:promotion_type")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["apply_promotion"]), limit: 50 },
      ]);
      promociones = buildPromociones(rows ?? [], false);
    } catch { partial.push("promociones"); }
  }

  // Ensamblado (con defaults vacíos por bloque caído).
  const funnelItem = b2[3] ?? [];
  const funnelEvent = b2[4] ?? [];
  const conteos = indexarConteos(funnelItem, funnelEvent);
  const purchasesActual = totalPurchases(funnelItem);
  const purchasesPrevio = (b3[2] ?? []).reduce((s, r) => s + (r.mets[0] ?? 0), 0);

  return {
    configured: true,
    range: current,
    previous,
    resumen: buildResumen(b1[0] ?? [], b1[1] ?? [], purchasesActual, purchasesPrevio),
    serie: buildSerie(b1[2] ?? []),
    canales: buildList(b1[3] ?? [], 0, 1),
    paginas: buildList(b1[4] ?? [], 0, 1, { excludePrefix: "/admin", limit: 15 }),
    fuentes: buildList(b2[0] ?? [], 0, undefined, { limit: 12 }),
    dispositivos: buildList(b2[1] ?? [], 0),
    ciudades: buildList(b2[2] ?? [], 0, undefined, { limit: 10 }),
    funnelReservas: funnelReservas(conteos),
    funnelGiftCards: funnelGiftCards(conteos),
    promociones,
    errores: (b3[0] || b3[1]) ? buildErrores(b3[0] ?? [], b3[1] ?? []) : null,
    partial,
  };
}

// ── Realtime (TTL corto) ─────────────────────────────────────────────────────
export type RealtimeData = { configured: true; usuariosActivos: number; paginas: Item[] };
export async function runRealtime(): Promise<RealtimeData> {
  const [resp] = await client().runRealtimeReport({
    property: property(),
    metrics: [met("activeUsers")],
    dimensions: [dim("unifiedScreenName")],
    limit: 10,
  });
  const rows = normalizeRows(resp as never);
  const usuariosActivos = rows.reduce((s, r) => s + (r.mets[0] ?? 0), 0);
  const paginas = buildList(rows, 0, undefined, { limit: 8 });
  return { configured: true, usuariosActivos, paginas };
}
