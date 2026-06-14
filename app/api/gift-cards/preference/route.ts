import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getProductoPorDuracion,
  generarCodigoGiftCard,
  repartirMonto,
  GIFT_CARD_MAX_CANTIDAD,
  type ModoUso,
} from "@/lib/giftCards";
import {
  validarCodigoDescuento,
  consumirCodigoDescuento,
} from "@/lib/codigosDescuento";

// Flujo de pago de Gift Cards, totalmente separado del de reservas.
// external_reference usa el prefijo "gift_card_" + grupo_compra_id y la
// notificación va a /api/gift-cards/webhook. No toca la tabla "reservas".

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

// Genera N códigos únicos distintos entre sí.
function generarCodigosUnicos(n: number): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(generarCodigoGiftCard());
  return Array.from(set);
}

export async function POST(req: Request) {
  let grupoId: string | null = null;

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

    const cantidad = Math.round(Number(body.cantidad) || 1);
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > GIFT_CARD_MAX_CANTIDAD) {
      return NextResponse.json(
        { error: `La cantidad debe estar entre 1 y ${GIFT_CARD_MAX_CANTIDAD}` },
        { status: 400 }
      );
    }

    const modo_uso: ModoUso = body.modo_uso === "juntas" ? "juntas" : "separadas";

    const unit = producto.monto;
    const montoOriginal = unit * cantidad;

    // Validar código de descuento sobre el total (misma lógica que reservas)
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

    grupoId = randomUUID();
    const nowIso = new Date().toISOString();

    const base = {
      comprador_nombre: comprador_nombre.trim(),
      comprador_telefono: comprador_telefono.trim(),
      destinatario_nombre: destinatario_nombre?.trim() || null,
      duracion_minutos: producto.duracion,
      codigo_descuento: codigoAplicado,
      modo_uso,
      grupo_compra_id: grupoId,
      estado_pago: "pendiente_pago",
      estado_uso: "pendiente",
    };

    // Construir las filas a insertar según el modo de uso.
    let rows: Record<string, unknown>[];
    if (modo_uso === "juntas") {
      // Una sola fila que representa toda la compra (cantidad usos).
      rows = [
        {
          ...base,
          codigo_unico: generarCodigosUnicos(1)[0],
          cantidad,
          usos_totales: cantidad,
          usos_disponibles: cantidad,
          monto: montoFinal,
          monto_original: montoOriginal,
          descuento_aplicado: descuentoAplicado,
        },
      ];
    } else {
      // Una fila por gift card, cada una con su código único.
      const codigos = generarCodigosUnicos(cantidad);
      const montos = repartirMonto(montoFinal, cantidad);
      rows = codigos.map((codigo, i) => ({
        ...base,
        codigo_unico: codigo,
        cantidad: 1,
        usos_totales: 1,
        usos_disponibles: 1,
        monto: montos[i],
        monto_original: unit,
        descuento_aplicado: unit - montos[i],
      }));
    }

    const { error: insertError } = await supabaseAdmin
      .from("gift_cards")
      .insert(rows);

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message || "Error creando la Gift Card" },
        { status: 500 }
      );
    }

    // Gift Card 100% bonificada: no pasa por Mercado Pago.
    if (montoFinal <= 0) {
      await supabaseAdmin
        .from("gift_cards")
        .update({
          estado_pago: "pagado",
          estado_uso: "pendiente",
          fecha_pago: nowIso,
          updated_at: nowIso,
        })
        .eq("grupo_compra_id", grupoId);

      if (codigoAplicado) await consumirCodigoDescuento(codigoAplicado);

      return NextResponse.json({ free: true, grupo_compra_id: grupoId });
    }

    if (!accessToken) {
      return NextResponse.json({ error: "Falta MERCADOPAGO_ACCESS_TOKEN" }, { status: 500 });
    }
    if (!baseUrl) {
      return NextResponse.json({ error: "Falta NEXT_PUBLIC_BASE_URL" }, { status: 500 });
    }
    if (isInvalidBaseUrl(baseUrl)) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_BASE_URL no puede ser localhost para pagos" },
        { status: 500 }
      );
    }

    const titulo =
      cantidad > 1
        ? `${cantidad} Gift Cards SIM · ${producto.duracion} min${modo_uso === "juntas" ? " (juntas)" : ""}`
        : `Gift Card SIM Argentina · ${producto.duracion} min`;

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: `gift-card-${grupoId}`,
            title: titulo,
            quantity: 1,
            unit_price: montoFinal,
            currency_id: "ARS",
          },
        ],
        external_reference: `gift_card_${grupoId}`,
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
      .update({ mercado_pago_preference_id: result.id || null, updated_at: nowIso })
      .eq("grupo_compra_id", grupoId);

    return NextResponse.json({
      id: result.id,
      grupo_compra_id: grupoId,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error: unknown) {
    if (grupoId) {
      await supabaseAdmin
        .from("gift_cards")
        .update({ estado_pago: "cancelado", updated_at: new Date().toISOString() })
        .eq("grupo_compra_id", grupoId);
    }
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "No se pudo crear la preferencia de Gift Card", details: msg },
      { status: 500 }
    );
  }
}
