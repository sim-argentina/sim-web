// Transformaciones PURAS de las respuestas de la GA4 Data API → shapes del dashboard.
// Sin SDK ni credenciales: recibe filas ya normalizadas (Ga4Row) y devuelve objetos
// listos para la UI. Testeable en aislamiento. Nunca contiene PII.

export type Ga4Row = { dims: string[]; mets: number[] };

// Respuesta cruda mínima del SDK (report.rows[].dimensionValues[].value / metricValues[]).
type RawReport = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string | null }>;
    metricValues?: Array<{ value?: string | null }>;
  }> | null;
} | null | undefined;

export function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

// Normaliza un report del SDK a filas simples {dims,mets}. Tolera nulls/vacíos.
export function normalizeRows(report: RawReport): Ga4Row[] {
  const rows = report?.rows ?? [];
  return rows.map((r) => ({
    dims: (r.dimensionValues ?? []).map((d) => String(d?.value ?? "")),
    mets: (r.metricValues ?? []).map((m) => safeNum(m?.value)),
  }));
}

// Variación porcentual vs período anterior. null = sin comparación posible (base 0),
// para no mostrar un "∞%" ni un falso 0. Maneja división por cero explícitamente.
export function pct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type Metric = { value: number; pct: number | null };
const metric = (cur: number, prev: number): Metric => ({ value: cur, pct: pct(cur, prev) });

// ── Resumen (dos reports de una sola fila: actual y anterior) ─────────────────
// Métricas en orden: [totalUsers, newUsers, sessions, screenPageViews, userEngagementDuration].
// purchasesActual/Previo se pasan aparte (vienen del report de funnel).
export function buildResumen(
  actual: Ga4Row[], previo: Ga4Row[], purchasesActual: number, purchasesPrevio: number,
) {
  const a = actual[0]?.mets ?? [];
  const p = previo[0]?.mets ?? [];
  const g = (arr: number[], i: number) => safeNum(arr[i]);
  const sesionesA = g(a, 2), sesionesP = g(p, 2);
  // Engagement medio por sesión (segundos). Evita dividir por cero.
  const engA = sesionesA > 0 ? g(a, 4) / sesionesA : 0;
  const engP = sesionesP > 0 ? g(p, 4) / sesionesP : 0;
  // "Conversión web" (Analytics): purchases / sesiones. Etiquetada como Analytics,
  // NO es la conversión real de negocio (esa se calcula con Supabase).
  const convA = sesionesA > 0 ? (purchasesActual / sesionesA) * 100 : 0;
  const convP = sesionesP > 0 ? (purchasesPrevio / sesionesP) * 100 : 0;
  return {
    usuarios: metric(g(a, 0), g(p, 0)),
    usuariosNuevos: metric(g(a, 1), g(p, 1)),
    sesiones: metric(sesionesA, sesionesP),
    vistas: metric(g(a, 3), g(p, 3)),
    engagementSeg: metric(Math.round(engA), Math.round(engP)),
    conversion: metric(Math.round(convA * 10) / 10, Math.round(convP * 10) / 10),
  };
}

// ── Serie temporal: dim[0]=date (YYYYMMDD), mets=[totalUsers, sessions, screenPageViews]
export function buildSerie(rows: Ga4Row[]): Array<{ fecha: string; usuarios: number; sesiones: number; vistas: number }> {
  return rows
    .map((r) => {
      const d = r.dims[0] ?? "";
      const fecha = d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
      return { fecha, usuarios: safeNum(r.mets[0]), sesiones: safeNum(r.mets[1]), vistas: safeNum(r.mets[2]) };
    })
    .sort((x, y) => x.fecha.localeCompare(y.fecha));
}

export type Item = { label: string; value: number; extra?: number };

// Lista simple dim[0]=label, met[metIdx]=value (+ opcional met[extraIdx]).
export function buildList(rows: Ga4Row[], metIdx = 0, extraIdx?: number, opts?: { excludePrefix?: string; limit?: number }): Item[] {
  let out = rows.map((r) => {
    const item: Item = { label: r.dims[0] ?? "(desconocido)", value: safeNum(r.mets[metIdx]) };
    if (extraIdx != null) item.extra = safeNum(r.mets[extraIdx]);
    return item;
  });
  if (opts?.excludePrefix) out = out.filter((i) => !i.label.startsWith(opts.excludePrefix!));
  out.sort((a, b) => b.value - a.value);
  if (opts?.limit) out = out.slice(0, opts.limit);
  return out;
}

export type FunnelStage = { key: string; label: string; count: number; convPrev: number | null; dropPrev: number | null };

// Construye un funnel a partir de etapas [{key,label,count}]: agrega conversión
// respecto a la etapa anterior y caída (abandono = diferencia matemática entre etapas).
export function buildFunnel(stages: Array<{ key: string; label: string; count: number }>): FunnelStage[] {
  return stages.map((s, i) => {
    if (i === 0) return { ...s, convPrev: null, dropPrev: null };
    const prev = stages[i - 1].count;
    const convPrev = prev > 0 ? Math.round((s.count / prev) * 1000) / 10 : null;
    const dropPrev = prev > 0 ? Math.max(0, prev - s.count) : null;
    return { ...s, convPrev, dropPrev };
  });
}

