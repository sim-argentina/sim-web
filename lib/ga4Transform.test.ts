import { strict as assert } from "node:assert";
import {
  safeNum, pct, normalizeRows, buildResumen, buildSerie, buildList,
  indexarConteos, funnelReservas, funnelGiftCards, totalPurchases,
  buildPromociones, buildErrores, buildFunnel,
} from "@/lib/ga4Transform";

// Ejecutar: npx tsx lib/ga4Transform.test.ts

// ── safeNum: parsing seguro de valores GA4 (strings) ────────────────────────────
assert.equal(safeNum("42"), 42);
assert.equal(safeNum("3.5"), 3.5);
assert.equal(safeNum("no-num"), 0);
assert.equal(safeNum(null), 0);
assert.equal(safeNum(undefined), 0);

// ── pct: división por cero explícita ────────────────────────────────────────────
assert.equal(pct(100, 80), 25);
assert.equal(pct(80, 100), -20);
assert.equal(pct(0, 0), 0, "0 vs 0 → 0%");
assert.equal(pct(50, 0), null, "base 0 con actual > 0 → sin comparación (null)");

// ── normalizeRows: tolera shape del SDK, nulls y dataset vacío ───────────────────
const rep = { rows: [
  { dimensionValues: [{ value: "reserva" }], metricValues: [{ value: "10" }] },
  { dimensionValues: [{ value: null }], metricValues: [{ value: null }] },
] };
const rows = normalizeRows(rep);
assert.deepEqual(rows[0], { dims: ["reserva"], mets: [10] });
assert.deepEqual(rows[1], { dims: [""], mets: [0] });
assert.deepEqual(normalizeRows(null), [], "report nulo → []");
assert.deepEqual(normalizeRows({ rows: [] }), [], "dataset vacío → []");

// ── Resumen + comparación (métricas [users,new,sessions,views,engagement]) ──────
const act = [{ dims: [], mets: [100, 40, 120, 300, 6000] }];
const prev = [{ dims: [], mets: [80, 30, 100, 250, 4000] }];
const res = buildResumen(act, prev, 12, 8);
assert.equal(res.usuarios.value, 100);
assert.equal(res.usuarios.pct, 25);
assert.equal(res.sesiones.value, 120);
assert.equal(res.engagementSeg.value, 50, "6000/120 = 50s por sesión");
assert.equal(res.conversion.value, 10, "12 purchases / 120 sesiones = 10%");
// Resumen con datasets vacíos NO rompe (evita división por cero).
const vacio = buildResumen([], [], 0, 0);
assert.equal(vacio.usuarios.value, 0);
assert.equal(vacio.engagementSeg.value, 0);
assert.equal(vacio.conversion.value, 0);
assert.equal(vacio.usuarios.pct, 0);

// ── Serie temporal (dim date YYYYMMDD ordenada) ─────────────────────────────────
const serie = buildSerie([{ dims: ["20260315"], mets: [10, 12, 30] }, { dims: ["20260314"], mets: [5, 6, 15] }]);
assert.deepEqual(serie[0], { fecha: "2026-03-14", usuarios: 5, sesiones: 6, vistas: 15 }, "ordenada asc");

// ── buildList: excluye /admin, ordena y limita ─────────────────────────────────
const pags = buildList(
  [{ dims: ["/reservas"], mets: [100] }, { dims: ["/admin/x"], mets: [999] }, { dims: ["/"], mets: [50] }],
  0, undefined, { excludePrefix: "/admin", limit: 2 },
);
assert.equal(pags.length, 2);
assert.ok(!pags.some((p) => p.label.startsWith("/admin")), "excluye /admin por seguridad");
assert.equal(pags[0].label, "/reservas");

// ── Funnel: conversión respecto a etapa anterior + caída ───────────────────────
const f = buildFunnel([{ key: "a", label: "A", count: 100 }, { key: "b", label: "B", count: 70 }, { key: "c", label: "C", count: 0 }]);
assert.equal(f[0].convPrev, null);
assert.equal(f[1].convPrev, 70);
assert.equal(f[1].dropPrev, 30);
assert.equal(f[2].dropPrev, 70);

// ── Separación Reservas / Gift Cards (item_category vs funnel) ──────────────────
const itemRows = [
  { dims: ["view_item", "reserva"], mets: [1000] }, { dims: ["select_item", "reserva"], mets: [530] },
  { dims: ["begin_checkout", "reserva"], mets: [390] }, { dims: ["purchase", "reserva"], mets: [320] },
  { dims: ["view_item", "gift_card"], mets: [200] }, { dims: ["select_item", "gift_card"], mets: [120] },
  { dims: ["begin_checkout", "gift_card"], mets: [60] }, { dims: ["purchase", "gift_card"], mets: [40] },
];
const eventRows = [
  { dims: ["select_date", "reserva"], mets: [720] }, { dims: ["select_time", "reserva"], mets: [610] },
  { dims: ["payment_redirect", "reserva"], mets: [370] }, { dims: ["payment_redirect", "gift_card"], mets: [55] },
];
const c = indexarConteos(itemRows, eventRows);
assert.deepEqual(funnelReservas(c).map((s) => s.count), [1000, 720, 610, 530, 390, 370, 320], "funnel reservas: 7 etapas, SIN gift cards");
assert.deepEqual(funnelGiftCards(c).map((s) => s.count), [200, 120, 60, 55, 40], "funnel gift cards: 5 etapas, SIN reservas");
assert.equal(totalPurchases(itemRows), 360, "purchases totales = reserva 320 + gift 40");

// ── Promociones: con y sin custom metric discount_value ────────────────────────
const promoRows = [{ dims: ["reserva", "discount_code"], mets: [10, 5000] }, { dims: ["gift_card", "discount_code"], mets: [4, 2000] }];
const p = buildPromociones(promoRows, true);
assert.equal(p.total, 14);
assert.equal(p.descuentoTotal, 7000);
assert.equal(p.descuentoPromedio, 500);
assert.equal(buildPromociones(promoRows, false).descuentoTotal, null, "sin metric → descuento null (no inventa)");

// ── Errores: checkout_error + payment_result (pending no es error) ─────────────
const err = buildErrores([{ dims: ["reserva", "preference"], mets: [7] }], [{ dims: ["reserva", "failed"], mets: [5] }, { dims: ["gift_card", "pending"], mets: [3] }]);
assert.equal(err.checkout[0].value, 7);
assert.equal(err.pago.failed, 5);
assert.equal(err.pago.pending, 3);

console.log("OK — ga4Transform: safeNum, pct (div0=null), normalizeRows (nulls/vacío), resumen+comparación, " +
  "serie, buildList (excluye /admin), funnel conv/caída, separación reserva/gift, promociones (con/sin descuento), errores.");
