import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

const client = new MercadoPagoConfig({
  accessToken: accessToken!,
});

async function consumirCodigoDescuento(codigo: string) {
  const { data: codigoActual, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("id, usos_actuales, usos_maximos")
    .eq("codigo", codigo)
    .maybeSingle();

  if (error || !codigoActual) return;

  const nuevosUsos = Number(codigoActual.usos_actuales || 0) + 1;

  const usosMaximos =
    codigoActual.usos_maximos === null ||
    codigoActual.usos_maximos === undefined
      ? null
      : Number(codigoActual.usos_maximos);

  const debeInactivar =
    usosMaximos !== null && nuevosUsos >= usosMaximos;

  await supabaseAdmin
    .from("codigos_descuento")
    .update({
      usos_actuales: nuevosUsos,
      activo: debeInactivar ? false : true,
    })
    .eq("id", codigoActual.id);
}

export async function POST(req: Request) {
  try {
    if (!accessToken) {
      return NextResponse.json(
        { error: "Falta MERCADOPAGO_ACCESS_TOKEN" },
        { status: 500 }
      );
    }

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

    if (paymentData.status !== "approved") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const reservaId = Number(paymentData.external_reference);

    if (!Number.isFinite(reservaId) || reservaId <= 0) {
      return NextResponse.json(
        { error: "External reference inválida" },
        { status: 400 }
      );
    }

    const { data: reserva, error: reservaError } = await supabaseAdmin
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .maybeSingle();

    if (reservaError || !reserva) {
      return NextResponse.json(
        { error: "No se encontró la reserva" },
        { status: 404 }
      );
    }

    if (reserva.mercado_pago_payment_id) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("reservas")
      .update({
        estado: "activa",
        mercado_pago_payment_id: String(paymentId),
      })
      .eq("id", reservaId)
      .is("mercado_pago_payment_id", null);

    if (updateError) {
      return NextResponse.json(
        {
          error: "Error actualizando reserva",
          details: updateError.message,
        },
        { status: 500 }
      );
    }

    if (reserva.codigo_descuento) {
      await consumirCodigoDescuento(reserva.codigo_descuento);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error interno del webhook",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}