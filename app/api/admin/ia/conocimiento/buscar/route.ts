import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { buscarConocimiento } from "@/lib/ia/docs/conocimientoServer";

// Búsqueda manual del admin en el conocimiento (misma que usa la IA).
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const consulta = q.get("q") || "";
  const cat = q.get("categoria");
  const res = await buscarConocimiento({ consulta, categorias: cat ? [cat] : undefined, limite: 12 });
  return NextResponse.json({ resultados: res });
}
