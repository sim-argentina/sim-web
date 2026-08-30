import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { validarAnioMes } from "@/lib/cronograma";
import { getDatosPdf } from "@/lib/cronogramaServer";

// Datos del cronograma CONFIRMADO para generar el PDF (admin + staff). El servidor
// REVALIDA que el mes esté confirmado: si no lo está, 409 (no se confía en la UI).
// Solo jornadas manuales; sin cobertura de Ramiro, sin horas, sin auditoría.
export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const val = validarAnioMes(searchParams.get("anio"), searchParams.get("mes"));
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  try {
    const pdf = await getDatosPdf(val.anio, val.mes);
    if (!pdf) return NextResponse.json({ error: "El cronograma no está confirmado." }, { status: 409 });
    return NextResponse.json({ pdf });
  } catch (error) {
    return failResponse(500, "Error preparando el PDF", { logContext: "cronograma pdf-data GET", error });
  }
}
