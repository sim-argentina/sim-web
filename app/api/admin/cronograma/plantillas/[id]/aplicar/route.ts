import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/security";
import { previsualizarPlantilla, aplicarPlantilla } from "@/lib/cronogramaCopiaServer";

type Ctx = { params: Promise<{ id: string }> };

// Previsualizar / aplicar una plantilla a un destino (SOLO admin). El servidor lee
// el snapshot persistido; el cliente solo envía destino, decisiones y reemplazos.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-copia:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const destino: { lunes?: string; anio?: number; mes?: number } = {};
  if (typeof b.lunes === "string") destino.lunes = b.lunes;
  if (b.anio !== undefined) destino.anio = Number(b.anio);
  if (b.mes !== undefined) destino.mes = Number(b.mes);
  const accion = b.accion === "aplicar" ? "aplicar" : "preview";

  if (accion === "preview") {
    const res = await previsualizarPlantilla(id, destino);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ preview: res.data });
  }
  const decisiones = (b.decisiones && typeof b.decisiones === "object" ? b.decisiones : {}) as Record<string, "actual" | "propuesta">;
  const reemplazos = (b.reemplazos && typeof b.reemplazos === "object" ? b.reemplazos : {}) as Record<string, string>;
  const res = await aplicarPlantilla(id, destino, decisiones, reemplazos);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ aplicado: res.data });
}
