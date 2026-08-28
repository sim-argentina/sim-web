// Cliente GA4 Data API — SOLO servidor (se importa únicamente desde route handlers
// bajo /api/admin, nunca desde el cliente). Las credenciales vienen EXCLUSIVAMENTE de
// variables de entorno server-side (no NEXT_PUBLIC_*). Si faltan, el módulo reporta
// "no configurado" sin romper.
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import {
  normalizeRows, buildResumen, buildSerie, buildList, indexarConteos,
  funnelReservas, funnelGiftCards, totalPurchases, buildPromociones, buildErrores,
  esErrorDeCampoGa4, clasificarEstado,
  type Item, type FunnelStage, type BlockStatus,
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
export type BlocksEstado = {
  resumen: BlockStatus; evolucion: BlockStatus; canales: BlockStatus; paginas: BlockStatus;
  fuentes: BlockStatus; dispositivos: BlockStatus; ciudades: BlockStatus;
  funnels: BlockStatus; promociones: BlockStatus; errores: BlockStatus;
};
export type WebData = {
  configured: true;
  range: DateRange;
  previous: DateRange;
  resumen: ReturnType<typeof buildResumen>;
  conversionDisponible: boolean; // false si el funnel (purchases) no se pudo consultar
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
  estados: BlocksEstado; // estado real por bloque (ok/empty/pending/error)
};
export type WebNotConfigured = { configured: false };

type Req = Record<string, unknown>;
type NormRows = ReturnType<typeof normalizeRows>;
const dim = (name: string) => ({ name });
const met = (name: string) => ({ name });
const dr = (r: DateRange) => ({ startDate: r.start, endDate: r.end });
const inList = (fieldName: string, values: string[]) => ({ filter: { fieldName, inListFilter: { values } } });

// Mensaje/código de error de GA4 SANITIZADO (nunca secretos ni PII: son textos de la
// API sobre dimensiones/métricas). Se trunca para no ensuciar logs.
function ga4Error(e: unknown): { code: string; message: string } {
  const err = e as { code?: unknown; message?: unknown } | null;
  const code = err?.code != null ? String(err.code) : "?";
  const message = String(err?.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  return { code, message };
}

// Ejecuta un batch (≤5 reports del MISMO nivel de riesgo) AISLADO: una falla de este
// batch NO afecta a los demás. Devuelve reports normalizados o un `fallo` clasificado.
async function runBatch(nombre: string, requests: Req[]): Promise<{ reports: NormRows[] | null; fallo: { esFieldError: boolean } | null }> {
  try {
    const [resp] = await client().batchRunReports({ property: property(), requests: requests as never });
    const reports = (resp.reports ?? []).map((rep) => normalizeRows(rep as never));
    return { reports, fallo: null };
  } catch (e) {
    const { code, message } = ga4Error(e);
    const esFieldError = esErrorDeCampoGa4(message);
    // Logging server-side sanitizado para diagnóstico (sin claves, sin PII).
    console.error(`[metricas-web] bloque "${nombre}" falló (GA4 ${code}${esFieldError ? ", campo no disponible" : ""}): ${message}`);
    return { reports: null, fallo: { esFieldError } };
  }
}

// ── Reporte histórico: batches AISLADOS por compatibilidad/criticidad ────────
// Los reportes ESTÁNDAR (resumen/evolución/canales/páginas/fuentes/dispositivos/
// ciudades) van en batches propios y NUNCA se co-baten con dimensiones custom, para
// que una custom dimension aún no propagada no los tumbe.
export async function runWeb(current: DateRange, previous: DateRange): Promise<WebData> {
  // BATCH ESTÁNDAR 1: resumen actual/previo, serie, canales, páginas.
  const core = await runBatch("core", [
    { dateRanges: [dr(current)], metrics: ["totalUsers", "newUsers", "sessions", "screenPageViews", "userEngagementDuration"].map(met) },
    { dateRanges: [dr(previous)], metrics: ["totalUsers", "newUsers", "sessions", "screenPageViews", "userEngagementDuration"].map(met) },
    { dateRanges: [dr(current)], dimensions: [dim("date")], metrics: ["totalUsers", "sessions", "screenPageViews"].map(met), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 },
    { dateRanges: [dr(current)], dimensions: [dim("sessionDefaultChannelGroup")], metrics: ["sessions", "totalUsers"].map(met), orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 12 },
    { dateRanges: [dr(current)], dimensions: [dim("pagePath")], metrics: ["screenPageViews", "totalUsers"].map(met), orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 40 },
  ]);
  const c = core.reports;

  // BATCH ESTÁNDAR 2 (audiencia): fuente/medio, dispositivos, ciudades. SIN custom.
  const aud = await runBatch("audiencia", [
    { dateRanges: [dr(current)], dimensions: [dim("sessionSourceMedium")], metrics: [met("sessions")], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 12 },
    { dateRanges: [dr(current)], dimensions: [dim("deviceCategory")], metrics: [met("sessions")] },
    { dateRanges: [dr(current)], dimensions: [dim("city")], metrics: [met("totalUsers")], orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }], limit: 10 },
  ]);
  const a = aud.reports;

  // BATCH CUSTOM (funnels): item_category (eventos ecommerce) + customEvent:funnel +
  // purchases del período anterior. Si las custom dims aún no propagaron, degrada SOLO
  // este bloque como "pending".
  const fun = await runBatch("funnels", [
    { dateRanges: [dr(current)], dimensions: [dim("eventName"), dim("itemCategory")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["view_item", "select_item", "begin_checkout", "purchase"]), limit: 100 },
    { dateRanges: [dr(current)], dimensions: [dim("eventName"), dim("customEvent:funnel")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["select_date", "select_time", "payment_redirect"]), limit: 100 },
    { dateRanges: [dr(previous)], dimensions: [dim("itemCategory")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["purchase"]), limit: 20 },
  ]);
  const f = fun.reports;

  // BATCH CUSTOM (errores): checkout_error + payment_result.
  const err = await runBatch("errores", [
    { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:error_stage")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["checkout_error"]), limit: 50 },
    { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:status")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["payment_result"]), limit: 50 },
  ]);
  const er = err.reports;

  // PROMOCIONES aislado: custom metric discount_value que puede no existir aún; se
  // reintenta sin ella. Falla solo este bloque.
  let promociones: WebData["promociones"] = null;
  let promoFallo: { esFieldError: boolean } | null = null;
  {
    const conMetric = await runBatch("promociones", [
      { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:promotion_type")], metrics: [met("eventCount"), met("discount_value")], dimensionFilter: inList("eventName", ["apply_promotion"]), limit: 50 },
    ]);
    if (conMetric.reports) {
      promociones = buildPromociones(conMetric.reports[0] ?? [], true);
    } else {
      const sinMetric = await runBatch("promociones", [
        { dateRanges: [dr(current)], dimensions: [dim("customEvent:funnel"), dim("customEvent:promotion_type")], metrics: [met("eventCount")], dimensionFilter: inList("eventName", ["apply_promotion"]), limit: 50 },
      ]);
      if (sinMetric.reports) promociones = buildPromociones(sinMetric.reports[0] ?? [], false);
      else promoFallo = sinMetric.fallo;
    }
  }

  // Ensamblado.
  const funnelItem = f?.[0] ?? [];
  const funnelEvent = f?.[1] ?? [];
  const conteos = indexarConteos(funnelItem, funnelEvent);
  const purchasesActual = totalPurchases(funnelItem);
  const purchasesPrevio = (f?.[2] ?? []).reduce((s, r) => s + (r.mets[0] ?? 0), 0);

  const estados: BlocksEstado = {
    resumen: clasificarEstado(core.fallo, c ? 1 : 0, false),
    evolucion: clasificarEstado(core.fallo, c?.[2]?.length ?? 0, false),
    canales: clasificarEstado(core.fallo, c?.[3]?.length ?? 0, false),
    paginas: clasificarEstado(core.fallo, c?.[4]?.length ?? 0, false),
    fuentes: clasificarEstado(aud.fallo, a?.[0]?.length ?? 0, false),
    dispositivos: clasificarEstado(aud.fallo, a?.[1]?.length ?? 0, false),
    ciudades: clasificarEstado(aud.fallo, a?.[2]?.length ?? 0, false),
    funnels: clasificarEstado(fun.fallo, funnelItem.length + funnelEvent.length, true),
    promociones: clasificarEstado(promoFallo, promociones?.total ?? 0, true),
    errores: clasificarEstado(err.fallo, (er?.[0]?.length ?? 0) + (er?.[1]?.length ?? 0), true),
  };

  return {
    configured: true,
    range: current,
    previous,
    resumen: buildResumen(c?.[0] ?? [], c?.[1] ?? [], purchasesActual, purchasesPrevio),
    // La conversión Analytics depende de purchases (funnel): si el funnel no se pudo
    // consultar, la conversión NO es 0 sino "no disponible".
    conversionDisponible: !fun.fallo,
    serie: buildSerie(c?.[2] ?? []),
    canales: buildList(c?.[3] ?? [], 0, 1),
    paginas: buildList(c?.[4] ?? [], 0, 1, { excludePrefix: "/admin", limit: 15 }),
    fuentes: buildList(a?.[0] ?? [], 0, undefined, { limit: 12 }),
    dispositivos: buildList(a?.[1] ?? [], 0),
    ciudades: buildList(a?.[2] ?? [], 0, undefined, { limit: 10 }),
    funnelReservas: funnelReservas(conteos),
    funnelGiftCards: funnelGiftCards(conteos),
    promociones,
    errores: er ? buildErrores(er[0] ?? [], er[1] ?? []) : null,
    estados,
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
