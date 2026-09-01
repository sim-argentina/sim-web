import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { detectar } from "@/lib/ia/docs/deteccion";
import { extraer } from "@/lib/ia/docs/extractors";
import { getLimitesDocs } from "@/lib/ia/docs/config";
import { sha256, rutaDocumento, subir, borrar } from "@/lib/ia/docs/storage";
import { activarVersion, resolverCategoriaActiva } from "@/lib/ia/docs/conocimientoServer";

// IA SIM · Bloque 4B — Ciclo de vida de documentos de conocimiento: carga directa,
// nueva versión (borrador → activa atómica), restauración e historial.

type Fail = { ok: false; status: number; error: string };

async function procesarYSubir(buf: Uint8Array, nombre: string): Promise<{ ok: true; path: string; det: ReturnType<typeof detectar>; resultado: Awaited<ReturnType<typeof extraer>>; sha: string } | Fail> {
  const lim = getLimitesDocs();
  if (buf.byteLength > lim.maxBytesArchivo) return { ok: false, status: 413, error: `El archivo supera el máximo de ${Math.round(lim.maxBytesArchivo / 1024 / 1024)} MB.` };
  if (buf.byteLength === 0) return { ok: false, status: 400, error: "El archivo está vacío." };
  const det = detectar(buf, nombre);
  if (!det.seguro) return { ok: false, status: 415, error: det.motivo ?? "Tipo de archivo no permitido." };
  const path = rutaDocumento(randomUUID(), nombre);
  const up = await subir(path, buf, det.mime);
  if (!up.ok) return { ok: false, status: 500, error: "No se pudo almacenar el archivo." };
  const resultado = await extraer(buf, det, lim);
  return { ok: true, path, det, resultado, sha: sha256(buf) };
}

async function proximoNumero(documentoId: string): Promise<number> {
  const { data } = await supabaseAdmin.from("ia_documento_versiones").select("numero").eq("documento_id", documentoId).order("numero", { ascending: false }).limit(1).maybeSingle();
  return (data?.numero ?? 0) + 1;
}

// Carga directa de un documento nuevo (queda en BORRADOR hasta confirmar/activar).
export async function crearDocumento(p: { buf: Uint8Array; nombre: string; titulo: string; categoriaId: string | null; descripcion: string | null; vigenciaDesde: string | null; vigenciaHasta: string | null; actor: string }): Promise<{ ok: true; documentoId: string; versionId: string; resultado: unknown; duplicadoDe?: string } | Fail> {
  if (!p.titulo.trim()) return { ok: false, status: 400, error: "El título es obligatorio." };
  // Categoría OBLIGATORIA (default General; rechaza inexistente/archivada).
  const cat = await resolverCategoriaActiva(p.categoriaId);
  if (!cat.ok) return { ok: false, status: 400, error: cat.error };
  const proc = await procesarYSubir(p.buf, p.nombre);
  if (!proc.ok) return proc;

  // Aviso de duplicado por SHA (no bloquea, informa).
  const { data: dup } = await supabaseAdmin.from("ia_documento_versiones").select("documento_id").eq("sha256", proc.sha).limit(1).maybeSingle();

  const { data: doc, error: e1 } = await supabaseAdmin.from("ia_documentos").insert({ titulo: p.titulo.trim().slice(0, 300), categoria_id: cat.id, descripcion: p.descripcion?.slice(0, 2000) ?? null, fuente: "carga_directa", vigencia_desde: p.vigenciaDesde, vigencia_hasta: p.vigenciaHasta, actor: p.actor }).select("id").single();
  if (e1 || !doc) { await borrar([proc.path]); return { ok: false, status: 500, error: "No se pudo crear el documento." }; }
  const { data: ver, error: e2 } = await supabaseAdmin.from("ia_documento_versiones").insert({
    documento_id: doc.id, numero: 1, estado: "borrador", storage_path: proc.path, nombre_original: p.nombre.slice(0, 300),
    mime: proc.det.mime, tamano: p.buf.byteLength, sha256: proc.sha, contenido_extraido: proc.resultado.contenido,
    metodo_extraccion: proc.resultado.metodo, estado_procesamiento: proc.resultado.estado,
    paginas: proc.resultado.paginas ?? null, hojas: proc.resultado.hojas ?? null, diapositivas: proc.resultado.diapositivas ?? null,
    filas: proc.resultado.filas ?? null, advertencias: proc.resultado.advertencias, error_tecnico: proc.resultado.error ?? null, actor: p.actor,
  }).select("id").single();
  if (e2 || !ver) { await borrar([proc.path]); await supabaseAdmin.from("ia_documentos").delete().eq("id", doc.id); return { ok: false, status: 500, error: "No se pudo crear la versión." }; }
  return { ok: true, documentoId: doc.id, versionId: ver.id, resultado: proc.resultado, duplicadoDe: dup?.documento_id ?? undefined };
}

