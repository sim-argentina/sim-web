export async function POST(req: Request) {
  try {
    const body = await req.json();

    const nombre = String(body?.nombre ?? "").trim();
    const telefono = String(body?.telefono ?? "").trim();
    const fecha = String(body?.fecha ?? "").trim();
    const hora = String(body?.hora ?? "").trim();

    const simuladores = Array.isArray(body?.simuladores)
      ? body.simuladores.map((sim: unknown) => String(sim))
      : [];

    const cantidad_turnos = Number(body?.cantidad_turnos ?? 1);
    const total = Number(body?.total ?? 0);

    if (!nombre || !telefono || !fecha || !hora || simuladores.length === 0 || total <= 0) {
      return Response.json(
        { ok: false, error: "Faltan datos obligatorios para generar el pago" },
        { status: 400 }
      );
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return Response.json(
        { ok: false, error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN" },
        { status: 500 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const externalReference = `${fecha}|${hora}|${telefono}|${Date.now()}`;

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        items: [
          {
            title: `Reserva SIM Argentina - ${simuladores.join(", ")}`,
            quantity: 1,
            unit_price: total,
            currency_id: "ARS",
          },
        ],
        payer: {
          name: nombre,
          phone: {
            number: telefono,
          },
        },
        external_reference: externalReference,
        back_urls: {
          success: `${baseUrl}/reservas/exito`,
          failure: `${baseUrl}/reservas/error`,
          pending: `${baseUrl}/reservas/pendiente`,
        },
        auto_return: "approved",
        metadata: {
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos,
          total,
        },
      }),
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Error Mercado Pago:", mpData);
      return Response.json(
        {
          ok: false,
          error: mpData?.message || "No se pudo generar la preferencia de pago",
          details: mpData,
        },
        { status: 500 }
      );
    }

    return Response.json(
      {
        ok: true,
        init_point: mpData.init_point,
        sandbox_init_point: mpData.sandbox_init_point,
        preference_id: mpData.id,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error en POST /api/mercadopago/preference:", error);
    return Response.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}