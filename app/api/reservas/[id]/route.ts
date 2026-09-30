import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { cambiarEstadoReserva } from "@/lib/reservasEstado";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ESTADOS_PERMITIDOS = new Set(["activa", "cancelada"]);

// Cancelar o reactivar una reserva desde la administración.
//
// (B3) Reactivar ya no marca 'activa' primero: verifica disponibilidad con el
// motor por intervalos, crea TODOS los slots de SU modalidad guardada en una
// sola sentencia y recién entonces cambia el estado. Si algo falla, la reserva
// conserva su estado y no quedan slots parciales (ver lib/reservasEstado.ts).
export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const reservaId = Number(id);

    if (!id || !Number.isSafeInteger(reservaId) || reservaId <= 0) {
      return NextResponse.json({ error: "ID de reserva inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const nuevoEstado = body?.estado ?? "cancelada";

    if (!ESTADOS_PERMITIDOS.has(nuevoEstado)) {
      return NextResponse.json({ error: "Estado no permitido" }, { status: 400 });
    }

    const r = await cambiarEstadoReserva(reservaId, nuevoEstado);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, ...(r.motivo ? { motivo: r.motivo } : {}) },
        { status: r.status },
      );
    }
    return NextResponse.json(r.data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
