import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { listarCategorias, crearCategoria } from "@/lib/ia/docs/conocimientoServer";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ categorias: await listarCategorias() });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const nombre = typeof b.nombre === "string" ? b.nombre : "";
  const r = await crearCategoria(nombre);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ categoria: r.categoria }, { status: 201 });
}
