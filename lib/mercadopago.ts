import crypto from "crypto";

// Valida la firma del webhook de Mercado Pago (x-signature / x-request-id) con la
// regla del validador oficial (SDK mercadopago 3.x, utils/webhook): HMAC-SHA256 de
// "id:<data.id>;request-id:<x-request-id>;ts:<ts>;", omitiendo el par que no venga
// en la notificación. El data.id va en minúsculas (regla documentada para ids
// alfanuméricos; los de pagos son numéricos).
//
// Falla cerrada: sin MERCADOPAGO_WEBHOOK_SECRET no hay forma de autenticar la
// notificación, así que se rechaza antes de consultar el pago o tocar la base, y se
// registra el error de configuración sin datos de la solicitud. Mercado Pago
// reintenta lo rechazado, así que al restaurar el secreto se acreditan los pendientes.
export function verifyMpWebhook(req: Request, dataId: string | null | undefined): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[MP webhook] MERCADOPAGO_WEBHOOK_SECRET no configurado: notificación rechazada (error de configuración)");
    return false;
  }

  const sigHeader = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id")?.trim() ?? "";
  const id = dataId == null ? "" : String(dataId).trim();
  if (!sigHeader || !id) return false;

  let ts = "";
  let v1 = "";
  for (const seg of sigHeader.split(",")) {
    const i = seg.indexOf("=");
    if (i === -1) continue;
    const k = seg.slice(0, i).trim().toLowerCase();
    const v = seg.slice(i + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "v1") v1 = v;
  }
  if (!/^\d+$/.test(ts) || !v1) return false;

  const manifest = `id:${id.toLowerCase()};${requestId ? `request-id:${requestId};` : ""}ts:${ts};`;
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(computed);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrae el id del recurso (pago) de la notificación.
export function getWebhookDataId(req: Request, body: unknown): string | null {
  const b = body as { data?: { id?: unknown }; id?: unknown } | null;
  const fromBody = b?.data?.id ?? b?.id;
  if (fromBody) return String(fromBody);
  const url = new URL(req.url);
  return url.searchParams.get("data.id") || url.searchParams.get("id");
}
