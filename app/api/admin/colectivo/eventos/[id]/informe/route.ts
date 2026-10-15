import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { cargarInformeEvento } from "@/lib/colectivoInforme";

// Informe del evento del Colectivo (admin y staff, igual que la caja). Solo
// lectura: se arma en el momento desde los turnos, las ventas y los movimientos
// de caja del evento, con las mismas reglas que la caja. No guarda copias. El
// PDF (/informe/pdf) usa exactamente los mismos datos (cargarInformeEvento).
// El informe del Colectivo es interno y no forma parte de Finanzas SIM: no lee
// ni escribe nada de fin_*.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const r = await cargarInformeEvento(id);
  if (!r.ok) {
    if (r.status === 500) return failResponse(500, r.error, { logContext: "colectivo/informe GET", error: r.detalle });
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json(r.valor);
}
