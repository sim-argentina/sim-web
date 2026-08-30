import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { listarPlantillas, crearPlantilla } from "@/lib/cronogramaCopiaServer";

// Plantillas de cronograma (SOLO admin). GET lista; POST crea desde un origen
// (semana o mes) — el servidor LEE el cronograma fuente, no confía en JSONB del cliente.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await listarPlantillas());
  } catch (error) {
    return failResponse(500, "Error listando plantillas", { logContext: "plantillas GET", error });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-copia:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tipo = b.tipo === "mensual" ? "mensual" : b.tipo === "semanal" ? "semanal" : null;
  if (!tipo) return NextResponse.json({ error: "Tipo inválido (semanal|mensual)." }, { status: 400 });
  const nombre = String(b.nombre ?? "");
  const origen: { lunes?: string; anio?: number; mes?: number } = {};
  if (typeof b.lunes === "string") origen.lunes = b.lunes;
  if (b.anio !== undefined) origen.anio = Number(b.anio);
  if (b.mes !== undefined) origen.mes = Number(b.mes);

  const res = await crearPlantilla(tipo, nombre, origen);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ plantilla: res.data }, { status: 201 });
}
