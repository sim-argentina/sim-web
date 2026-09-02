import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { confirmarYGenerar } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Confirmar y generar los formatos elegidos (idempotente, con lock de concurrencia).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:informes:confirmar", 12, 60_000))) return tooManyResponse();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  let body: { formatos?: unknown; idempotency_key?: unknown; confirmar_pii?: unknown; confirmar_manuales?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const formatos = Array.isArray(body.formatos) ? body.formatos.map(String) : [];
  const r = await confirmarYGenerar({
    informeId: id, owner: IA_OWNER_ADMIN, formatos,
    idempotencyKey: body.idempotency_key ? String(body.idempotency_key) : null,
    confirmarPii: body.confirmar_pii === true, confirmarManuales: body.confirmar_manuales === true,
  });
  if (!r.ok) return NextResponse.json({ error: r.error, detalle: r.detalle }, { status: r.status });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
