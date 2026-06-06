import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Webhook exclusivo para inscripciones de campeonatos.
// No toca la tabla "reservas" ni el webhook existente en /api/mercadopago/webhook.
// Se distingue por el prefijo "campeonato_inscripcion_" en external_reference.

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const paymentId =
      body?.data?.id ||
      body?.id ||
      new URL(req.url).searchParams.get("id");

    const topic =
      body?.type ||
      body?.topic ||
      new URL(req.url).searchParams.get("topic");

    if (!paymentId || topic !== "payment") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const payment = new Payment(client);
    const paymentData = await payment.get({ id: paymentId });

    const extRef = paymentData.external_reference || "";

    // Solo procesar referencias de campeonatos (separación total del flujo de reservas)
    if (!extRef.startsWith("campeonato_inscripcion_")) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const inscripcionId = extRef.replace("campeonato_inscripcion_", "");

    const { data: inscripcion } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .select("id, payment_id")
      .eq("id", inscripcionId)
      .maybeSingle();

    if (!inscripcion) {
      return NextResponse.json(
        { error: "Inscripción no encontrada" },
        { status: 404 }
      );
    }

    // Idempotente: si ya tiene payment_id, ignorar
    if (inscripcion.payment_id) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    let estado_pago: string;
    if (paymentData.status === "approved") {
      estado_pago = "pagado";
    } else if (
      paymentData.status === "rejected" ||
      paymentData.status === "cancelled"
    ) {
      estado_pago = "rechazado";
    } else {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    await supabaseAdmin
      .from("campeonato_inscripciones")
      .update({
        estado_pago,
        payment_id: String(paymentId),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inscripcionId)
      .is("payment_id", null);

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Error en webhook campeonatos:", error);
    return NextResponse.json(
      {
        error: "Error interno del webhook",
        details:
          error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}
