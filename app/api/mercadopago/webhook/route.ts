import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

const client = new MercadoPagoConfig({
  accessToken: accessToken!,
});

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

    if (!paymentData.external_reference) {
      return NextResponse.json(
        { error: "El pago no tiene external_reference" },
        { status: 400 }
      );
    }

    const reserva = JSON.parse(paymentData.external_reference);

    const {
      nombre,
      telefono,
      fecha,
      hora,
      simuladores,
      cantidad_turnos,
      total,
      acepto_condiciones,
    } = reserva;

    if (
      !nombre ||
      !telefono ||
      !fecha ||
      !hora ||
      !Array.isArray(simuladores) ||
      simuladores.length === 0 ||
      !cantidad_turnos ||
      !total ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Datos de reserva inválidos" },
        { status: 400 }
      );
    }

    const { data: reservaExistente } = await supabaseAdmin
      .from("reservas")
      .select("id")
      .eq("mercado_pago_payment_id", String(paymentId))
      .maybeSingle();

    if (reservaExistente) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const { data: existentes, error: checkError } = await supabaseAdmin
      .from("reservas")
      .select("id, simuladores")
      .eq("fecha", fecha)
      .eq("hora", hora)
      .eq("estado", "activa");

    if (checkError) {
      return NextResponse.json(
        { error: "Error validando disponibilidad", details: checkError.message },
        { status: 500 }
      );
    }

    const ocupados = new Set<string>();

    for (const reservaExistente of existentes || []) {
      const sims = Array.isArray(reservaExistente.simuladores)
        ? reservaExistente.simuladores
        : [];

      for (const sim of sims) {
        ocupados.add(sim);
      }
    }

    const conflicto = simuladores.some((sim: string) => ocupados.has(sim));

    if (conflicto) {
      return NextResponse.json(
        { error: "Uno o más simuladores ya están reservados" },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from("reservas").insert([
      {
        nombre,
        telefono,
        fecha,
        hora,
        simuladores,
        cantidad_turnos,
        total,
        estado: "activa",
        acepto_condiciones,
        mercado_pago_payment_id: String(paymentId),
      },
    ]);

    if (error) {
      return NextResponse.json(
        { error: "Error guardando reserva", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ received: true }, { status: 201 });
  } catch (error) {
    console.error("Error webhook MercadoPago:", error);

    return NextResponse.json(
      { error: "Error interno webhook" },
      { status: 500 }
    );
  }
}