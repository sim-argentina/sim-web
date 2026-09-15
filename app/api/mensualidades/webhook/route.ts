import { NextResponse } from "next/server";
import { verifyMpWebhook } from "@/lib/mercadopago";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import { procesarPagoMensualidad, idDePagoDeNotificacion } from "@/lib/mensualidadesPago";

// Webhook exclusivo de Mensualidades. Se distingue por el prefijo
// "mensualidad_" en external_reference y no toca reservas, gift_cards ni
// campeonatos (cada producto tiene su propia notification_url).
//
// NO depende de la feature flag: apagar la venta no puede dejar sin acreditar a
// alguien que ya pagó. Toda la verificación vive en procesarPagoMensualidad.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`wh-mens:${clientIp(req)}`, 300, 60_000))) {
      return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const paymentId = idDePagoDeNotificacion(req, body);
    const topic =
      (body as { type?: string; topic?: string } | null)?.type ??
      (body as { topic?: string } | null)?.topic ??
      new URL(req.url).searchParams.get("topic");

    // Notificaciones que no son de pagos (merchant_order, tests) se aceptan sin más.
    if (!paymentId || topic !== "payment") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Firma, con el mismo helper que el resto de los webhooks del proyecto.
    if (!verifyMpWebhook(req, paymentId)) {
      logSecurityEvent("webhook_firma_invalida", { flujo: "mensualidad" });
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const r = await procesarPagoMensualidad(paymentId);

    // Un pago de otro producto o de una compra inexistente NO es un error nuestro:
    // se responde 200 para que Mercado Pago no reintente eternamente.
    if (r.ok) return NextResponse.json({ received: true }, { status: 200 });

    // Fallos reales sí se devuelven con su código: un 500 silencioso escondería
    // pagos sin acreditar. Sin PII en la respuesta ni en el log.
    logSecurityEvent("mensualidad_webhook_fallo", { motivo: r.motivo });
    return NextResponse.json({ error: r.motivo }, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Error interno del webhook" }, { status: 500 });
  }
}
