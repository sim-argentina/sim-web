import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { hayCupo, permitePagoStand } from "@/lib/campeonatosConfig";
import { campoVisible } from "@/lib/campeonatosInscripcionConfig";
import {
  validarInscripcionPublica, montoDelCampeonato, crearCheckoutYPreferencia,
  cupoOcupados, type CampeonatoCheckoutRow,
} from "@/lib/campeonatosCheckout";

// Alta pública de inscripción a un campeonato.
//
// CAMBIO CENTRAL: con pago ONLINE, este endpoint ya NO inserta en
// campeonato_inscripciones. Valida, reserva cupo en un INTENTO de checkout y
// devuelve el init_point de Mercado Pago. La inscripción deportiva nace recién
// cuando el pago queda aprobado, en el webhook (lib/campeonatosPago.ts).
// Quien abandona el pago no deja ninguna inscripción fantasma.
//
// El pago en el STAND (solo si el campeonato lo habilita) sigue creando la
// inscripción en el momento: ahí no hay pago online que esperar.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit(`pref-camp:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  try {
    const body = await req.json().catch(() => ({}));
    const campeonatoId = String((body as Record<string, unknown>)?.campeonato_id ?? "").trim();
    if (!campeonatoId) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    // Un campeonato archivado (deleted_at) no acepta nuevas inscripciones.
    const { data: campeonato } = await supabaseAdmin
      .from("campeonatos")
      .select("id, nombre, inscripcion_habilitada, cupos_maximos, precio_inscripcion, modalidad, permite_pago_stand, config")
      .eq("id", campeonatoId)
      .is("deleted_at", null)
      .single();

    if (!campeonato) {
      return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });
    }
    const camp = campeonato as CampeonatoCheckoutRow;
    if (!camp.inscripcion_habilitada) {
      return NextResponse.json(
        { error: "La inscripción no está habilitada para este campeonato" },
        { status: 400 }
      );
    }

    // Validación configurable (misma fuente que el admin y el formulario público).
    const v = validarInscripcionPublica(body, camp);
    if (!v.ok) {
      return NextResponse.json({ error: v.error, campo: v.campo }, { status: v.status });
    }
    const { datos, campos } = v.data;

    // Precio SIEMPRE del servidor: el monto que mande el navegador se ignora.
    const monto = montoDelCampeonato(camp);
    if (monto === null) {
      return NextResponse.json(
        { error: "El precio de inscripción no está configurado" },
        { status: 400 }
      );
    }

    // ── Pago en el stand: se registra la inscripción ahora (no hay MP) ────────
    if (datos.metodoStand) {
      const ocupados = await cupoOcupados(camp.id);
      if (!hayCupo(camp.cupos_maximos, ocupados)) {
        return NextResponse.json(
          { error: "No quedan cupos disponibles para este campeonato" },
          { status: 409 }
        );
      }

      const nombreCompleto = `${datos.nombre} ${datos.apellido}`.trim();
      const { data: inscripcion, error: insertError } = await supabaseAdmin
        .from("campeonato_inscripciones")
        .insert([
          {
            campeonato_id: camp.id,
            nombre: datos.nombre,
            apellido: datos.apellido,
            nombre_completo: nombreCompleto,
            // Columnas NOT NULL: si el campo se oculta por config, se guarda "".
            telefono: datos.telefono,
            dni: datos.dni,
            instagram: datos.instagram,
            escuderia_favorita: datos.escuderia_favorita,
            categoria: null, // asignada por el staff
            monto,
            estado_pago: "pendiente_pago_stand",
            metodo_pago: "stand",
          },
        ])
        .select("id")
        .single();

      if (insertError || !inscripcion) {
        return failResponse(500, "Error creando la inscripción", {
          logContext: "pref-camp insert stand",
          error: insertError,
        });
      }

      return NextResponse.json({
        metodo: "stand",
        inscripcion_id: inscripcion.id,
        inscripcion: {
          id: inscripcion.id,
          nombre: datos.nombre,
          apellido: datos.apellido,
          telefono: campoVisible(campos, "telefono") ? datos.telefono : "",
          dni: campoVisible(campos, "dni") ? datos.dni : "",
          escuderia_favorita: datos.escuderia_favorita ?? "",
          campeonato: camp.nombre,
        },
      });
    }

    // ── Pago online: intento de checkout + Mercado Pago, SIN inscripción ──────
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
      return failResponse(500, "Servicio de pago no disponible", { logContext: "pref-camp config" });
    }

    const creado = await crearCheckoutYPreferencia(camp, datos, monto, baseUrl);
    if (!creado.ok) {
      return NextResponse.json({ error: creado.error }, { status: creado.status });
    }

    return NextResponse.json({
      metodo: "mercadopago",
      init_point: creado.data.init_point,
      checkout_token: creado.data.token_publico,
      monto: creado.data.monto,
      expira_el: creado.data.expira_el,
      permite_pago_stand: permitePagoStand(camp),
    });
  } catch (error: unknown) {
    return failResponse(500, "No se pudo procesar la inscripción", {
      logContext: "pref-camp",
      error,
    });
  }
}
