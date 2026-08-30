import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { previsualizarCopiaSemana, aplicarCopiaSemana } from "@/lib/cronogramaCopiaServer";

// Copiar una semana (lunes→domingo). SOLO admin. accion: "preview" | "aplicar".
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-copia:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const b = (body ?? {}) as Record<string, unknown>;
  const lunesOrigen = String(b.lunesOrigen ?? "");
  const lunesDestino = String(b.lunesDestino ?? "");
  const accion = b.accion === "aplicar" ? "aplicar" : "preview";

  if (accion === "preview") {
    const res = await previsualizarCopiaSemana(lunesOrigen, lunesDestino);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ preview: res.data });
  }
  const decisiones = (b.decisiones && typeof b.decisiones === "object" ? b.decisiones : {}) as Record<string, "actual" | "propuesta">;
  const res = await aplicarCopiaSemana(lunesOrigen, lunesDestino, decisiones);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ aplicado: res.data });
}
