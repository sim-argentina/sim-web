import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { urlDescarga } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Descarga: valida propiedad + conversación y devuelve una URL FIRMADA corta.
export async function GET(_req: Request, ctx: { params: Promise<{ archivoId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:informes:descarga", 60, 60_000))) return tooManyResponse();
  const { archivoId } = await ctx.params;
  if (!UUID_RE.test(archivoId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const r = await urlDescarga(archivoId, IA_OWNER_ADMIN);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ url: r.url, nombre: r.nombre }, { headers: { "Cache-Control": "no-store" } });
}
