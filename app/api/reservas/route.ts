import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOccupiedSlots, precioPorSimulador } from "@/lib/reservasSlots";
import {
  validarCodigoDescuento,
  consumirCodigoDescuento,
} from "@/lib/codigosDescuento";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { validarReservaInput } from "@/lib/reservasValidation";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";

// GET: disponibilidad. Público requiere ?fecha (evita scraping del calendario
// completo) y recibe un DTO sin PII. El admin autenticado recibe datos completos.
export async function GET(req: Request) {
  if (!(await rateLimit(`resv-get:${clientIp(req)}`, 60, 60_000))) {
    return tooManyResponse();
  }
  try {
    const role = await getCurrentAdminRole();
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get("fecha");
    const estado = searchParams.get("estado");

    if (!role && !fecha) {
      return NextResponse.json({ error: "Especificá una fecha" }, { status: 400 });
    }
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }

    const cols = role
      ? "*"
      : "fecha, hora, simuladores, estado, duracion_minutos, cantidad_turnos";

    let query = supabaseAdmin
      .from("reservas")
      .select(cols)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (fecha) query = query.eq("fecha", fecha);
    if (estado) query = query.eq("estado", estado);

    const { data, error } = await query;
    if (error) {
      return failResponse(500, "Error al obtener reservas", {
        logContext: "reservas GET",
        error,
      });
    }
    return NextResponse.json(data ?? [], { status: 200 });
  } catch (error) {
    return failResponse(500, "Error al obtener reservas", {
      logContext: "reservas GET",
      error,
    });
  }
}

// POST: SOLO crea reservas 100% bonificadas (gratis). Con saldo > 0 se exige
// pago online. Precio recalculado server-side; turno reservado con garantía DB.
export async function POST(req: Request) {
  if (!(await rateLimit(`resv-post:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }

  let reservaCreadaId: number | null = null;
  try {
    const body = await req.json().catch(() => null);

    const v = validarReservaInput(body);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    const { nombre, telefono, fecha, hora, simuladores, duracion, codigo_descuento } =
      v.value;

    // ── Precio recalculado server-side (nunca se confía en el cliente) ──
    const precioUnitario = precioPorSimulador(fecha, duracion);
    const totalOriginal = precioUnitario * simuladores.length;

    let descuento = 0;
    let codigoValido: string | null = null;
    if (codigo_descuento) {
      const r = await validarCodigoDescuento(codigo_descuento, totalOriginal);
      if (!r.valido) {
        return NextResponse.json({ error: r.error || "Código inválido" }, { status: 400 });
      }
      descuento = Math.round(r.descuento || 0);
      codigoValido = r.codigo;
    }

    const totalFinal = Math.max(totalOriginal - descuento, 0);
    if (totalFinal > 0) {
      return NextResponse.json(
        { error: "Esta reserva requiere pago online con Mercado Pago." },
        { status: 400 }
      );
    }

    // 1) Crear la reserva activa.
    const { data, error } = await supabaseAdmin
      .from("reservas")
      .insert([
        {
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos: simuladores.length,
          total: 0,
          total_original: totalOriginal,
          descuento_aplicado: descuento,
          estado: "activa",
          acepto_condiciones: true,
          codigo_descuento: codigoValido,
          duracion_minutos: duracion,
        },
      ])
      .select()
      .single();

    if (error || !data) {
      return failResponse(500, "Error al guardar la reserva", {
        logContext: "reservas POST insert",
        error,
      });
    }
    reservaCreadaId = data.id;

    // 2) Reservar los slots (garantía DB anti doble-reserva).
    const slotRows = getOccupiedSlots(fecha, hora, duracion).flatMap((slot) =>
      simuladores.map((sim) => ({
        reserva_id: data.id,
        fecha,
        hora: slot,
        simulador: sim,
        estado: "activa",
      }))
    );
    const { error: slotErr } = await supabaseAdmin
      .from("reserva_slots")
      .insert(slotRows);
    if (slotErr) {
      await supabaseAdmin.from("reservas").delete().eq("id", data.id);
      reservaCreadaId = null;
      if ((slotErr as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Uno o más simuladores ya están reservados en ese horario" },
          { status: 409 }
        );
      }
      return failResponse(500, "Error al reservar el turno", {
        logContext: "reservas POST slots",
        error: slotErr,
      });
    }

    // 3) Consumir el código atómicamente. Si ya no está disponible, revertir.
    if (codigoValido) {
      const consumido = await consumirCodigoDescuento(codigoValido, {
        reserva_id: data.id,
        nombre: data.nombre,
        telefono: data.telefono,
        fecha_reserva: data.fecha,
        hora_reserva: data.hora,
        total_original: data.total_original,
        descuento_aplicado: data.descuento_aplicado,
        total_final: data.total,
      });
      if (!consumido) {
        await supabaseAdmin.from("reservas").delete().eq("id", data.id);
        reservaCreadaId = null;
        return NextResponse.json(
          { error: "El código de descuento ya no está disponible" },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (reservaCreadaId) {
      try {
        await supabaseAdmin.from("reservas").delete().eq("id", reservaCreadaId);
      } catch {
        /* best-effort */
      }
    }
    return failResponse(500, "Error interno del servidor", {
      logContext: "reservas POST",
      error,
    });
  }
}
