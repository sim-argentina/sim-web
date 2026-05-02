import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({
  accessToken: accessToken!,
});

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export async function POST(req: Request) {
  try {
    if (!accessToken) {
      return NextResponse.json(
        { error: "Falta MERCADOPAGO_ACCESS_TOKEN en .env.local" },
        { status: 500 }
      );
    }

    if (!baseUrl) {
      return NextResponse.json(
        { error: "Falta NEXT_PUBLIC_BASE_URL en .env.local" },
        { status: 500 }
      );
    }

    if (isInvalidBaseUrl(baseUrl)) {
      return NextResponse.json(
        {
          error:
            "NEXT_PUBLIC_BASE_URL no puede ser localhost. Usá una URL pública como Vercel.",
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
    } = body;

    if (
      !nombre ||
      !telefono ||
      !fecha ||
      !hora ||
      !Array.isArray(simuladores) ||
      simuladores.length === 0 ||
      !cantidad_turnos ||
      !total
    ) {
      return NextResponse.json(
        { error: "Faltan datos para crear la preferencia" },
        { status: 400 }
      );
    }

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            id: `reserva-${fecha}-${hora}`,
            title: `Reserva SIM - ${fecha} ${hora}`,
            description: `Reserva para ${nombre} | Simuladores: ${simuladores.join(
              ", "
            )}`,
            quantity: 1,
            unit_price: Number(total),
            currency_id: "ARS",
          },
        ],

        payer: {
          name: nombre,
          phone: {
            number: telefono,
          },
        },

        external_reference: JSON.stringify({
  nombre,
  telefono,
  fecha,
  hora,
  simuladores,
  cantidad_turnos,
  total,
  acepto_condiciones,
}),

        back_urls: {
          success: `${baseUrl}/reservas/exito`,
          failure: `${baseUrl}/reservas/error`,
          pending: `${baseUrl}/reservas/pendiente`,
        },

        auto_return: "approved",

        notification_url: `${baseUrl}/api/mercadopago/webhook`,

        payment_methods: {
          excluded_payment_types: [
            { id: "ticket" },
            { id: "atm" },
          ],
        },
      },
    });

    return NextResponse.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error) {
    console.error("Error creando preferencia:", error);

    return NextResponse.json(
      { error: "No se pudo crear la preferencia" },
      { status: 500 }
    );
  }
}