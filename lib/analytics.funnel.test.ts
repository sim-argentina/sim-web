import { strict as assert } from "node:assert";
import * as A from "@/lib/analytics";

// Ejecutar: npx tsx lib/analytics.funnel.test.ts
// Prueba los helpers del funnel (Reservas / Gift Cards) sin navegador real: se
// stubbean window (con dataLayer) y sessionStorage. Los helpers leen el entorno en
// tiempo de llamada, así que basta con setearlo antes de cada caso.

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
type W = { location: { hostname: string; pathname: string }; dataLayer: Array<Record<string, unknown>> };
const g = globalThis as unknown as { window?: W; sessionStorage?: MemStorage };
function setEnv(hostname: string, pathname: string) {
  g.window = { location: { hostname, pathname }, dataLayer: [] };
  g.sessionStorage = new MemStorage();
}
function prod() { setEnv("www.simexperience.com.ar", "/reservas"); }
function dl(): Array<Record<string, unknown>> { return g.window!.dataLayer; }
function events(): string[] { return dl().map((e) => String(e.event)); }

// ── Guard: política pura ────────────────────────────────────────────────────────
assert.equal(A.analyticsAllowedFor("localhost", "/reservas"), false, "localhost bloqueado");
assert.equal(A.analyticsAllowedFor("preview.vercel.app", "/reservas"), false, "preview bloqueado");
assert.equal(A.analyticsAllowedFor("www.simexperience.com.ar", "/admin"), false, "/admin bloqueado");
assert.equal(A.analyticsAllowedFor("www.simexperience.com.ar", "/admin/metricas"), false, "/admin/* bloqueado");
assert.equal(A.analyticsAllowedFor("www.simexperience.com.ar", "/reservas"), true, "producción pública permitido");

// ── Guard en runtime: fuera de producción / en /admin NO emite ──────────────────
setEnv("localhost", "/reservas");
A.trackSelectDate("reserva");
A.trackPaymentRedirect({ funnel: "reserva", value: 100 });
assert.equal(dl().length, 0, "localhost: no emite ningún evento");

setEnv("www.simexperience.com.ar", "/admin/metricas");
A.trackSelectDate("reserva");
A.trackCheckoutError("reserva");
A.trackFreePurchase({ kind: "reserva", transactionId: "reserva_1" });
assert.equal(dl().length, 0, "/admin: no emite ningún evento (ni purchase)");

// ── select_date / select_time: SIN fecha/hora concreta ──────────────────────────
prod();
A.trackSelectDate("reserva");
assert.deepEqual(dl()[0], { event: "select_date", funnel: "reserva" }, "select_date solo etapa");
prod();
A.trackSelectTime("reserva");
assert.deepEqual(dl()[0], { event: "select_time", funnel: "reserva" }, "select_time solo etapa");

// ── apply_promotion: sin el código literal (solo magnitud) ──────────────────────
prod();
A.trackApplyPromotion("gift_card", 5000);
assert.deepEqual(dl()[0], { event: "apply_promotion", funnel: "gift_card", promotion_type: "discount_code", discount_value: 5000, currency: "ARS" }, "apply_promotion sin código literal");

// ── payment_redirect: con y sin transaction_id ──────────────────────────────────
prod();
A.trackPaymentRedirect({ funnel: "reserva", value: 15000, duration_minutes: 15, quantity: 2, transaction_id: "reserva_42" });
assert.deepEqual(dl()[0], { event: "payment_redirect", funnel: "reserva", currency: "ARS", value: 15000, duration_minutes: 15, quantity: 2, transaction_id: "reserva_42" }, "payment_redirect reserva estable");
prod();
A.trackPaymentRedirect({ funnel: "gift_card", value: 0 });
assert.deepEqual(dl()[0], { event: "payment_redirect", funnel: "gift_card", currency: "ARS", value: 0 }, "payment_redirect sin transaction_id opcional");

// ── checkout_error: técnico, sin mensajes de excepción; NO genera purchase ───────
prod();
A.trackCheckoutError("reserva");
assert.deepEqual(dl()[0], { event: "checkout_error", funnel: "reserva", error_stage: "preference" }, "checkout_error tipado");
assert.ok(!events().includes("purchase"), "checkout_error no genera purchase");

// ── payment_result: failed / pending ────────────────────────────────────────────
prod();
A.trackPaymentResult("reserva", "failed");
A.trackPaymentResult("gift_card", "pending");
assert.deepEqual(dl()[0], { event: "payment_result", funnel: "reserva", status: "failed" });
assert.deepEqual(dl()[1], { event: "payment_result", funnel: "gift_card", status: "pending" });
assert.ok(!events().includes("purchase"), "payment_result no genera purchase");

// ── Conversión free (reserva): purchase value 0 + dedupe robusto ────────────────
prod();
A.trackFreePurchase({ kind: "reserva", transactionId: "reserva_7", coupon: "PROMO" });
A.trackFreePurchase({ kind: "reserva", transactionId: "reserva_7", coupon: "PROMO" }); // duplicado
const purchasesR = dl().filter((e) => e.event === "purchase");
assert.equal(purchasesR.length, 1, "dedupe: una sola purchase por transaction_id");
assert.deepEqual(purchasesR[0], { event: "purchase", transaction_id: "reserva_7", value: 0, currency: "ARS", coupon: "PROMO" }, "purchase free reserva value 0 + coupon");
assert.ok(!events().includes("gift_card_purchase"), "reserva no dispara gift_card_purchase");

// ── Conversión free (gift card): purchase + gift_card_purchase, id estable ──────
prod();
A.trackFreePurchase({ kind: "gift_card", transactionId: "gift_card_9" });
assert.deepEqual(events(), ["purchase", "gift_card_purchase"], "gift free: purchase + gift_card_purchase");
assert.deepEqual(dl()[0], { event: "purchase", transaction_id: "gift_card_9", value: 0, currency: "ARS" }, "gift free value 0, id estable, sin coupon");

// ── Sin PII: ningún evento del funnel contiene datos personales ni fecha/hora ────
prod();
A.trackSelectDate("reserva"); A.trackSelectTime("reserva");
A.trackApplyPromotion("reserva", 1000);
A.trackPaymentRedirect({ funnel: "reserva", value: 1, duration_minutes: 30, quantity: 1, transaction_id: "reserva_5" });
A.trackCheckoutError("reserva"); A.trackPaymentResult("reserva", "failed");
A.trackFreePurchase({ kind: "gift_card", transactionId: "gift_card_5" });
const json = JSON.stringify(dl());
for (const prohibido of ["nombre", "apellido", "telefono", "email", "dni", "direccion", "selected_date", "selected_time", "fecha", "hora"]) {
  assert.ok(!json.includes(prohibido), `PII/temporal: el dataLayer no debe contener "${prohibido}"`);
}

console.log("OK — funnel analytics: guard (localhost/preview/admin no emiten), select_date/time sin fecha/hora, " +
  "apply_promotion sin código literal, payment_redirect estable, checkout_error técnico sin purchase, " +
  "payment_result failed/pending, conversión free reserva y gift (value 0), dedupe por transaction_id, sin PII.");