// ── Conteos por evento a partir de dos reports ───────────────────────────────
// itemRows: dims=[eventName, itemCategory], met=[eventCount].
// eventRows: dims=[eventName, funnel], met=[eventCount].
export type Conteos = { porItemCategory: Map<string, number>; porFunnel: Map<string, number> };
const keyOf = (a: string, b: string) => `${a}::${b}`;

export function indexarConteos(itemRows: Ga4Row[], eventRows: Ga4Row[]): Conteos {
  const porItemCategory = new Map<string, number>();
  for (const r of itemRows) porItemCategory.set(keyOf(r.dims[0] ?? "", r.dims[1] ?? ""), safeNum(r.mets[0]));
  const porFunnel = new Map<string, number>();
  for (const r of eventRows) porFunnel.set(keyOf(r.dims[0] ?? "", r.dims[1] ?? ""), safeNum(r.mets[0]));
  return { porItemCategory, porFunnel };
}

// Funnel Reservas: usa item_category="reserva" para eventos con items y funnel="reserva"
// para los custom. NO mezcla Gift Cards.
export function funnelReservas(c: Conteos): FunnelStage[] {
  const it = (ev: string) => c.porItemCategory.get(keyOf(ev, "reserva")) ?? 0;
  const fn = (ev: string) => c.porFunnel.get(keyOf(ev, "reserva")) ?? 0;
  return buildFunnel([
    { key: "view_item", label: "Entraron", count: it("view_item") },
    { key: "select_date", label: "Fecha", count: fn("select_date") },
    { key: "select_time", label: "Horario", count: fn("select_time") },
    { key: "select_item", label: "Simulador", count: it("select_item") },
    { key: "begin_checkout", label: "Checkout", count: it("begin_checkout") },
    { key: "payment_redirect", label: "Mercado Pago", count: fn("payment_redirect") },
    { key: "purchase", label: "Compra (Analytics)", count: it("purchase") },
  ]);
}

export function funnelGiftCards(c: Conteos): FunnelStage[] {
  const it = (ev: string) => c.porItemCategory.get(keyOf(ev, "gift_card")) ?? 0;
  const fn = (ev: string) => c.porFunnel.get(keyOf(ev, "gift_card")) ?? 0;
  return buildFunnel([
    { key: "view_item", label: "Entraron", count: it("view_item") },
    { key: "select_item", label: "Producto", count: it("select_item") },
    { key: "begin_checkout", label: "Checkout", count: it("begin_checkout") },
    { key: "payment_redirect", label: "Mercado Pago", count: fn("payment_redirect") },
    { key: "purchase", label: "Compra (Analytics)", count: it("purchase") },
  ]);
}

// Total de purchases (reserva + gift) para la conversión del resumen.
export function totalPurchases(itemRows: Ga4Row[]): number {
  return itemRows
    .filter((r) => (r.dims[0] ?? "") === "purchase")
    .reduce((s, r) => s + safeNum(r.mets[0]), 0);
}

// ── Promociones: dims=[funnel, promotion_type], mets=[eventCount, discount_value?] ──
export function buildPromociones(rows: Ga4Row[], tieneDescuento: boolean) {
  let total = 0, descuentoTotal = 0;
  const porFunnel = new Map<string, number>();
  for (const r of rows) {
    const funnel = r.dims[0] || "(sin funnel)";
    const cnt = safeNum(r.mets[0]);
    total += cnt;
    porFunnel.set(funnel, (porFunnel.get(funnel) ?? 0) + cnt);
    if (tieneDescuento) descuentoTotal += safeNum(r.mets[1]);
  }
  return {
    total,
    porFunnel: Array.from(porFunnel, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    descuentoTotal: tieneDescuento ? descuentoTotal : null,
    descuentoPromedio: tieneDescuento && total > 0 ? Math.round(descuentoTotal / total) : null,
  };
}

// ── Errores: checkout_error dims=[funnel, error_stage]; payment_result dims=[funnel, status]
export function buildErrores(checkoutRows: Ga4Row[], pagoRows: Ga4Row[]) {
  const checkout = checkoutRows.map((r) => ({
    label: `${r.dims[0] || "?"} · ${r.dims[1] || "?"}`,
    value: safeNum(r.mets[0]),
  })).sort((a, b) => b.value - a.value);

  let failed = 0, pending = 0;
  const porFunnel = new Map<string, number>();
  for (const r of pagoRows) {
    const funnel = r.dims[0] || "?";
    const status = r.dims[1] || "";
    const cnt = safeNum(r.mets[0]);
    if (status === "failed") failed += cnt;
    else if (status === "pending") pending += cnt;
    porFunnel.set(`${funnel} · ${status}`, cnt);
  }
  return {
    checkout,
    pago: {
      failed,
      pending,
      porFunnel: Array.from(porFunnel, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    },
  };
}
