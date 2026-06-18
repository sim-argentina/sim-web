import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getOccupiedSlots,
  construirOcupacion,
  precioPorSimulador,
} from "@/lib/reservasSlots";
import { validarCodigoDescuento, consumirCodigoDescuento } from "@/lib/codigosDescuento";
import { getCurrentAdminRole } from "@/lib/adminGuards";

type ReservaBody = {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  acepto_condiciones: boolean;
  codigo_descuento?: string | null;
  duracion_minutos?: number;
};

// GET público: para la grilla de disponibilidad NO se devuelve PII
// (nombre/teléfono). El admin autenticado recibe los datos completos.
export async function GET(req: Request) {
  try {
    const role = await getCurrentAdminRole();
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get("fecha");
    const estado = searchParams.get("estado");

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
      return NextResponse.json({ error: "Error al obtener reservas" }, { status: 500 });
    }

    return NextResponse.json(data ?? [], { status: 200 });
  } catch {
    return NextResponse.json({ error: "Error al obtener reservas" }, { status: 500 });
  }
}

// POST: SOLO crea reservas 100% bonificadas (gratis). Con saldo > 0 se exige
// pago online (preferencia MP). El precio se recalcula siempre en el server.
export async function POST(req: Request) {
  try {
    const body: ReservaBody = await req.json();

    const {
      nombre,
      telefono,
      fecha,
      hora,
      simuladores,
      acepto_condiciones,
      codigo_descuento,
      duracion_minutos,
    } = body;

    if (
      !nombre?.trim() ||
      !telefono?.trim() ||
      !fecha ||
      !hora ||
      !Array.isArray(simuladores) ||
      simuladores.length === 0 ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios o no se aceptaron las condiciones" },
        { status: 400 }
      );
    }

    const duracion = Number(duracion_minutos) === 30 ? 30 : 15;
    const reqSlots = getOccupiedSlots(fecha, hora, duracion);

    if (duracion === 30 && reqSlots.length < 2) {
      return NextResponse.json(
        { error: "No hay un turno consecutivo disponible para reservar 30 minutos en ese horario." },
        { status: 409 }
      );
    }

    const { data: existentes, error: checkError } = await supabaseAdmin
      .from("reservas")
      .select("id, hora, duracion_minutos, simuladores")
      .eq("fecha", fecha)
      .eq("estado", "activa");

    if (checkError) {
      return NextResponse.json({ error: "Error al validar disponibilidad" }, { status: 500 });
    }

    const ocupacion = construirOcupacion(fecha, existentes || []);
    const conflicto = reqSlots.some((slot) =>
      simuladores.some((sim) => ocupacion[slot]?.has(sim))
    );

    if (conflicto) {
      return NextResponse.json(
        {
          error:
            duracion === 30
              ? "Uno o más simuladores no tienen los dos turnos consecutivos libres."
              : "Uno o más simuladores ya están reservados en ese horario",
        },
        { status: 409 }
      );
    }

    // ── Precio recalculado server-side (nunca se confía en el cliente) ──
    const precioUnitario = precioPorSimulador(fecha, duracion);
    const totalOriginal = precioUnitario * simuladores.length;

    let descuento = 0;
    let codigoValido: string | null = null;
    if (codigo_descuento && String(codigo_descuento).trim()) {
      const r = await validarCodigoDescuento(String(codigo_descuento), totalOriginal);
      if (!r.valido) {
        return NextResponse.json({ error: r.error || "Código inválido" }, { status: 400 });
      }
      descuento = Math.round(r.descuento || 0);
      codigoValido = r.codigo;
    }

    const totalFinal = Math.max(totalOriginal - descuento, 0);

    // Esta ruta es exclusiva para reservas gratuitas (100% bonificadas).
    if (totalFinal > 0) {
      return NextResponse.json(
        { error: "Esta reserva requiere pago online con Mercado Pago." },
        { status: 400 }
      );
    }

    if (codigoValido) {
      await consumirCodigoDescuento(codigoValido);
    }

    const { data, error } = await supabaseAdmin
      .from("reservas")
      .insert([
        {
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          fecha,
          hora,
          simuladores,
          cantidad_turnos: simuladores.length,
          total: 0,
          total_original: totalOriginal,
          descuento_aplicado: descuento,
          estado: "activa",
          acepto_condiciones,
          codigo_descuento: codigoValido,
          duracion_minutos: duracion,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Error al guardar la reserva" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
