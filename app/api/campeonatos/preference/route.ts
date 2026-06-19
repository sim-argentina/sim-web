import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

export async function POST(req: Request) {
  if (!(await rateLimit(`pref-camp:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }

  let inscripcionId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const nombre = String(body?.nombre ?? "").trim();
    const apellido = String(body?.apellido ?? "").trim();
    const telefono = String(body?.telefono ?? "").trim();
    const dni = String(body?.dni ?? "").trim();
    const instagram = body?.instagram
      ? String(body.instagram).trim().slice(0, 60)
      : null;
    const escuderia_favorita = body?.escuderia_favorita
      ? String(body.escuderia_favorita).trim().slice(0, 60)
      : "";
    const campeonato_id = body?.campeonato_id;
    const acepto_condiciones = body?.acepto_condiciones;
    const metodo_pago_inscripcion = body?.metodo_pago_inscripcion; // "mercadopago" | "stand"

    if (
      !nombre ||
      nombre.length > 60 ||
      !apellido ||
      apellido.length > 60 ||
      !escuderia_favorita ||
      !campeonato_id ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Faltan datos obligatorios" },
        { status: 400 }
      );
    }
    if (!/^[0-9+()\s-]{6,30}$/.test(telefono)) {
      return NextResponse.json({ error: "Teléfono inválido" }, { status: 400 });
    }
    if (!/^[0-9.\s-]{6,15}$/.test(dni)) {
      return NextResponse.json({ error: "DNI inválido" }, { status: 400 });
    }

    // Verificar campeonato y usar SU precio (nunca el monto enviado por el cliente)
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

    // Control de cupos: pagadas + pendientes recientes (TTL 30m) no superan
    // cupos_maximos. Las pendientes viejas (abandonadas) no bloquean.
    if (campeonato.cupos_maximos != null) {
      const cupoTtlIso = new Date(Date.now() - 30 * 60_000).toISOString();
      const [pagadas, pendientes] = await Promise.all([
        supabaseAdmin
          .from("campeonato_inscripciones")
          .select("id", { count: "exact", head: true })
          .eq("campeonato_id", campeonato_id)
          .eq("estado_pago", "pagado"),
        supabaseAdmin
          .from("campeonato_inscripciones")
          .select("id", { count: "exact", head: true })
          .eq("campeonato_id", campeonato_id)
          .in("estado_pago", [
            "pendiente_pago",
            "pendiente_pago_online",
            "pendiente_pago_stand",
          ])
          .gte("created_at", cupoTtlIso),
      ]);
      const ocupados = (pagadas.count ?? 0) + (pendientes.count ?? 0);
      if (ocupados >= Number(campeonato.cupos_maximos)) {
        return NextResponse.json(
          { error: "No quedan cupos disponibles para este campeonato" },
          { status: 409 }
        );
      }
    }

    const montoFinal = Math.round(Number(campeonato.precio_inscripcion));
    if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
      return NextResponse.json(
        { error: "El precio de inscripción no está configurado" },
        { status: 400 }
      );
    }

    const nombre_completo = `${nombre.trim()} ${apellido.trim()}`.trim();
    const esPagoStand = metodo_pago_inscripcion === "stand";

    // Crear inscripción
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
          categoria: null, // asignada por el staff
          monto: montoFinal,
          estado_pago: esPagoStand ? "pendiente_pago_stand" : "pendiente_pago_online",
          metodo_pago: esPagoStand ? "stand" : "mercadopago",
        },
      ])
      .select("id")
      .single();

    if (insertError || !inscripcion) {
      return failResponse(500, "Error creando la inscripción", {
        logContext: "pref-camp insert",
        error: insertError,
      });
    }

    inscripcionId = inscripcion.id;

    // Datos de la inscripción para la pantalla de confirmación
    const inscripcionData = {
      id: inscripcion.id,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      telefono: telefono.trim(),
      dni: dni.trim(),
      escuderia_favorita,
      campeonato: campeonato.nombre,
    };

    // ── Flujo Stand: no genera preferencia MP ───────────────────────────────
    if (esPagoStand) {
      return NextResponse.json({
        metodo: "stand",
        inscripcion_id: inscripcion.id,
        inscripcion: inscripcionData,
      });
    }

    // ── Flujo Mercado Pago ───────────────────────────────────────────────────
    if (!accessToken || !baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
      return failResponse(500, "Servicio de pago no disponible", {
        logContext: "pref-camp config",
      });
    }

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
      metodo: "mercadopago",
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      inscripcion_id: inscripcion.id,
      inscripcion: inscripcionData,
    });
  } catch (error: unknown) {
    if (inscripcionId) {
      await supabaseAdmin
        .from("campeonato_inscripciones")
        .update({ estado_pago: "cancelado" })
        .eq("id", inscripcionId);
    }
    return failResponse(500, "No se pudo procesar la inscripción", {
      logContext: "pref-camp",
      error,
    });
  }
}
