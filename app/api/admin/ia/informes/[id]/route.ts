import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { obtenerPreview, editarBorrador, actualizarFormatos } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// Vista previa del borrador (spec + reconciliación + archivos).
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const r = await obtenerPreview(id, IA_OWNER_ADMIN);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}

// Editar el borrador (persistente + auditado). Recibe el spec completo editado.
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:informes:editar", 40, 60_000))) return tooManyResponse();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  let body: { spec?: unknown; formatos?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  // Solo actualizar formatos seleccionados (sin editar el spec).
  if (body.spec === undefined && Array.isArray(body.formatos)) {
    const fr = await actualizarFormatos(id, IA_OWNER_ADMIN, body.formatos.map(String));
    if (!fr.ok) return NextResponse.json({ error: fr.error }, { status: fr.status });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const r = await editarBorrador(id, IA_OWNER_ADMIN, body.spec);
  if (!r.ok) return NextResponse.json({ error: r.error, detalle: r.detalle }, { status: r.status });
  return NextResponse.json({ ok: true, version: r.version }, { headers: { "Cache-Control": "no-store" } });
}
