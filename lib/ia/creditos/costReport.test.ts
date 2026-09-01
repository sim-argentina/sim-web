import { strict as assert } from "node:assert";
import { consultarCostReport, CostReportError, type FetchLike } from "@/lib/ia/creditos/costReport";
import { nanoUsdAString } from "@/lib/ia/creditos/dinero";

// Ejecutar: npx tsx lib/ia/creditos/costReport.test.ts
// Proveedor HTTP FALSO: no toca red ni base de datos.

const P = { adminKey: "sk-ant-admin01-FAKE", desdeISO: "2025-01-01T00:00:00Z", hastaISO: "2026-09-01T00:00:00Z", tz: "America/Argentina/Cordoba" };

function resp(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
function bucket(starting: string, results: Array<{ amount: string; currency?: string; description?: string }>) {
  return { starting_at: starting, ending_at: starting, results };
}

async function main() {
  // ── Un día, un resultado ───────────────────────────────────────────────────
  {
    const fetchImpl: FetchLike = async () => resp({ data: [bucket("2026-08-01T00:00:00Z", [{ amount: "100", currency: "USD", description: "Haiku Input" }])], has_more: false, next_page: null });
    const r = await consultarCostReport({ ...P, fetchImpl });
    assert.equal(nanoUsdAString(r.costoTotalNano, 2), "1.00", "100 cents = US$1");
    assert.equal(r.buckets, 1); assert.equal(r.paginas, 1); assert.equal(r.moneda, "USD");
  }

  // ── Varios días / varios modelos / varios tipos de token ────────────────────
  {
    const fetchImpl: FetchLike = async () => resp({ data: [
      bucket("2026-08-01T00:00:00Z", [{ amount: "50", currency: "USD", description: "Haiku uncached_input" }, { amount: "25", currency: "USD", description: "Haiku output" }]),
      bucket("2026-08-02T00:00:00Z", [{ amount: "10.5", currency: "USD", description: "Sonnet cache_read" }]),
    ], has_more: false, next_page: null });
    const r = await consultarCostReport({ ...P, fetchImpl });
    // (50+25+10.5) cents = 85.5 cents = US$0.855
    assert.equal(nanoUsdAString(r.costoTotalNano, 3), "0.855", "suma de varios buckets/tipos");
    assert.equal(r.buckets, 2);
  }

  // ── Paginación (has_more/next_page) + varios meses ──────────────────────────
  {
    let llamadas = 0;
    const fetchImpl: FetchLike = async (url) => {
      llamadas += 1;
      if (!url.includes("page=")) return resp({ data: [bucket("2026-07-15T00:00:00Z", [{ amount: "200", currency: "USD" }])], has_more: true, next_page: "page_2" });
      return resp({ data: [bucket("2026-08-15T00:00:00Z", [{ amount: "300", currency: "USD" }])], has_more: false, next_page: null });
    };
    const r = await consultarCostReport({ ...P, fetchImpl });
    assert.equal(llamadas, 2, "siguió la segunda página");
    assert.equal(r.paginas, 2);
    assert.equal(nanoUsdAString(r.costoTotalNano, 2), "5.00", "(200+300) cents = US$5");
    assert.equal(nanoUsdAString(r.porMesNano["2026-07"], 2), "2.00", "julio US$2");
    assert.equal(nanoUsdAString(r.porMesNano["2026-08"], 2), "3.00", "agosto US$3");
  }

  // ── Moneda inesperada → se ignora + advertencia (saldo solo en USD) ─────────
  {
    const fetchImpl: FetchLike = async () => resp({ data: [bucket("2026-08-01T00:00:00Z", [
      { amount: "100", currency: "USD" }, { amount: "999", currency: "EUR", description: "algo en euros" },
    ])], has_more: false, next_page: null });
    const r = await consultarCostReport({ ...P, fetchImpl });
    assert.equal(nanoUsdAString(r.costoTotalNano, 2), "1.00", "solo cuenta el USD");
    assert.equal(r.moneda, "MIXTA", "marca moneda mixta");
    assert.ok(r.advertencias.some((a) => a.includes("EUR")), "advierte por EUR");
  }

  // ── Respuesta vacía ─────────────────────────────────────────────────────────
  {
    const fetchImpl: FetchLike = async () => resp({ data: [], has_more: false, next_page: null });
    const r = await consultarCostReport({ ...P, fetchImpl });
    assert.equal(r.costoTotalNano, 0n); assert.equal(r.buckets, 0);
  }

  // ── Idempotencia: dos consultas del mismo rango dan el mismo total ──────────
  {
    const fetchImpl: FetchLike = async () => resp({ data: [bucket("2026-08-01T00:00:00Z", [{ amount: "123.45", currency: "USD" }])], has_more: false, next_page: null });
    const a = await consultarCostReport({ ...P, fetchImpl });
    const b = await consultarCostReport({ ...P, fetchImpl });
    assert.equal(a.costoTotalNano, b.costoTotalNano, "recalcula el rango completo, sin acumular entre llamadas");
  }

  // ── Credencial inválida (401/403) ───────────────────────────────────────────
  {
    const fetchImpl: FetchLike = async () => resp({ error: "unauthorized" }, 401);
    await assert.rejects(() => consultarCostReport({ ...P, fetchImpl }), (e) => e instanceof CostReportError && e.codigo === "credencial_invalida", "401 → credencial_invalida");
  }

  // ── Rate limit (429) ────────────────────────────────────────────────────────
  {
    const fetchImpl: FetchLike = async () => resp({ error: "rate_limited" }, 429);
    await assert.rejects(() => consultarCostReport({ ...P, fetchImpl }), (e) => e instanceof CostReportError && e.codigo === "rate_limit", "429 → rate_limit");
  }

  // ── Timeout (abort) ─────────────────────────────────────────────────────────
  {
    const fetchImpl: FetchLike = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    await assert.rejects(() => consultarCostReport({ ...P, fetchImpl }), (e) => e instanceof CostReportError && e.codigo === "timeout", "abort → timeout");
  }

  console.log("OK — costReport: un día, varios días/modelos/tokens, paginación+meses, moneda mixta, vacío, idempotencia, 401/429/timeout.");
}

main().catch((e) => { console.error(e); process.exit(1); });
