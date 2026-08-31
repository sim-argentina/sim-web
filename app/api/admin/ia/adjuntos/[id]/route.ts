import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { obtenerAdjunto, corregirAdjunto, eliminarAdjunto } from "@/lib/ia/docs/adjuntosServer";
import { urlFirmada } from "@/lib/ia/docs/storage";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El adjunto debe pertenecer a una conversación del admin.
async function propio(id: string): Promise<Record<string, unknown> | null> {
  const adj = await obtenerAdjunto(id);
  if (!adj) return null;
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").select("owner").eq("id", adj.conversacion_id as string).maybeSingle();
  return conv && conv.owner === IA_OWNER_ADMIN ? adj : null;
}

// Detalle (con URL firmada corta del original) + contenido extraído editable.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const adj = await propio(id);
  if (!adj) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const firmar = new URL(req.url).searchParams.get("archivo") === "1";
  const url = firmar && adj.storage_path ? await urlFirmada(adj.storage_path as string, 60) : null;
  return NextResponse.json({
    id: adj.id, nombre_original: adj.nombre_original, mime: adj.mime, tamano: adj.tamano,
    estado_procesamiento: adj.estado_procesamiento, metodo_extraccion: adj.metodo_extraccion,
    paginas: adj.paginas, hojas: adj.hojas, diapositivas: adj.diapositivas, advertencias: adj.advertencias,
    contenido: adj.contenido_corregido ?? adj.contenido_extraido, promovido_documento_id: adj.promovido_documento_id,
    archivo_url: url,
  });
}

// Guardar la corrección de la vista previa.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id) || !(await propio(id))) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contenido = typeof body.contenido === "string" ? body.contenido : "";
  await corregirAdjunto(id, contenido);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id) || !(await propio(id))) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const r = await eliminarAdjunto(id);
  return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.status });
}
