import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  evaluarPedido, filaReservaWeb, precioDelPedido, prepararReservaWeb, type Fallo,
} from "@/lib/reservasComercial";
import { validarCodigoDescuento } from "@/lib/codigosDescuento";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";

const falloJson = (f: Fallo) =>
  NextResponse.json(
    { error: f.error, ...(f.codigo ? { codigo: f.codigo } : {}), ...(f.duraciones ? { duraciones: f.duraciones } : {}) },
    { status: f.status },
  );

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

    // (B3) La modalidad se resuelve UNA vez en este request y queda guardada en
    // la reserva pendiente: el webhook la usa aunque el pago llegue después del
    // corte. Catálogo visto distinto del vigente → 409: ni reserva, ni
    // preferencia, ni cobro.
    const preparado = await prepararReservaWeb(body);
    if (!preparado.ok) return falloJson(preparado);
    const pedido = preparado.pedido;
    const { fecha, duracion, codigo_descuento } = pedido;

    // Bloqueos y disponibilidad por el motor de intervalos con las reglas de SU
    // modalidad. Bloqueado → 400 acá, como siempre; la ocupación se informa más
    // abajo, en el mismo orden de antes.
    const veredicto = await evaluarPedido(pedido);
    if (veredicto.bloqueado) {
      return NextResponse.json(
        { error: "Ese horario no está disponible." },
        { status: 400 }
      );
    }

    // Precio recalculado server-side por SU modalidad (incluye precio especial
    // de la fecha si existe); se ignora cualquier total enviado por el cliente.
    const precio = await precioDelPedido(pedido, body);
    if (!precio.ok) return falloJson(precio);
    const totalOriginal = precio.totalOriginal;
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

    // Disponibilidad real (motor por intervalos): reservas activas + pendientes
    // recientes + bloqueos; cada simulador pedido libre durante TODO el turno,
    // buffer incluido en v2.
    if (veredicto.ocupado) return falloJson(veredicto.ocupado);

    const { data: reservaPendiente, error: insertError } = await supabaseAdmin
      .from("reservas")
      .insert([
        filaReservaWeb(pedido, {
          estado: "pendiente_pago",
          total: totalFinal,
          total_original: totalOriginal,
          descuento_aplicado: Math.round(descuentoAplicado),
          codigo_descuento: codigoAplicado,
        }),
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
