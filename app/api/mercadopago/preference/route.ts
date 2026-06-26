import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getOccupiedSlots,
  construirOcupacion,
  precioPorSimulador,
} from "@/lib/reservasSlots";
import { validarCodigoDescuento } from "@/lib/codigosDescuento";
import { validarReservaInput } from "@/lib/reservasValidation";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

// Las reservas pendiente_pago de los últimos N minutos bloquean el turno
// (mitiga la doble reserva mientras el cliente está pagando).
const PENDIENTE_TTL_MIN = 15;

export async function POST(req: Request) {
  if (!(await rateLimit(`pref-resv:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }

  let reservaPendienteId: number | null = null;
  try {
    if (!accessToken) {
      return failResponse(500, "Servicio de pago no disponible", {
        logContext: "pref-resv sin access token",
      });
    }
    if (!baseUrl || isInvalidBaseUrl(baseUrl)) {
      return failResponse(500, "Servicio de pago mal configurado", {
        logContext: "pref-resv baseUrl inválida",
      });
    }

    const body = await req.json().catch(() => null);
    const v = validarReservaInput(body);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    const { nombre, telefono, fecha, hora, simuladores, duracion, codigo_descuento } =
      v.value;

    // Precio recalculado server-side; se ignora cualquier total del cliente.
    const totalOriginal = precioPorSimulador(fecha, duracion) * simuladores.length;
    if (!Number.isFinite(totalOriginal) || totalOriginal <= 0) {
      return NextResponse.json(
        { error: "No se pudo calcular el precio de la reserva" },
        { status: 400 }
      );
    }

    let descuentoAplicado = 0;
    let codigoAplicado: string | null = null;
    if (codigo_descuento) {
      const r = await validarCodigoDescuento(codigo_descuento, totalOriginal, fecha);
      if (!r.valido) {
        return NextResponse.json({ error: r.error || "Código inválido" }, { status: 400 });
      }
      descuentoAplicado = Number(r.descuento || 0);
      codigoAplicado = r.codigo;
    }

    const totalFinal = Math.round(Math.max(totalOriginal - descuentoAplicado, 0));
    if (!Number.isFinite(totalFinal) || totalFinal <= 0) {
      return NextResponse.json(
        { error: "El total final debe ser mayor a $0 para pagar con Mercado Pago." },
        { status: 400 }
      );
    }

    // Disponibilidad: reservas activas + pendientes recientes ocupan el turno.
    const reqSlots = getOccupiedSlots(fecha, hora, duracion);
    const ttlIso = new Date(Date.now() - PENDIENTE_TTL_MIN * 60_000).toISOString();

    const { data: existentes, error: checkError } = await supabaseAdmin
      .from("reservas")
      .select("id, hora, duracion_minutos, simuladores, estado, created_at")
      .eq("fecha", fecha)
      .in("estado", ["activa", "pendiente_pago"]);

    if (checkError) {
      return failResponse(500, "Error validando disponibilidad", {
        logContext: "pref-resv check",
        error: checkError,
      });
    }

    const bloqueantes = (existentes || []).filter(
      (r) =>
        r.estado === "activa" ||
        (r.estado === "pendiente_pago" && r.created_at && r.created_at > ttlIso)
    );
    const ocupacion = construirOcupacion(fecha, bloqueantes);
    const conflicto = reqSlots.some((slot) =>
      simuladores.some((sim) => ocupacion[slot]?.has(sim))
    );
    if (conflicto) {
      return NextResponse.json(
        { error: "Uno o más simuladores ya están reservados en ese horario" },
        { status: 409 }
      );
    }

    const { data: reservaPendiente, error: insertError } = await supabaseAdmin
      .from("reservas")
      .insert([
        {
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos: simuladores.length,
          total: totalFinal,
          total_original: totalOriginal,
          descuento_aplicado: Math.round(descuentoAplicado),
          codigo_descuento: codigoAplicado,
          estado: "pendiente_pago",
          acepto_condiciones: true,
          duracion_minutos: duracion,
        },
      ])
      .select("id")
      .single();

    if (insertError || !reservaPendiente) {
      return failResponse(500, "Error creando la reserva", {
        logContext: "pref-resv insert",
        error: insertError,
      });
    }
    reservaPendienteId = reservaPendiente.id;

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: `reserva-sim-${reservaPendiente.id}`,
            title: "Reserva SIM Argentina",
            quantity: 1,
            unit_price: totalFinal,
            currency_id: "ARS",
          },
        ],
        external_reference: `reserva_${reservaPendiente.id}`,
        back_urls: {
          success: `${baseUrl}/reservas/exito`,
          failure: `${baseUrl}/reservas/error`,
          pending: `${baseUrl}/reservas/pendiente`,
        },
        notification_url: `${baseUrl}/api/mercadopago/webhook`,
      },
    });

    return NextResponse.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      reserva_id: reservaPendiente.id,
      total_original: totalOriginal,
      descuento_aplicado: Math.round(descuentoAplicado),
      total_final: totalFinal,
      codigo_descuento: codigoAplicado,
    });
  } catch (error) {
    if (reservaPendienteId) {
      await supabaseAdmin
        .from("reservas")
        .update({ estado: "error_pago" })
        .eq("id", reservaPendienteId);
    }
    return failResponse(500, "No se pudo crear la preferencia", {
      logContext: "pref-resv",
      error,
    });
  }
}
