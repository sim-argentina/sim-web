import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { registrarReembolso, getReembolsoDeReserva } from "@/lib/reservasReembolsos";
import { registrarFinLog } from "@/lib/finanzas";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/reservas/[id]/reembolso — registra un reembolso COMPLETO ya
// realizado por fuera de SIM (Mercado Pago). SIM NO ejecuta el reembolso en MP.
// Admin-only (401 sin sesión, 403 staff). Payload permitido y NADA más:
//   { fecha_reembolso: 'YYYY-MM-DD', motivo?: string, confirmacion: true }
// Anti mass-assignment: monto/estado/actor/timestamps/IDs internos/campos MP se
// IGNORAN. El monto lo determina SIEMPRE el servidor (la RPC).
export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reservaId = Number(id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return NextResponse.json({ error: "ID de reserva inválido" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Confirmación obligatoria: sin esto no se guarda.
  if (body?.confirmacion !== true) {
    return NextResponse.json(
      { error: "Confirmá que el importe total ya fue devuelto por fuera de SIM." },
      { status: 400 }
    );
  }

  const fecha = typeof body?.fecha_reembolso === "string" ? body.fecha_reembolso : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha del reembolso inválida" }, { status: 400 });
  }

  const motivoRaw = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  const motivo = motivoRaw.length > 0 ? motivoRaw.slice(0, 500) : null;

  const res = await registrarReembolso(reservaId, fecha, motivo);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  await registrarFinLog(
    "reserva_reembolso_registrado",
    "reserva",
    String(reservaId),
    { monto: res.data.monto_reembolsado, fecha_reembolso: res.data.fecha_reembolso, motivo },
    auth.role
  );

  return NextResponse.json(res.data, { status: 201 });
}

// GET: detalle del reembolso de una reserva (admin-only, para auditoría/UI).
export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reservaId = Number(id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return NextResponse.json({ error: "ID de reserva inválido" }, { status: 400 });
  }
  const ref = await getReembolsoDeReserva(reservaId);
  return NextResponse.json(ref, { status: 200 });
}
