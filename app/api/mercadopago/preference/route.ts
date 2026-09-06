import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import { hayDisponibilidadPara } from "@/lib/disponibilidad";
import { getPrecioReserva } from "@/lib/reservasPricing";
import { validarCodigoDescuento } from "@/lib/codigosDescuento";
import { reservaEstaBloqueada } from "@/lib/bloqueos";
import { validarReservaInput } from "@/lib/reservasValidation";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export async function POST(req: Request) {
  if (!(await rateLimit(`pref-resv:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

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

    // Bloqueos admin: si el turno cae en un bloqueo activo, no se crea la reserva
    // ni la preferencia (server-side, no se puede saltear desde el cliente).
    const slotsTurno = getOccupiedSlots(fecha, hora, duracion);
    if (await reservaEstaBloqueada(fecha, slotsTurno, simuladores)) {
      return NextResponse.json(
        { error: "Ese horario no está disponible." },
        { status: 400 }
      );
    }

    // Precio recalculado server-side (incluye precio especial de la fecha si existe);
    // se ignora cualquier total enviado por el cliente.
    const totalOriginal = (await getPrecioReserva(fecha, duracion)) * simuladores.length;
    if (!Number.isFinite(totalOriginal) || totalOriginal <= 0) {
      return NextResponse.json(
        { error: "No se pudo calcular el precio de la reserva" },
        { status: 400 }
      );
    }

    let descuentoAplicado = 0;
    let codigoAplicado: string | null = null;
    if (codigo_descuento) {
      const r = await validarCodigoDescuento(codigo_descuento, totalOriginal, fecha, duracion);
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

    // (M6) Disponibilidad real por la fuente única: reservas activas +
    // pendientes recientes + bloqueos, con intersección de simuladores libres en
    // TODOS los bloques que ocupa la duración. Reemplaza el chequeo de ocupación
    // que este endpoint calculaba por su cuenta.
    const disp = await hayDisponibilidadPara({
      fecha, hora, duracion, simuladores, producto: "reserva",
    });
    if (!disp.ok) {
      return NextResponse.json({ error: disp.error }, { status: disp.status });
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
