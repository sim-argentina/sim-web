// Capa de analytics (GA4 vía Google Tag Manager) con Consent Mode v2.
// Empuja eventos al dataLayer usando la nomenclatura oficial de GA4. No contiene
// lógica de negocio: solo medición aditiva.

const CONSENT_KEY = "sim-analytics-consent";
const PENDING_PURCHASE_KEY = "sim-pending-purchase";
const PURCHASE_FIRED_KEY = "sim-purchase-fired";
const LEAD_FIRED_KEY = "sim-lead-fired";

export type ConsentValue = "granted" | "denied";

type DL = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function pushDataLayer(obj: DL): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(obj);
}

// Evento GA4 (se envía a GA4 a través del contenedor de GTM).
export function gaEvent(event: string, params: DL = {}): void {
  pushDataLayer({ event, ...params });
}

export function getConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

// Guarda la elección y actualiza Consent Mode v2 (analytics_storage).
export function setConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* almacenamiento no disponible */
  }
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      analytics_storage: value === "granted" ? "granted" : "denied",
    });
  }
  gaEvent("consent_update", { analytics_consent: value });
}

// ── Embudo de compra ─────────────────────────────────────────────────────────

export type PendingPurchase = { value: number; currency: string; type: string };

export function setPendingPurchase(p: PendingPurchase): void {
  try {
    sessionStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

function readPendingPurchase(): PendingPurchase | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PURCHASE_KEY);
    return raw ? (JSON.parse(raw) as PendingPurchase) : null;
  } catch {
    return null;
  }
}

function alreadyFired(id: string): boolean {
  try {
    const raw = sessionStorage.getItem(PURCHASE_FIRED_KEY);
    const set = raw ? (JSON.parse(raw) as string[]) : [];
    if (set.includes(id)) return true;
    set.push(id);
    sessionStorage.setItem(PURCHASE_FIRED_KEY, JSON.stringify(set.slice(-50)));
    return false;
  } catch {
    return false;
  }
}

// Dispara purchase (y el evento específico) una única vez por transacción.
export function trackPurchase(kind: "reserva" | "gift_card" | "campeonato", transactionId: string): void {
  const id = (transactionId || "").trim();
  if (!id || alreadyFired(id)) return;
  const pending = readPendingPurchase();
  const value = pending?.value ?? 0;
  const currency = pending?.currency ?? "ARS";

  gaEvent("purchase", { transaction_id: id, value, currency });

  if (kind === "gift_card") {
    gaEvent("gift_card_purchase", { transaction_id: id, value, currency });
  } else if (kind === "campeonato") {
    gaEvent("sign_up", { method: "mercadopago" });
  }

  try {
    sessionStorage.removeItem(PENDING_PURCHASE_KEY);
  } catch {
    /* noop */
  }
}

// generate_lead una sola vez por sesión (primer contacto por WhatsApp).
export function trackLeadOnce(method: string): void {
  try {
    if (sessionStorage.getItem(LEAD_FIRED_KEY)) return;
    sessionStorage.setItem(LEAD_FIRED_KEY, "1");
  } catch {
    /* noop */
  }
  gaEvent("generate_lead", { method });
}
