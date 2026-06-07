import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

export async function POST(req: Request) {
  let inscripcionId: string | null = null;

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
    if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_BASE_URL no puede ser localhost para pagos" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const {
      nombre,
      apellido,
      telefono,
      dni,
      instagram,
      escuderia_favorita,
      categoria,
      campeonato_id,
      monto,
      acepto_condiciones,
    } = body;

    if (
      !nombre?.trim() ||
      !apellido?.trim() ||
      !telefono?.trim() ||
      !dni?.trim() ||
      !escuderia_favorita ||
      !categoria ||
      !campeonato_id ||
      !monto ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Faltan datos obligatorios" },
        { status: 400 }
      );
    }

    const montoFinal = Math.round(Number(monto));
    if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
      return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    }

    // Verificar campeonato
    const { data: campeonato } = await supabaseAdmin
      .from("campeonatos")
      .select("id, nombre, inscripcion_habilitada, cupos_maximos, precio_inscripcion")
      .eq("id", campeonato_id)
      .single();

    if (!campeonato) {
      return NextResponse.json(
        { error: "Campeonato no encontrado" },
        { status: 404 }
      );
    }
    if (!campeonato.inscripcion_habilitada) {
      return NextResponse.json(
        { error: "La inscripción no está habilitada para este campeonato" },
        { status: 400 }
      );
    }


    const nombre_completo = `${nombre.trim()} ${apellido.trim()}`.trim();

    // Crear inscripción pendiente
    const { data: inscripcion, error: insertError } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .insert([
        {
          campeonato_id,
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          nombre_completo,
          telefono: telefono.trim(),
          dni: dni.trim(),
          instagram: instagram?.trim() || null,
          escuderia_favorita,
          categoria,
          monto: montoFinal,
          estado_pago: "pendiente_pago",
        },
      ])
      .select("id")
      .single();

    if (insertError || !inscripcion) {
      return NextResponse.json(
        { error: insertError?.message || "Error creando inscripción" },
        { status: 500 }
      );
    }

    inscripcionId = inscripcion.id;

    // Crear preferencia MP
    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: `inscripcion-camp-${inscripcion.id}`,
            title: `Inscripción Campeonato SIM - ${campeonato.nombre}`,
            quantity: 1,
            unit_price: montoFinal,
            currency_id: "ARS",
          },
        ],
        // Prefijo distintivo para separar de reservas (external_reference de reservas es solo el ID numérico)
        external_reference: `campeonato_inscripcion_${inscripcion.id}`,
        back_urls: {
          success: `${baseUrl}/campeonatos/exito`,
          failure: `${baseUrl}/campeonatos/error`,
          pending: `${baseUrl}/campeonatos/pendiente`,
        },
        notification_url: `${baseUrl}/api/campeonatos/webhook`,
      },
    });

    // Guardar preference_id
    await supabaseAdmin
      .from("campeonato_inscripciones")
      .update({ preference_id: result.id || null })
      .eq("id", inscripcion.id);

    return NextResponse.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      inscripcion_id: inscripcion.id,
    });
  } catch (error: unknown) {
    // Si falla MP, marcar inscripción como cancelada
    if (inscripcionId) {
      await supabaseAdmin
        .from("campeonato_inscripciones")
        .update({ estado_pago: "cancelado" })
        .eq("id", inscripcionId);
    }
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "No se pudo crear la preferencia de pago", details: msg },
      { status: 500 }
    );
  }
}
