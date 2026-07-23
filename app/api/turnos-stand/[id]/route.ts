import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";

function limpiarPagosDetalle(pagos: any[]) {
  if (!Array.isArray(pagos)) return [];

  return pagos
    .map((pago) => ({
      metodo_pago: pago?.metodo_pago || "qr",
      monto: Number(pago?.monto) || 0,
      posnet_pago: pago?.posnet_pago || null,
    }))
    .filter((pago) => pago.monto > 0);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = await req.json();

    const pagosDetalle = limpiarPagosDetalle(body.pagos_detalle || []);
    const totalPagos = pagosDetalle.reduce((acc, pago) => acc + pago.monto, 0);
    const posnets = pagosDetalle
      .map((pago) => pago.posnet_pago)
      .filter(Boolean)
      .join(" + ");

    const metodoPago =
      pagosDetalle.length > 1
        ? "mixto"
        : pagosDetalle[0]?.metodo_pago || body.metodo_pago || "qr";

    const total = totalPagos > 0 ? totalPagos : Number(body.total) || 0;

    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .update({
        nombre: body.nombre,
        telefono: body.telefono,
        fecha: body.fecha,
        hora: body.hora,
        hora_estimada_subida: body.hora_estimada_subida || null,
        hora_subida: body.hora_subida || null,
        hora_bajada: body.hora_bajada || null,
        simuladores: body.simuladores || [],
        cantidad_simuladores: body.simuladores?.length || 0,
        cantidad_personas: Number(body.cantidad_personas) || 1,
        cantidad_minutos: Number(body.cantidad_minutos) || 15,
        cantidad_turnos: Number(body.cantidad_turnos) || 1,
        metodo_pago: metodoPago,
        turno_listo: Boolean(body.turno_listo),
        posnet_pago: posnets || body.posnet_pago || null,
        pagos_detalle: pagosDetalle,
        total,
        observaciones: body.observaciones,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-stand/[id]", error });
    }

    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json(
      { error: "Error actualizando turno" },
      { status: 500 },
    );
  }
}

// DELETE: eliminación física DEFINITIVA de un turno del Turnero SIM. SOLO admin.
// El turno no tiene registros hijos (los pagos viven en el JSON pagos_detalle de
// la propia fila), así que borrarlo no deja huérfanos ni rompe FKs. Las métricas
// y resúmenes leen la tabla en vivo, por lo que el turno deja de contar apenas se
// elimina. No se conserva historial del turno borrado (es hard delete).
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const turnoId = Number(id);
  if (!Number.isInteger(turnoId) || turnoId <= 0) {
    return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("turnos_stand")
    .delete()
    .eq("id", turnoId)
    .select("id")
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-stand/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  logSecurityEvent("turno_stand_eliminado", { id: turnoId, role: auth.role });
  return NextResponse.json({ ok: true });
}
