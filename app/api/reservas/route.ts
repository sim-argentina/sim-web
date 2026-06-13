import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOccupiedSlots, construirOcupacion } from "@/lib/reservasSlots";

type ReservaBody = {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  cantidad_turnos: number;
  total: number;
  acepto_condiciones: boolean;
  codigo_descuento?: string | null;
  duracion_minutos?: number;
};

async function consumirCodigoDescuento(codigo: string) {
  const codigoNormalizado = codigo.trim().toUpperCase();

  const { data: codigoActual, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("id, activo, usos_actuales, usos_maximos")
    .eq("codigo", codigoNormalizado)
    .maybeSingle();

  if (error || !codigoActual) {
    return { ok: false, error: "No se encontró el código de descuento" };
  }

  if (!codigoActual.activo) {
    return { ok: false, error: "El código ya no está activo" };
  }

  const usosActuales = Number(codigoActual.usos_actuales || 0);

  const usosMaximos =
    codigoActual.usos_maximos === null ||
    codigoActual.usos_maximos === undefined
      ? null
      : Number(codigoActual.usos_maximos);

  if (usosMaximos !== null && usosActuales >= usosMaximos) {
    await supabaseAdmin
      .from("codigos_descuento")
      .update({ activo: false })
      .eq("id", codigoActual.id);

    return { ok: false, error: "El código ya alcanzó el máximo de usos" };
  }

  const nuevosUsos = usosActuales + 1;
  const debeInactivar = usosMaximos !== null && nuevosUsos >= usosMaximos;

  const { error: updateError } = await supabaseAdmin
    .from("codigos_descuento")
    .update({
      usos_actuales: nuevosUsos,
      activo: debeInactivar ? false : true,
    })
    .eq("id", codigoActual.id);

  if (updateError) {
    return { ok: false, error: "No se pudo actualizar el uso del código" };
  }

  return { ok: true, error: null };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const fecha = searchParams.get("fecha");
    const estado = searchParams.get("estado");

    let query = supabaseAdmin
      .from("reservas")
      .select("*")
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (fecha) query = query.eq("fecha", fecha);
    if (estado) query = query.eq("estado", estado);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          error: "Error al obtener reservas",
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? [], { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error al obtener reservas",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: ReservaBody = await req.json();

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
      duracion_minutos,
    } = body;

    if (
      !nombre ||
      !telefono ||
      !fecha ||
      !hora ||
      !Array.isArray(simuladores) ||
      simuladores.length === 0 ||
      !cantidad_turnos ||
      total === undefined ||
      total === null ||
      Number(total) < 0 ||
      acepto_condiciones !== true
    ) {
      return NextResponse.json(
        {
          error: "Faltan campos obligatorios o no se aceptaron las condiciones",
        },
        { status: 400 }
      );
    }

    const duracion = Number(duracion_minutos) === 30 ? 30 : 15;
    const reqSlots = getOccupiedSlots(fecha, hora, duracion);

    if (duracion === 30 && reqSlots.length < 2) {
      return NextResponse.json(
        {
          error:
            "No hay un turno consecutivo disponible para reservar 30 minutos en ese horario.",
        },
        { status: 409 }
      );
    }

    const { data: existentes, error: checkError } = await supabaseAdmin
      .from("reservas")
      .select("id, hora, duracion_minutos, simuladores")
      .eq("fecha", fecha)
      .eq("estado", "activa");

    if (checkError) {
      return NextResponse.json(
        {
          error: "Error al validar disponibilidad",
          details: checkError.message,
        },
        { status: 500 }
      );
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

    if (Number(total) === 0 && codigo_descuento) {
      const consumo = await consumirCodigoDescuento(codigo_descuento);

      if (!consumo.ok) {
        return NextResponse.json(
          { error: consumo.error },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("reservas")
      .insert([
        {
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos,
          total,
          estado: "activa",
          acepto_condiciones,
          codigo_descuento: codigo_descuento ?? null,
          duracion_minutos: duracion,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: "Error al guardar la reserva",
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}