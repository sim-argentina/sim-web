import { NextResponse } from "next/server";
import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyMpWebhook } from "@/lib/mercadopago";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import { consumirCodigoDescuento } from "@/lib/codigosDescuento";
import { logSecurityEvent } from "@/lib/apiError";

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

    const { data: reserva, error: reservaError } = await supabaseAdmin
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .maybeSingle();

    if (reservaError || !reserva) {
      return NextResponse.json({ error: "No se encontró la reserva" }, { status: 404 });
    }

    // Idempotencia: si ya tiene payment_id, ya se procesó.
    if (reserva.mercado_pago_payment_id) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Reservar los slots ocupados (garantía DB anti doble-reserva). Si chocan
    // con otra reserva activa, se marca conflicto_pago (no se pisa el turno).
    const sims: string[] = Array.isArray(reserva.simuladores)
      ? reserva.simuladores.map((s: unknown) => String(s))
      : [];
    const dur = Number(reserva.duracion_minutos) || 15;
    const slots = getOccupiedSlots(reserva.fecha, reserva.hora, dur);
    const slotRows = slots.flatMap((slot) =>
      sims.map((sim) => ({
        reserva_id: reservaId,
        fecha: reserva.fecha,
        hora: slot,
        simulador: sim,
        estado: "activa",
      }))
    );

    let estadoFinal = "activa";
    if (slotRows.length > 0) {
      const { error: slotErr } = await supabaseAdmin
        .from("reserva_slots")
        .insert(slotRows);
      if (slotErr) {
        if ((slotErr as { code?: string }).code === "23505") {
          // El turno ya está tomado por otra reserva activa.
          estadoFinal = "conflicto_pago";
          logSecurityEvent("reserva_conflicto_pago", { reservaId });
        } else {
          // Error no-conflicto: no bloquear al cliente que pagó; activar y loguear.
          console.error("reserva_slots insert error:", slotErr.message);
        }
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("reservas")
      .update({ estado: estadoFinal, mercado_pago_payment_id: String(paymentId) })
      .eq("id", reservaId)
      .is("mercado_pago_payment_id", null)
      .select("id");

    if (updateError) {
      return NextResponse.json({ error: "Error actualizando reserva" }, { status: 500 });
    }

    // Consumir el código solo si esta llamada activó realmente la reserva.
    if (
      estadoFinal === "activa" &&
      updated &&
      updated.length > 0 &&
      reserva.codigo_descuento
    ) {
      await consumirCodigoDescuento(reserva.codigo_descuento, {
        reserva_id: reserva.id,
        nombre: reserva.nombre,
        telefono: reserva.telefono,
        fecha_reserva: reserva.fecha,
        hora_reserva: reserva.hora,
        total_original: reserva.total_original,
        descuento_aplicado: reserva.descuento_aplicado,
        total_final: reserva.total,
        mercado_pago_payment_id: String(paymentId),
      });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Error interno del webhook" }, { status: 500 });
  }
}
