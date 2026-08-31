import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { obtenerAdjunto, promoverAdjunto } from "@/lib/ia/docs/adjuntosServer";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Promover un adjunto a documento de conocimiento (requiere confirmación con título,
// categoría y contenido). Anti mass-assignment: solo se leen esos campos.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const adj = await obtenerAdjunto(id);
  if (!adj) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").select("owner").eq("id", adj.conversacion_id as string).maybeSingle();
  if (!conv || conv.owner !== IA_OWNER_ADMIN) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const titulo = typeof b.titulo === "string" ? b.titulo : "";
  const contenido = typeof b.contenido === "string" ? b.contenido : "";
  const categoriaId = typeof b.categoria_id === "string" && UUID_RE.test(b.categoria_id) ? b.categoria_id : null;
  const descripcion = typeof b.descripcion === "string" ? b.descripcion : null;
  const vDesde = typeof b.vigencia_desde === "string" && FECHA_RE.test(b.vigencia_desde) ? b.vigencia_desde : null;
  const vHasta = typeof b.vigencia_hasta === "string" && FECHA_RE.test(b.vigencia_hasta) ? b.vigencia_hasta : null;

  const r = await promoverAdjunto({ adjuntoId: id, titulo, categoriaId, descripcion, contenido, vigenciaDesde: vDesde, vigenciaHasta: vHasta, actor: IA_OWNER_ADMIN });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, documento_id: r.documentoId, version_id: r.versionId }, { status: 201 });
}
