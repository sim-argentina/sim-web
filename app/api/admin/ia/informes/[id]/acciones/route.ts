import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { descartarBorrador, enviarPapelera, restaurarInforme } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Acciones de ciclo de vida del informe: descartar | papelera | restaurar.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:informes:accion", 40, 60_000))) return tooManyResponse();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  let body: { accion?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const accion = String(body.accion || "");
  const fn = accion === "descartar" ? descartarBorrador : accion === "papelera" ? enviarPapelera : accion === "restaurar" ? restaurarInforme : null;
  if (!fn) return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  const r = await fn(id, IA_OWNER_ADMIN);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