// Subir una NUEVA versión de un documento existente (borrador; la activa sigue vigente).
export async function nuevaVersion(p: { documentoId: string; buf: Uint8Array; nombre: string; actor: string }): Promise<{ ok: true; versionId: string; resultado: unknown } | Fail> {
  const { data: doc } = await supabaseAdmin.from("ia_documentos").select("id").eq("id", p.documentoId).maybeSingle();
  if (!doc) return { ok: false, status: 404, error: "Documento no encontrado." };
  const proc = await procesarYSubir(p.buf, p.nombre);
  if (!proc.ok) return proc;
  const numero = await proximoNumero(p.documentoId);
  const { data: ver, error } = await supabaseAdmin.from("ia_documento_versiones").insert({
    documento_id: p.documentoId, numero, estado: "borrador", storage_path: proc.path, nombre_original: p.nombre.slice(0, 300),
    mime: proc.det.mime, tamano: p.buf.byteLength, sha256: proc.sha, contenido_extraido: proc.resultado.contenido,
    metodo_extraccion: proc.resultado.metodo, estado_procesamiento: proc.resultado.estado,
    paginas: proc.resultado.paginas ?? null, hojas: proc.resultado.hojas ?? null, diapositivas: proc.resultado.diapositivas ?? null,
    filas: proc.resultado.filas ?? null, advertencias: proc.resultado.advertencias, error_tecnico: proc.resultado.error ?? null, actor: p.actor,
  }).select("id").single();
  if (error || !ver) { await borrar([proc.path]); return { ok: false, status: 500, error: "No se pudo crear la versión." }; }
  return { ok: true, versionId: ver.id, resultado: proc.resultado };
}

export async function corregirVersion(versionId: string, contenidoCorregido: string) {
  await supabaseAdmin.from("ia_documento_versiones").update({ contenido_corregido: contenidoCorregido.slice(0, getLimitesDocs().maxCaracteres), estado_procesamiento: "listo" }).eq("id", versionId);
  return { ok: true as const };
}

// Restaurar una versión anterior = crear una versión NUEVA basada en ella y activarla.
export async function restaurarVersion(p: { documentoId: string; versionBaseId: string; actor: string }): Promise<{ ok: true; versionId: string } | Fail> {
  const { data: base } = await supabaseAdmin.from("ia_documento_versiones").select("*").eq("id", p.versionBaseId).eq("documento_id", p.documentoId).maybeSingle();
  if (!base) return { ok: false, status: 404, error: "Versión base no encontrada." };
  const numero = await proximoNumero(p.documentoId);
  const { data: ver, error } = await supabaseAdmin.from("ia_documento_versiones").insert({
    documento_id: p.documentoId, numero, estado: "borrador", storage_path: base.storage_path, nombre_original: base.nombre_original,
    mime: base.mime, tamano: base.tamano, sha256: base.sha256, contenido_extraido: base.contenido_extraido, contenido_corregido: base.contenido_corregido,
    metodo_extraccion: base.metodo_extraccion, estado_procesamiento: "listo", paginas: base.paginas, hojas: base.hojas, diapositivas: base.diapositivas, filas: base.filas,
    advertencias: base.advertencias, actor: p.actor,
  }).select("id").single();
  if (error || !ver) return { ok: false, status: 500, error: "No se pudo restaurar la versión." };
  const act = await activarVersion(p.documentoId, ver.id);
  if (!act.ok) return act;
  return { ok: true, versionId: ver.id };
}

export async function archivarDocumento(id: string, estado: "activo" | "archivado") {
  await supabaseAdmin.from("ia_documentos").update({ estado, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const };
}

export async function obtenerDocumento(id: string) {
  const { data: doc } = await supabaseAdmin.from("ia_documentos").select("*").eq("id", id).maybeSingle();
  if (!doc) return null;
  const { data: versiones } = await supabaseAdmin.from("ia_documento_versiones")
    .select("id, numero, estado, nombre_original, mime, tamano, metodo_extraccion, estado_procesamiento, paginas, hojas, diapositivas, advertencias, created_at")
    .eq("documento_id", id).order("numero", { ascending: false });
  return { documento: doc, versiones: versiones ?? [] };
}

export async function contenidoVersion(versionId: string) {
  const { data } = await supabaseAdmin.from("ia_documento_versiones").select("id, numero, contenido_extraido, contenido_corregido, storage_path, nombre_original, mime").eq("id", versionId).maybeSingle();
  return data;
}
