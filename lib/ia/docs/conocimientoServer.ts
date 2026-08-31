import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { detectar } from "@/lib/ia/docs/deteccion";
import { extraer, type Fragmento } from "@/lib/ia/docs/extractors";
import { getLimitesDocs } from "@/lib/ia/docs/config";
import { descargar, rutaDocumento, subir } from "@/lib/ia/docs/storage";

// IA SIM · Bloque 4B — Conocimiento permanente: categorías, documentos, versiones
// (activación ATÓMICA vía RPC), fragmentos y búsqueda de texto completo (español).
// Solo escribe tablas ia_* y Storage privado. Datos de negocio: solo lectura.

export function normalizar(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// ── Categorías ────────────────────────────────────────────────────────────────
export async function listarCategorias() {
  const { data } = await supabaseAdmin.from("ia_conocimiento_categorias").select("id, nombre, estado").order("nombre");
  const cats = (data ?? []) as Array<{ id: string; nombre: string; estado: string }>;
  const { data: docs } = await supabaseAdmin.from("ia_documentos").select("categoria_id").eq("estado", "activo");
  const conteo: Record<string, number> = {};
  for (const d of docs ?? []) if (d.categoria_id) conteo[d.categoria_id] = (conteo[d.categoria_id] || 0) + 1;
  return cats.map((c) => ({ ...c, documentos_activos: conteo[c.id] || 0 }));
}
export async function crearCategoria(nombre: string) {
  const norm = normalizar(nombre);
  if (!norm) return { ok: false as const, status: 400, error: "Nombre inválido." };
  const { data, error } = await supabaseAdmin.from("ia_conocimiento_categorias").insert({ nombre: nombre.trim(), nombre_norm: norm }).select("id, nombre, estado").single();
  if (error) return { ok: false as const, status: 409, error: "Ya existe una categoría con ese nombre." };
  return { ok: true as const, categoria: data };
}
export async function actualizarCategoria(id: string, patch: { nombre?: string; estado?: "activa" | "archivada" }) {
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.nombre) { upd.nombre = patch.nombre.trim(); upd.nombre_norm = normalizar(patch.nombre); }
  if (patch.estado) upd.estado = patch.estado;
  const { error } = await supabaseAdmin.from("ia_conocimiento_categorias").update(upd).eq("id", id);
  if (error) return { ok: false as const, status: 409, error: "No se pudo actualizar la categoría." };
  return { ok: true as const };
}

// ── Fragmentos ────────────────────────────────────────────────────────────────
function chunkManual(texto: string): Fragmento[] {
  const limpio = (texto || "").replace(/\r\n/g, "\n").trim();
  if (!limpio) return [];
  const parrafos = limpio.split(/\n{2,}/);
  const out: Fragmento[] = []; let acc = ""; let n = 1;
  const push = () => { if (acc.trim()) { out.push({ ordinal: n, ubicacion: `Sección ${n}`, texto: acc.trim() }); n++; acc = ""; } };
  for (const p of parrafos) { if ((acc + "\n\n" + p).length > 1500 && acc) push(); acc += (acc ? "\n\n" : "") + p; if (acc.length > 1500) push(); }
  push();
  return out;
}

// Genera fragmentos con procedencia real: re-extrae del archivo si hay extractor;
// si no, o si el contenido fue corregido manualmente, chunkea el texto confirmado.
async function fragmentosParaVersion(version: { storage_path: string | null; metodo_extraccion: string | null; nombre_original: string | null; mime: string | null; contenido_extraido: string | null; contenido_corregido: string | null }): Promise<Fragmento[]> {
  const confirmado = (version.contenido_corregido ?? version.contenido_extraido ?? "").trim();
  const metodo = version.metodo_extraccion ?? "";
  const conExtractor = !["manual", "sin_extractor", "ocr_vision"].includes(metodo);
  const sinCorreccion = !version.contenido_corregido || version.contenido_corregido.trim() === (version.contenido_extraido ?? "").trim();
  if (conExtractor && sinCorreccion && version.storage_path) {
    const buf = await descargar(version.storage_path);
    if (buf) {
      const det = detectar(buf, version.nombre_original ?? "");
      const r = await extraer(buf, det, getLimitesDocs());
      if (r.fragmentos.length > 0) return r.fragmentos;
    }
  }
  return chunkManual(confirmado);
}

async function reindexarFragmentos(documentoId: string, versionId: string, categoriaId: string | null, frags: Fragmento[]) {
  await supabaseAdmin.from("ia_documento_fragmentos").delete().eq("version_id", versionId);
  if (frags.length === 0) return;
  await supabaseAdmin.from("ia_documento_fragmentos").insert(frags.map((f) => ({ documento_id: documentoId, version_id: versionId, categoria_id: categoriaId, ordinal: f.ordinal, ubicacion: f.ubicacion, texto: f.texto })));
}

// ── Activación atómica de una versión (regenera fragmentos) ───────────────────
export async function activarVersion(documentoId: string, versionId: string) {
  const { error } = await supabaseAdmin.rpc("ia_doc_activar_version", { p_documento_id: documentoId, p_version_id: versionId });
  if (error) return { ok: false as const, status: 409, error: "No se pudo activar la versión." };
  const { data: ver } = await supabaseAdmin.from("ia_documento_versiones").select("*").eq("id", versionId).single();
  const { data: doc } = await supabaseAdmin.from("ia_documentos").select("categoria_id").eq("id", documentoId).single();
  if (ver) await reindexarFragmentos(documentoId, versionId, doc?.categoria_id ?? null, await fragmentosParaVersion(ver));
  return { ok: true as const };
}

