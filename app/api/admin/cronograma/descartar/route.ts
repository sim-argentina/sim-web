import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { validarAnioMes } from "@/lib/cronograma";
import { descartarBorrador } from "@/lib/cronogramaServer";

// Descartar un borrador → "Sin cronograma" (solo admin). Desactiva días/jornadas
// y descarta importaciones pendientes vinculadas. Atómico + historial
// (borrador_descartado). No permite descartar un mes confirmado directamente.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-write:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const val = validarAnioMes((body as { anio?: unknown }).anio, (body as { mes?: unknown }).mes);
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const res = await descartarBorrador(val.anio, val.mes);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ mes: res.data });
}
