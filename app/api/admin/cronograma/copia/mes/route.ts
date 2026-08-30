import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { validarAnioMes } from "@/lib/cronograma";
import { previsualizarCopiaMes, aplicarCopiaMes } from "@/lib/cronogramaCopiaServer";

// Copiar un mes (por día de semana + aparición). SOLO admin. accion: preview|aplicar.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-copia:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const o = validarAnioMes(b.anioOrigen, b.mesOrigen);
  const d = validarAnioMes(b.anioDestino, b.mesDestino);
  if (!o.ok) return NextResponse.json({ error: "Origen inválido." }, { status: 400 });
  if (!d.ok) return NextResponse.json({ error: "Destino inválido." }, { status: 400 });
  const accion = b.accion === "aplicar" ? "aplicar" : "preview";

  if (accion === "preview") {
    const res = await previsualizarCopiaMes(o.anio, o.mes, d.anio, d.mes);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ preview: res.data });
  }
  const decisiones = (b.decisiones && typeof b.decisiones === "object" ? b.decisiones : {}) as Record<string, "actual" | "propuesta">;
  const res = await aplicarCopiaMes(o.anio, o.mes, d.anio, d.mes, decisiones);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ aplicado: res.data });
}
