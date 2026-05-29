import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({
  accessToken: accessToken!,
});

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

function calcularDescuento(tipo: string, valor: number, totalOriginal: number) {
  if (tipo === "porcentaje") return totalOriginal * (valor / 100);
  if (tipo === "monto_fijo") return valor;
  if (tipo === "turno_gratis") return valor;
  return 0;
}

async function validarCodigoDescuento(
  codigoIngresado: string,
  totalOriginal: number
) {
  const codigoBuscado = codigoIngresado.trim().toUpperCase();

  const { data: codigo, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("*")
    .eq("codigo", codigoBuscado)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!codigo) {
    return { valido: false, codigo: null, descuento: 0, error: "El código no existe" };
  }

  if (!codigo.activo) {
    return { valido: false, codigo, descuento: 0, error: "El código no está activo" };
  }

  const hoy = new Date().toISOString().slice(0, 10);

  if (codigo.fecha_inicio && hoy < codigo.fecha_inicio) {
    return { valido: false, codigo, descuento: 0, error: "El código todavía no está vigente" };
  }

  if (codigo.fecha_fin && hoy > codigo.fecha_fin) {
    return { valido: false, codigo, descuento: 0, error: "El código está vencido" };
  }

  if (
    codigo.usos_maximos !== null &&
    codigo.usos_maximos !== undefined &&
    Number(codigo.usos_actuales || 0) >= Number(codigo.usos_maximos)
  ) {
    return {
      valido: false,
      codigo,
      descuento: 0,
      error: "El código ya alcanzó el máximo de usos",
    };
  }

  const descuentoCalculado = calcularDescuento(
    codigo.tipo_descuento,
    Number(codigo.valor_descuento || 0),
    totalOriginal
  );

  return {
    valido: true,
    codigo,
    descuento: Math.min(descuentoCalculado, totalOriginal),
    error: null,
  };
}

export async function POST(req: Request) {
  try {
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
        {
          error:
            "NEXT_PUBLIC_BASE_URL no puede ser localhost. Usá la URL pública de Vercel.",
        },
        { status: 500 }
      );
    }

    const body = await req.json();

    const {
      nombre,
      telefono,
      fecha,
      hora,
      simuladores,
      cantidad_turnos,
      total,
      acepto_condiciones,
      codigo_descuento,
    } = body;

    if (
      !nombre ||
      !telefono ||
      !fecha ||
      !hora ||
      !Array.isArray(simuladores) ||
      simuladores.length === 0 ||
      !cantidad_turnos ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Faltan datos para crear la preferencia" },
        { status: 400 }
      );
    }

    const totalOriginal = Math.round(Number(total));

    if (!Number.isFinite(totalOriginal) || totalOriginal <= 0) {
      return NextResponse.json(
        { error: "Total original inválido" },
        { status: 400 }
      );
    }

    let codigoAplicado = null;
    let descuentoAplicado = 0;

    if (codigo_descuento && String(codigo_descuento).trim()) {
      const resultadoCodigo = await validarCodigoDescuento(
        String(codigo_descuento),
        totalOriginal
      );

      if (!resultadoCodigo.valido) {
        return NextResponse.json(
          { error: resultadoCodigo.error || "Código inválido" },
          { status: 400 }
        );
      }

      codigoAplicado = resultadoCodigo.codigo;
      descuentoAplicado = Number(resultadoCodigo.descuento || 0);
    }

    const totalFinal = Math.round(Math.max(totalOriginal - descuentoAplicado, 0));

    if (!Number.isFinite(totalFinal) || totalFinal <= 0) {
      return NextResponse.json(
        {
          error:
            "El total final debe ser mayor a $0 para pagar con Mercado Pago.",
        },
        { status: 400 }
      );
    }

    const referencia = `reserva-${Date.now()}`;

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
  {
    id: `reserva-sim-${Date.now()}`,
    title: "Reserva SIM Argentina",
    quantity: 1,
    unit_price: totalFinal,
    currency_id: "ARS",
  },
],

        external_reference: JSON.stringify({
          referencia,
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos: simuladores.length,
          total: totalFinal,
          total_original: totalOriginal,
          descuento_aplicado: Math.round(descuentoAplicado),
          codigo_descuento: codigoAplicado?.codigo || null,
          codigo_descuento_id: codigoAplicado?.id || null,
          acepto_condiciones,
        }),

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
      total_original: totalOriginal,
      descuento_aplicado: Math.round(descuentoAplicado),
      total_final: totalFinal,
      codigo_descuento: codigoAplicado?.codigo || null,
    });
  } catch (error: any) {
    console.error("Error creando preferencia:", error);

    return NextResponse.json(
      {
        error: "No se pudo crear la preferencia",
        details:
          error?.message ||
          error?.cause ||
          JSON.stringify(error, null, 2),
      },
      { status: 500 }
    );
  }
}