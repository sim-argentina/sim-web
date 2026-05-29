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

    const reservaId = Number(paymentData.external_reference);

    if (!Number.isFinite(reservaId) || reservaId <= 0) {
      return NextResponse.json(
        { error: "El pago no tiene una external_reference válida" },
        { status: 400 }
      );
    }

    const { data: reserva, error: reservaError } = await supabaseAdmin
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .maybeSingle();

    if (reservaError) {
      return NextResponse.json(
        {
          error: "Error buscando reserva pendiente",
          details: reservaError.message,
        },
        { status: 500 }
      );
    }

    if (!reserva) {
      return NextResponse.json(
        { error: "No existe la reserva pendiente asociada al pago" },
        { status: 404 }
      );
    }

    if (reserva.estado === "activa") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const { data: yaPagada } = await supabaseAdmin
      .from("reservas")
      .select("id")
      .eq("mercado_pago_payment_id", String(paymentId))
      .maybeSingle();

    if (yaPagada && Number(yaPagada.id) !== reservaId) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const simuladores = Array.isArray(reserva.simuladores)
      ? reserva.simuladores
      : [];

    if (
      !reserva.nombre ||
      !reserva.telefono ||
      !reserva.fecha ||
      !reserva.hora ||
      simuladores.length === 0 ||
      !reserva.cantidad_turnos ||
      Number(reserva.total) <= 0 ||
      reserva.acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Datos de reserva inválidos" },
        { status: 400 }
      );
    }

    const { data: existentes, error: checkError } = await supabaseAdmin
      .from("reservas")
      .select("id, simuladores")
      .eq("fecha", reserva.fecha)
      .eq("hora", reserva.hora)
      .eq("estado", "activa")
      .neq("id", reservaId);

    if (checkError) {
      return NextResponse.json(
        {
          error: "Error validando disponibilidad",
          details: checkError.message,
        },
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
      await supabaseAdmin
        .from("reservas")
        .update({
          estado: "conflicto_pago_aprobado",
          mercado_pago_payment_id: String(paymentId),
        })
        .eq("id", reservaId);

      return NextResponse.json(
        { error: "Uno o más simuladores ya están reservados" },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("reservas")
      .update({
        estado: "activa",
        mercado_pago_payment_id: String(paymentId),
      })
      .eq("id", reservaId);

    if (updateError) {
      return NextResponse.json(
        {
          error: "Error activando reserva",
          details: updateError.message,
        },
        { status: 500 }
      );
    }

    if (reserva.codigo_descuento) {
      const { data: codigoActual, error: codigoError } = await supabaseAdmin
        .from("codigos_descuento")
        .select("id, usos_actuales, usos_maximos")
        .eq("codigo", reserva.codigo_descuento)
        .maybeSingle();

      if (!codigoError && codigoActual) {
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
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Error en webhook Mercado Pago:", error);

    return NextResponse.json(
      {
        error: "Error interno del webhook",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}