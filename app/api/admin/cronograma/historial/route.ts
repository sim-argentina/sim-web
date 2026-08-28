import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { validarAnioMes, fechaEnMes } from "@/lib/cronograma";
import { getHistorial } from "@/lib/cronogramaServer";

// Historial detallado del cronograma (append-only). SOLO admin.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const val = validarAnioMes(searchParams.get("anio"), searchParams.get("mes"));
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const fechaParam = searchParams.get("fecha");
  const fecha = fechaParam && fechaEnMes(fechaParam, val.anio, val.mes) ? fechaParam : undefined;

  try {
    const eventos = await getHistorial(val.anio, val.mes, fecha);
    return NextResponse.json({ eventos });
  } catch (error) {
    return failResponse(500, "Error cargando el historial", { logContext: "cronograma historial GET", error });
  }
}
