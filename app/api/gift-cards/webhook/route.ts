import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { consumirCodigoDescuento } from "@/lib/codigosDescuento";
import { verifyMpWebhook } from "@/lib/mercadopago";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";

// Webhook exclusivo para Gift Cards. Se distingue por el prefijo
// "gift_card_" en external_reference. No toca la tabla "reservas".

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`wh-giftcard:${clientIp(req)}`, 300, 60_000))) {
      return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
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
      logSecurityEvent("webhook_firma_invalida", { flujo: "giftcard" });
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const payment = new Payment(client);
    const paymentData = await payment.get({ id: paymentId });

    const extRef = paymentData.external_reference || "";

    if (!extRef.startsWith("gift_card_")) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const ref = extRef.replace("gift_card_", "");

    // El ref es el grupo_compra_id (flujo nuevo). Por compatibilidad, si no
    // hay filas por grupo, se intenta como id individual (compras viejas).
    let filtro: "grupo_compra_id" | "id" = "grupo_compra_id";
    let { data: filas } = await supabaseAdmin
      .from("gift_cards")
      .select("id, mercado_pago_payment_id, codigo_descuento")
      .eq("grupo_compra_id", ref);

    if (!filas || filas.length === 0) {
      filtro = "id";
      const res = await supabaseAdmin
        .from("gift_cards")
        .select("id, mercado_pago_payment_id, codigo_descuento")
        .eq("id", ref);
      filas = res.data ?? [];
    }

    if (!filas || filas.length === 0) {
      return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });
    }

    // Idempotente: si alguna fila ya tiene payment_id, ya se procesó.
    if (filas.some((f) => f.mercado_pago_payment_id)) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const nowIso = new Date().toISOString();

    if (paymentData.status === "approved") {
      await supabaseAdmin
        .from("gift_cards")
        .update({
          estado_pago: "pagado",
          estado_uso: "pendiente",
          mercado_pago_payment_id: String(paymentId),
          fecha_pago: nowIso,
          updated_at: nowIso,
        })
        .eq(filtro, ref)
        .is("mercado_pago_payment_id", null);

      // Consumir el código de descuento una sola vez (igual que reservas)
      const codigo = filas.find((f) => f.codigo_descuento)?.codigo_descuento;
      if (codigo)
        await consumirCodigoDescuento(codigo, {
          mercado_pago_payment_id: String(paymentId),
        });
    } else if (
      paymentData.status === "rejected" ||
      paymentData.status === "cancelled"
    ) {
      await supabaseAdmin
        .from("gift_cards")
        .update({ estado_pago: "rechazado", updated_at: nowIso })
        .eq(filtro, ref);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Error en webhook gift-cards:", error);
    return NextResponse.json({ error: "Error interno del webhook" }, { status: 500 });
  }
}
