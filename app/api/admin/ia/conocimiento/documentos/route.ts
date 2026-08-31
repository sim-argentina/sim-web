import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { crearDocumento } from "@/lib/ia/docs/documentosServer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Listar documentos (filtro por categoría/estado/búsqueda simple por título).
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const estado = q.get("estado") === "archivado" ? "archivado" : "activo";
  let query = supabaseAdmin.from("ia_documentos").select("id, titulo, categoria_id, descripcion, estado, vigencia_desde, vigencia_hasta, version_activa_id, updated_at").eq("estado", estado).order("updated_at", { ascending: false }).limit(300);
  const cat = q.get("categoria_id");
  if (cat && UUID_RE.test(cat)) query = query.eq("categoria_id", cat);
  const texto = q.get("q");
  if (texto) query = query.ilike("titulo", `%${texto.slice(0, 80)}%`);
  const { data } = await query;
  const { data: cats } = await supabaseAdmin.from("ia_conocimiento_categorias").select("id, nombre");
  const nombre: Record<string, string> = {};
  for (const c of cats ?? []) nombre[c.id as string] = c.nombre as string;
  return NextResponse.json({ documentos: (data ?? []).map((d) => ({ ...d, categoria: d.categoria_id ? nombre[d.categoria_id as string] ?? null : null })) });
}

// Carga directa de un documento nuevo (multipart). Queda en borrador para revisar/activar.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Formato de carga inválido." }, { status: 400 }); }
  const file = form.get("archivo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  const titulo = String(form.get("titulo") || "").trim();
  const categoriaId = String(form.get("categoria_id") || "");
  const descripcion = String(form.get("descripcion") || "") || null;
  const vDesde = String(form.get("vigencia_desde") || "");
  const vHasta = String(form.get("vigencia_hasta") || "");

  const r = await crearDocumento({
    buf: new Uint8Array(await file.arrayBuffer()), nombre: file.name || "documento", titulo,
    categoriaId: UUID_RE.test(categoriaId) ? categoriaId : null, descripcion,
    vigenciaDesde: FECHA_RE.test(vDesde) ? vDesde : null, vigenciaHasta: FECHA_RE.test(vHasta) ? vHasta : null, actor: IA_OWNER_ADMIN,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ documento_id: r.documentoId, version_id: r.versionId, resultado: r.resultado, duplicado_de: r.duplicadoDe ?? null }, { status: 201 });
}
