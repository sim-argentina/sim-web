import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { verifyMpWebhook } from "@/lib/mercadopago";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import type { PagoMpFinanzas } from "@/lib/mercadopagoPagos";
import { procesarPagoAprobadoReserva } from "@/lib/reservasWebhook";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

const client = new MercadoPagoConfig({
  accessToken: accessToken!,
});

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`wh-reserva:${clientIp(req)}`, 300, 60_000))) {
      return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
    }

    if (!accessToken) {
      return NextResponse.json({ error: "Servicio no disponible" }, { status: 500 });
    }

    const body = await req.json();

    const paymentId =
      body?.data?.id || body?.id || new URL(req.url).searchParams.get("id");
    const topic =
      body?.type || body?.topic || new URL(req.url).searchParams.get("topic");

    if (!paymentId || topic !== "payment") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (!verifyMpWebhook(req, paymentId)) {
      logSecurityEvent("webhook_firma_invalida", { flujo: "reserva" });
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const payment = new Payment(client);
    const paymentData = await payment.get({ id: paymentId });

    if (paymentData.status !== "approved") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const extRef = paymentData.external_reference || "";
    // No procesar referencias de otros flujos.
    if (extRef.startsWith("gift_card_") || extRef.startsWith("campeonato_")) {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    const reservaId = Number(extRef.replace(/^reserva_/, ""));

    if (!Number.isFinite(reservaId) || reservaId <= 0) {
      return NextResponse.json({ error: "Referencia inválida" }, { status: 400 });
    }

    // (B3) Confirmación con los slots de la modalidad GUARDADA en la reserva
    // (nunca la vigente). Nunca queda 'activa' sin todos sus slots: si la base
    // los rechaza, queda 'conflicto_pago' con su payment_id para resolverla a
    // mano. Idempotente frente a notificaciones repetidas.
    const r = await procesarPagoAprobadoReserva({
      reservaId,
      paymentId: String(paymentId),
      paymentData: paymentData as PagoMpFinanzas,
    });
    return NextResponse.json(r.body, { status: r.http });
  } catch {
    return NextResponse.json({ error: "Error interno del webhook" }, { status: 500 });
  }
}
