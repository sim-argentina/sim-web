import { NextResponse } from "next/server";
import { verifyMpWebhook } from "@/lib/mercadopago";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import { procesarPagoCampeonato, idDePagoDeNotificacion } from "@/lib/campeonatosPago";

// Webhook exclusivo de inscripciones a campeonatos. Se distingue por el prefijo
// del external_reference y no toca reservas, gift cards ni mensualidades (cada
// producto tiene su propia notification_url).
//
// ES LA FUENTE DE VERDAD: la inscripción deportiva se crea acá, no cuando el
// navegador vuelve a /campeonatos. Toda la verificación (consulta del pago con
// credenciales del servidor, moneda, importe, cupo, idempotencia) vive en
// lib/campeonatosPago.ts y se comparte con la reconciliación server-side.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`wh-campeonato:${clientIp(req)}`, 300, 60_000))) {
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

    if (!verifyMpWebhook(req, paymentId)) {
      logSecurityEvent("webhook_firma_invalida", { flujo: "campeonato" });
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const r = await procesarPagoCampeonato(paymentId);

    // Un pago de otro producto o de un intento inexistente NO es un error nuestro:
    // se responde 200 para que Mercado Pago no reintente eternamente.
    if (r.ok) {
      if (r.estado === "sin_cupo") {
        // Pagó después de vencer la reserva y ya no había lugar: queda registrado
        // en el intento para que el staff lo resuelva (devolución o cupo extra).
        logSecurityEvent("campeonato_pago_sin_cupo", { payment_id: paymentId });
      }
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Fallos reales sí se devuelven con su código: un 200 silencioso escondería
    // pagos sin acreditar. Sin PII en la respuesta ni en el log.
    logSecurityEvent("campeonato_webhook_fallo", { motivo: r.motivo });
    return NextResponse.json({ error: r.motivo }, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Error interno del webhook" }, { status: 500 });
  }
}
