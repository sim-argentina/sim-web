import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { completarBorrador } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Completar el borrador determinísticamente desde el snapshot (NO consume IA).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:informes:completar", 20, 60_000))) return tooManyResponse();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const r = await completarBorrador(id, IA_OWNER_ADMIN);
  if (!r.ok) return NextResponse.json({ error: r.error, detalle: r.detalle }, { status: r.status });
  return NextResponse.json({ ok: true, version: r.version, agregados: r.agregados }, { headers: { "Cache-Control": "no-store" } });
}
