import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { validarAnioMes } from "@/lib/cronograma";
import { getHorasMensuales } from "@/lib/cronogramaServer";

// Resumen de horas efectivas por integrante (SOLO admin). No se agrega al endpoint
// compartido que usa staff. Devuelve { horas: null } si el mes no existe/descartado.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const val = validarAnioMes(searchParams.get("anio"), searchParams.get("mes"));
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  try {
    const horas = await getHorasMensuales(val.anio, val.mes);
    return NextResponse.json({ horas });
  } catch (error) {
    return failResponse(500, "Error calculando las horas", { logContext: "cronograma horas GET", error });
  }
}
