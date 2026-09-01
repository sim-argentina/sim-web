// IA SIM · Bloque 4B.5 — Cliente del Cost Report oficial de Anthropic (Admin API).
// RAW HTTP (no está en el SDK). Documentación oficial:
//   https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-cost-report
//   https://platform.claude.com/docs/en/manage-claude/usage-cost-api
//
// Autenticación: credencial ADMINISTRATIVA distinta de ANTHROPIC_API_KEY.
//   • Admin API key `sk-ant-admin01-...` en la cabecera `x-api-key`.
//   • Variable server-side dedicada: ANTHROPIC_ADMIN_KEY (nunca en el cliente,
//     nunca en Supabase, nunca en logs).
// La credencial se recibe por parámetro; este módulo NUNCA la loguea ni serializa.

import { centavosANanoUsd } from "@/lib/ia/creditos/dinero";

const COST_URL = "https://api.anthropic.com/v1/organizations/cost_report";
const ANTHROPIC_VERSION = "2023-06-01";

export class CostReportError extends Error {
  constructor(public codigo: "credencial_invalida" | "rate_limit" | "timeout" | "http" | "red", public status?: number) {
    super(codigo);
    this.name = "CostReportError";
  }
}

// Una fila de resultado del Cost Report (subset que usamos; el resto se ignora).
type CostResult = { amount?: string; currency?: string; cost_type?: string | null; description?: string | null; model?: string | null };
type CostBucket = { starting_at?: string; ending_at?: string; results?: CostResult[] };
type CostPage = { data?: CostBucket[]; has_more?: boolean; next_page?: string | null };

export type CostReportResultado = {
  costoTotalNano: bigint;                 // costo oficial acumulado (USD nano, exacto)
  porMesNano: Record<string, bigint>;     // { "2026-08": nano, ... } por mes (Córdoba)
  buckets: number;
  paginas: number;
  moneda: string;                          // "USD" (o "MIXTA" si hubo otra)
  advertencias: string[];
};

// fetch inyectable (los tests pasan un fake sin red).
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ConsultarParams = {
  adminKey: string;
  desdeISO: string;               // RFC3339, inclusivo
  hastaISO: string;               // RFC3339, exclusivo
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxPaginas?: number;            // tope defensivo de páginas
  tz?: string;                    // zona para agrupar por mes (default Córdoba)
};

// Mes (YYYY-MM) local de un timestamp, en la zona indicada.
function mesLocal(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz }).slice(0, 7);
}

// Recorre TODAS las páginas del rango y acumula el costo oficial en nano-USD.
// Idempotente por naturaleza: recalcula el total del rango completo cada vez.
export async function consultarCostReport(p: ConsultarParams): Promise<CostReportResultado> {
  const fetchImpl = p.fetchImpl ?? fetch;
  const timeoutMs = p.timeoutMs ?? 15000;
  const maxPaginas = p.maxPaginas ?? 200;
  const tz = p.tz ?? "America/Argentina/Cordoba";

  let total = 0n;
  const porMes: Record<string, bigint> = {};
  let buckets = 0;
  let paginas = 0;
  let page: string | null = null;
  let monedaOtra = false;
  const advertencias: string[] = [];

  for (;;) {
    if (paginas >= maxPaginas) { advertencias.push(`Se alcanzó el tope de ${maxPaginas} páginas; el total puede estar incompleto.`); break; }
    const qs = new URLSearchParams({ starting_at: p.desdeISO, ending_at: p.hastaISO, bucket_width: "1d", limit: "31" });
    qs.append("group_by[]", "description"); // desglose por modelo/tipo → per-mes + detección de moneda
    if (page) qs.set("page", page);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${COST_URL}?${qs.toString()}`, {
        method: "GET",
        headers: { "x-api-key": p.adminKey, "anthropic-version": ANTHROPIC_VERSION },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new CostReportError((e as Error)?.name === "AbortError" ? "timeout" : "red");
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) throw new CostReportError("credencial_invalida", res.status);
    if (res.status === 429) throw new CostReportError("rate_limit", 429);
    if (!res.ok) throw new CostReportError("http", res.status);

    const json = (await res.json()) as CostPage;
    paginas += 1;
    for (const b of json.data ?? []) {
      buckets += 1;
      const mes = b.starting_at ? mesLocal(b.starting_at, tz) : "desconocido";
      for (const r of b.results ?? []) {
        if (!r || r.amount == null) continue;
        const moneda = (r.currency || "USD").toUpperCase();
        if (moneda !== "USD") { monedaOtra = true; advertencias.push(`Se ignoró un costo en ${moneda} (${r.description ?? "sin descripción"}); el saldo se calcula solo en USD.`); continue; }
        let nano: bigint;
        try { nano = centavosANanoUsd(r.amount); } catch { advertencias.push(`Monto ilegible ("${r.amount}") ignorado.`); continue; }
        total += nano;
        porMes[mes] = (porMes[mes] ?? 0n) + nano;
      }
    }
    if (json.has_more && json.next_page) { page = json.next_page; continue; }
    break;
  }

  // Deduplicar advertencias repetidas (una por moneda basta).
  const advUnicas = [...new Set(advertencias)].slice(0, 20);
  return { costoTotalNano: total, porMesNano: porMes, buckets, paginas, moneda: monedaOtra ? "MIXTA" : "USD", advertencias: advUnicas };
}