// ── Búsqueda de conocimiento (FTS español, ranking determinístico) ────────────
export type FragmentoResultado = {
  documento_id: string; version_id: string; titulo: string; categoria: string | null;
  ubicacion: string; fragmento: string; metodo_extraccion: string | null; vigencia: { desde: string | null; hasta: string | null };
  score: number; advertencias: string[];
};

export async function buscarConocimiento(params: { consulta: string; categorias?: string[]; vigenteEn?: string | null; limite?: number }): Promise<FragmentoResultado[]> {
  const q = (params.consulta || "").trim();
  if (!q) return [];
  const limite = Math.min(Math.max(params.limite ?? 6, 1), 20);
  // FTS español sobre fragmentos de la versión ACTIVA de documentos ACTIVOS.
  const sql = await supabaseAdmin
    .from("ia_documento_fragmentos")
    .select("id, documento_id, version_id, ubicacion, texto, categoria_id, ia_documentos!inner(id, titulo, estado, categoria_id, version_activa_id, vigencia_desde, vigencia_hasta), ia_documento_versiones!inner(id, estado, metodo_extraccion)")
    .textSearch("tsv", q, { type: "websearch", config: "spanish" })
    .limit(80);
  const rows = (sql.data ?? []) as unknown as Array<{
    documento_id: string; version_id: string; ubicacion: string; texto: string; categoria_id: string | null;
    ia_documentos: { titulo: string; estado: string; version_activa_id: string | null; vigencia_desde: string | null; vigencia_hasta: string | null };
    ia_documento_versiones: { estado: string; metodo_extraccion: string | null };
  }>;

  const catNombre = await mapaCategorias();
  const filtrarCats = (params.categorias ?? []).map(normalizar);
  const vig = params.vigenteEn ?? null;
  const out: FragmentoResultado[] = [];
  for (const r of rows) {
    if (r.ia_documentos.estado !== "activo") continue;                 // documento archivado excluido
    if (r.ia_documento_versiones.estado !== "activa") continue;         // versión reemplazada excluida
    if (r.ia_documentos.version_activa_id !== r.version_id) continue;   // solo la versión activa
    const catN = r.categoria_id ? normalizar(catNombre[r.categoria_id] ?? "") : "";
    if (filtrarCats.length > 0 && !filtrarCats.includes(catN)) continue;
    const adv: string[] = [];
    if (vig) {
      const desde = r.ia_documentos.vigencia_desde, hasta = r.ia_documentos.vigencia_hasta;
      if ((desde && vig < desde) || (hasta && vig > hasta)) adv.push("Fuera del período de vigencia consultado.");
    }
    // Score determinístico: coincidencias de términos en el fragmento + bonus por título.
    const terminos = normalizar(q).split(/\s+/).filter(Boolean);
    const tN = normalizar(r.texto);
    let score = terminos.reduce((s, t) => s + (tN.includes(t) ? 1 : 0), 0);
    if (terminos.some((t) => normalizar(r.ia_documentos.titulo).includes(t))) score += 0.5;
    out.push({
      documento_id: r.documento_id, version_id: r.version_id, titulo: r.ia_documentos.titulo,
      categoria: r.categoria_id ? catNombre[r.categoria_id] ?? null : null,
      ubicacion: r.ubicacion, fragmento: r.texto.length > 700 ? r.texto.slice(0, 700) + "…" : r.texto,
      metodo_extraccion: r.ia_documento_versiones.metodo_extraccion,
      vigencia: { desde: r.ia_documentos.vigencia_desde, hasta: r.ia_documentos.vigencia_hasta },
      score, advertencias: adv,
    });
  }
  out.sort((a, b) => b.score - a.score || a.documento_id.localeCompare(b.documento_id) || a.ubicacion.localeCompare(b.ubicacion));
  return out.slice(0, limite);
}

async function mapaCategorias(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("ia_conocimiento_categorias").select("id, nombre");
  const m: Record<string, string> = {};
  for (const c of data ?? []) m[c.id as string] = c.nombre as string;
  return m;
}

export async function listarDocumentosActivos(categoria?: string) {
  const { data } = await supabaseAdmin
    .from("ia_documentos")
    .select("id, titulo, categoria_id, descripcion, vigencia_desde, vigencia_hasta, updated_at")
    .eq("estado", "activo")
    .order("updated_at", { ascending: false })
    .limit(200);
  const cat = await mapaCategorias();
  let docs = (data ?? []).map((d) => ({ id: d.id, titulo: d.titulo, categoria: d.categoria_id ? cat[d.categoria_id as string] ?? null : null, descripcion: d.descripcion, vigencia: { desde: d.vigencia_desde, hasta: d.vigencia_hasta } }));
  if (categoria) docs = docs.filter((d) => normalizar(d.categoria ?? "") === normalizar(categoria));
  return docs;
}

export async function obtenerFragmentoAmpliado(documentoId: string, ubicacion: string): Promise<{ documento_id: string; ubicacion: string; texto: string } | null> {
  const { data: doc } = await supabaseAdmin.from("ia_documentos").select("version_activa_id, estado").eq("id", documentoId).maybeSingle();
  if (!doc || doc.estado !== "activo" || !doc.version_activa_id) return null;
  const { data } = await supabaseAdmin.from("ia_documento_fragmentos").select("texto, ubicacion").eq("version_id", doc.version_activa_id).eq("ubicacion", ubicacion).maybeSingle();
  if (!data) return null;
  return { documento_id: documentoId, ubicacion: data.ubicacion as string, texto: (data.texto as string).slice(0, 4000) };
}

export { rutaDocumento, subir, reindexarFragmentos, fragmentosParaVersion };
