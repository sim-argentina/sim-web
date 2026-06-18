import crypto from "crypto";

// Valida la firma del webhook de Mercado Pago (x-signature / x-request-id).
// Manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// Si MERCADOPAGO_WEBHOOK_SECRET no está configurado, NO bloquea (fail-open con
// warning) para no romper la confirmación de pagos hasta setear el secreto.
export function verifyMpWebhook(req: Request, dataId: string | null | undefined): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[MP webhook] MERCADOPAGO_WEBHOOK_SECRET no configurado: firma no validada");
    return true;
  }

  const sigHeader = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id") || "";
  if (!sigHeader || !dataId) return false;

  const parts: Record<string, string> = {};
  for (const seg of sigHeader.split(",")) {
    const [k, v] = seg.split("=").map((s) => s?.trim());
    if (k && v) parts[k] = v;
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
  } catch {
    return false;
  }
}

// Extrae el id del recurso (pago) de la notificación.
export function getWebhookDataId(req: Request, body: unknown): string | null {
  const b = body as { data?: { id?: unknown }; id?: unknown } | null;
  const fromBody = b?.data?.id ?? b?.id;
  if (fromBody) return String(fromBody);
  const url = new URL(req.url);
  return url.searchParams.get("data.id") || url.searchParams.get("id");
}
