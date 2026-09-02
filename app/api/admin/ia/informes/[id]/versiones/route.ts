import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { listarVersiones } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const r = await listarVersiones(id, IA_OWNER_ADMIN);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
