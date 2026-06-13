import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getProductoPorDuracion,
  generarCodigoGiftCard,
} from "@/lib/giftCards";
import {
  validarCodigoDescuento,
  consumirCodigoDescuento,
} from "@/lib/codigosDescuento";

// Flujo de pago de Gift Cards, totalmente separado del de reservas.
// external_reference usa el prefijo "gift_card_" y la notificación va a
// /api/gift-cards/webhook. No toca la tabla "reservas" ni su webhook.

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export async function POST(req: Request) {
  let giftCardId: string | null = null;

  try {
    const body = await req.json();
    const {
      comprador_nombre,
      comprador_telefono,
      destinatario_nombre,
      duracion_minutos,
      codigo_descuento,
    } = body;

    if (!comprador_nombre?.trim() || !comprador_telefono?.trim()) {
      return NextResponse.json(
        { error: "Faltan datos del comprador" },
        { status: 400 }
      );
    }

    const producto = getProductoPorDuracion(Number(duracion_minutos));
    if (!producto) {
      return NextResponse.json(
        { error: "Duración de Gift Card inválida" },
        { status: 400 }
      );
    }

    const montoOriginal = producto.monto;

    // Validar código de descuento (misma lógica que reservas)
    let codigoAplicado: string | null = null;
    let descuentoAplicado = 0;

    if (codigo_descuento && String(codigo_descuento).trim()) {
      const resultado = await validarCodigoDescuento(
        String(codigo_descuento),
        montoOriginal
      );
      if (!resultado.valido) {
        return NextResponse.json(
          { error: resultado.error || "Código inválido" },
          { status: 400 }
        );
      }
      codigoAplicado = resultado.codigo;
      descuentoAplicado = Math.round(resultado.descuento || 0);
    }

    const montoFinal = Math.max(montoOriginal - descuentoAplicado, 0);

    // Crear la Gift Card pendiente de pago
    const { data: giftCard, error: insertError } = await supabaseAdmin
      .from("gift_cards")
      .insert([
        {
          codigo_unico: generarCodigoGiftCard(),
          comprador_nombre: comprador_nombre.trim(),
          comprador_telefono: comprador_telefono.trim(),
          destinatario_nombre: destinatario_nombre?.trim() || null,
          duracion_minutos: producto.duracion,
          monto: montoFinal,
          monto_original: montoOriginal,
          descuento_aplicado: descuentoAplicado,
          codigo_descuento: codigoAplicado,
          estado_pago: "pendiente_pago",
          estado_uso: "pendiente",
        },
      ])
      .select("id")
      .single();

    if (insertError || !giftCard) {
      return NextResponse.json(
        { error: insertError?.message || "Error creando la Gift Card" },
        { status: 500 }
      );
    }

    giftCardId = giftCard.id;

    // Gift Card 100% bonificada: no pasa por Mercado Pago.
    if (montoFinal <= 0) {
      await supabaseAdmin
        .from("gift_cards")
        .update({
          estado_pago: "pagado",
          estado_uso: "pendiente",
          fecha_pago: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", giftCard.id);

      if (codigoAplicado) await consumirCodigoDescuento(codigoAplicado);

      return NextResponse.json({ free: true, gift_card_id: giftCard.id });
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Falta MERCADOPAGO_ACCESS_TOKEN" },
        { status: 500 }
      );
    }
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Falta NEXT_PUBLIC_BASE_URL" },
        { status: 500 }
      );
    }
    if (isInvalidBaseUrl(baseUrl)) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_BASE_URL no puede ser localhost para pagos" },
        { status: 500 }
      );
    }

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: `gift-card-${giftCard.id}`,
            title: `Gift Card SIM Argentina · ${producto.duracion} min`,
            quantity: 1,
            unit_price: montoFinal,
            currency_id: "ARS",
          },
        ],
        external_reference: `gift_card_${giftCard.id}`,
        back_urls: {
          success: `${baseUrl}/gift-cards/exito`,
          failure: `${baseUrl}/gift-cards/error`,
          pending: `${baseUrl}/gift-cards/pendiente`,
        },
        notification_url: `${baseUrl}/api/gift-cards/webhook`,
      },
    });

    await supabaseAdmin
      .from("gift_cards")
      .update({
        mercado_pago_preference_id: result.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", giftCard.id);

    return NextResponse.json({
      id: result.id,
      gift_card_id: giftCard.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error: unknown) {
    if (giftCardId) {
      await supabaseAdmin
        .from("gift_cards")
        .update({ estado_pago: "cancelado", updated_at: new Date().toISOString() })
        .eq("id", giftCardId);
    }
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "No se pudo crear la preferencia de Gift Card", details: msg },
      { status: 500 }
    );
  }
}
