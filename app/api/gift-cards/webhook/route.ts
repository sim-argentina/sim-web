import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Webhook exclusivo para Gift Cards. Se distingue por el prefijo
// "gift_card_" en external_reference. No toca la tabla "reservas".

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const paymentId =
      body?.data?.id || body?.id || new URL(req.url).searchParams.get("id");

    const topic =
      body?.type || body?.topic || new URL(req.url).searchParams.get("topic");

    if (!paymentId || topic !== "payment") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const payment = new Payment(client);
    const paymentData = await payment.get({ id: paymentId });

    const extRef = paymentData.external_reference || "";

    if (!extRef.startsWith("gift_card_")) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const giftCardId = extRef.replace("gift_card_", "");

    const { data: giftCard } = await supabaseAdmin
      .from("gift_cards")
      .select("id, mercado_pago_payment_id")
      .eq("id", giftCardId)
      .maybeSingle();

    if (!giftCard) {
      return NextResponse.json(
        { error: "Gift Card no encontrada" },
        { status: 404 }
      );
    }

    // Idempotente
    if (giftCard.mercado_pago_payment_id) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (paymentData.status === "approved") {
      await supabaseAdmin
        .from("gift_cards")
        .update({
          estado_pago: "pagado",
          estado_uso: "lista",
          mercado_pago_payment_id: String(paymentId),
          fecha_pago: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", giftCardId)
        .is("mercado_pago_payment_id", null);
    } else if (
      paymentData.status === "rejected" ||
      paymentData.status === "cancelled"
    ) {
      await supabaseAdmin
        .from("gift_cards")
        .update({
          estado_pago: "rechazado",
          updated_at: new Date().toISOString(),
        })
        .eq("id", giftCardId);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Error en webhook gift-cards:", error);
    return NextResponse.json(
      {
        error: "Error interno del webhook",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}
