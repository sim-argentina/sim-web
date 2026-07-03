// WhatsApp Cloud API — helpers mínimos para la carga de Finanzas por WhatsApp.
// MVP solo texto. Si faltan variables, el módulo queda desactivado (isWhatsappConfigured=false)
// y la app sigue funcionando: el webhook responde con un error claro sin romper nada.

import crypto from "crypto";

const GRAPH_VERSION = "v21.0";

export function isWhatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_VERIFY_TOKEN
  );
}

export function whatsappVerifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN || "";
}

// Solo dígitos, para comparar teléfonos sin depender de "+", "15", espacios, etc.
export function soloDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// Lista blanca de números autorizados (WHATSAPP_ALLOWED_NUMBERS, separados por coma).
export function numerosAutorizados(): string[] {
  return (process.env.WHATSAPP_ALLOWED_NUMBERS || "")
    .split(",")
    .map((n) => soloDigitos(n))
    .filter((n) => n.length >= 8);
}

// Autoriza si coincide exacto o por los últimos 10 dígitos (evita el lío del 9/15 en AR).
export function esNumeroAutorizado(phone: string): boolean {
  const p = soloDigitos(phone);
  if (!p) return false;
  const cola = p.slice(-10);
  return numerosAutorizados().some((a) => a === p || a.slice(-10) === cola);
}

// Verifica la firma X-Hub-Signature-256 (HMAC-SHA256 del body crudo con APP_SECRET).
// Si no hay APP_SECRET configurado, no se puede validar → devuelve null (el caller decide).
export function verificarFirma(rawBody: string, signatureHeader: string | null): boolean | null {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return null;
  if (!signatureHeader) return false;
  const esperado =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Envía un mensaje de texto por la Cloud API. No lanza: loguea y devuelve ok/err.
export async function enviarTexto(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsappConfigured()) return { ok: false, error: "WhatsApp no configurado" };
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: soloDigitos(to),
        type: "text",
        text: { preview_url: false, body: body.slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Cloud API ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error de red" };
  }
}
