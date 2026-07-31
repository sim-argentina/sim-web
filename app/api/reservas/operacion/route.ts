import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";

// Vista OPERATIVA de las reservas de un día para mostrarlas como filas dentro del
// Turnero. Es 100% de lectura sobre el dominio Reservas: nunca escribe en
// turnos_stand ni altera la reserva. Devuelve solo las reservas CONFIRMADAS
// (estado 'activa') de la fecha, con sus datos comerciales (solo lectura) y los
// datos operativos (hora_subida/hora_bajada/listo) que vive en reserva_operacion.
export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const fecha = searchParams.get("fecha");
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    // Reservas confirmadas del día (mismo criterio de validez que el resto del
    // sistema: estado 'activa'). Se excluyen canceladas / pendientes de pago.
    const { data: reservas, error } = await supabaseAdmin
      .from("reservas")
      .select(
        "id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, duracion_minutos, total, estado, mercado_pago_payment_id"
      )
      .eq("fecha", fecha)
      .eq("estado", "activa")
      .order("hora", { ascending: true });

    if (error) {
      return failResponse(500, "Error al obtener reservas del día", {
        logContext: "reservas/operacion GET",
        error,
      });
    }

    const lista = reservas ?? [];
    const ids = lista.map((r) => r.id);

    // Datos operativos (cargados desde el Turnero) de esas reservas.
    const opPorReserva: Record<number, { hora_subida: string | null; hora_bajada: string | null; listo: boolean }> = {};
    if (ids.length > 0) {
      const { data: ops } = await supabaseAdmin
        .from("reserva_operacion")
        .select("reserva_id, hora_subida, hora_bajada, listo")
        .in("reserva_id", ids);
      for (const op of ops ?? []) {
        opPorReserva[op.reserva_id as number] = {
          hora_subida: op.hora_subida ?? null,
          hora_bajada: op.hora_bajada ?? null,
          listo: Boolean(op.listo),
        };
      }
    }

    const salida = lista.map((r) => {
      const op = opPorReserva[r.id] ?? { hora_subida: null, hora_bajada: null, listo: false };
      return { ...r, hora_subida: op.hora_subida, hora_bajada: op.hora_bajada, listo: op.listo };
    });

    return NextResponse.json({ reservas: salida });
  } catch (error) {
    return failResponse(500, "Error al obtener reservas del día", {
      logContext: "reservas/operacion GET",
      error,
    });
  }
}
