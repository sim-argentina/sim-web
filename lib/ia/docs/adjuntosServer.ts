import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { detectar } from "@/lib/ia/docs/deteccion";
import { extraer } from "@/lib/ia/docs/extractors";
import { getLimitesDocs } from "@/lib/ia/docs/config";
import { sha256, rutaAdjunto, rutaDocumento, subir, borrar, copiar, descargar } from "@/lib/ia/docs/storage";
import { fragmentosParaVersion, reindexarFragmentos } from "@/lib/ia/docs/conocimientoServer";
import { necesidadOCR, analizarArchivoOCR } from "@/lib/ia/docs/ocr";
import { crearProvider } from "@/lib/ia/providerFactory";
import { IA_OWNER_ADMIN, iaEstaConfigurada } from "@/lib/ia/config";

// IA SIM · Bloque 4B — Adjuntos de conversación: validación, extracción y promoción
// a conocimiento. Idempotencia por SHA-256 dentro de la conversación.

type Fail = { ok: false; status: number; error: string; motivo?: string };
type OkAdj = { ok: true; adjunto: Record<string, unknown>; duplicado?: boolean };

export async function crearAdjunto(p: { conversacionId: string; buf: Uint8Array; nombreOriginal: string; actor: string }): Promise<OkAdj | Fail> {
  const lim = getLimitesDocs();
  if (p.buf.byteLength > lim.maxBytesArchivo) return { ok: false, status: 413, error: `El archivo supera el máximo de ${Math.round(lim.maxBytesArchivo / 1024 / 1024)} MB.` };
  if (p.buf.byteLength === 0) return { ok: false, status: 400, error: "El archivo está vacío." };

  const det = detectar(p.buf, p.nombreOriginal);
  if (!det.seguro) return { ok: false, status: 415, error: det.motivo ?? "Tipo de archivo no permitido." };

  const hash = sha256(p.buf);
  // Idempotencia: mismo archivo ya adjunto en esta conversación → devolverlo.
  const { data: prev } = await supabaseAdmin.from("ia_adjuntos_conversacion").select("*").eq("conversacion_id", p.conversacionId).eq("sha256", hash).maybeSingle();
  if (prev) return { ok: true, adjunto: prev, duplicado: true };

  const path = rutaAdjunto(p.conversacionId, p.nombreOriginal);
  const up = await subir(path, p.buf, det.mime);
  if (!up.ok) return { ok: false, status: 500, error: "No se pudo almacenar el archivo." };

  let resultado;
  try { resultado = await extraer(p.buf, det, lim); }
  catch { resultado = { metodo: "error", estado: "error" as const, contenido: "", fragmentos: [], advertencias: [], error: "extraccion" }; }

  // ¿El archivo necesita OCR/visión? (imagen o PDF escaneado/mixto). No se consume la
  // API acá: solo se marca el estado para que el admin lo autorice después.
  const nec = necesidadOCR(det, resultado);
  const estadoProc = nec.necesita ? "necesita_ocr" : resultado.estado;

  const { data, error } = await supabaseAdmin.from("ia_adjuntos_conversacion").insert({
    conversacion_id: p.conversacionId, storage_path: path, nombre_original: p.nombreOriginal.slice(0, 300),
    mime: det.mime, tamano: p.buf.byteLength, sha256: hash, contenido_extraido: resultado.contenido,
    metodo_extraccion: resultado.metodo, estado_procesamiento: estadoProc,
    paginas: resultado.paginas ?? null, hojas: resultado.hojas ?? null, diapositivas: resultado.diapositivas ?? null,
    advertencias: resultado.advertencias, error_tecnico: resultado.error ?? null, actor: p.actor,
  }).select("*").single();
  if (error || !data) { await borrar([path]); return { ok: false, status: 500, error: "No se pudo registrar el adjunto." }; }

  await supabaseAdmin.from("ia_procesamientos_archivos").insert({ ambito: "adjunto", ref_id: data.id, evento: `extraccion:${resultado.estado}`, detalle: { metodo: resultado.metodo, formato: det.formato, advertencias: resultado.advertencias } });
  return { ok: true, adjunto: data };
}

export async function listarAdjuntos(conversacionId: string) {
  const { data } = await supabaseAdmin.from("ia_adjuntos_conversacion")
    .select("id, nombre_original, mime, tamano, estado_procesamiento, metodo_extraccion, paginas, hojas, diapositivas, advertencias, promovido_documento_id, created_at")
    .eq("conversacion_id", conversacionId).order("created_at", { ascending: true });
  return data ?? [];
}

export async function obtenerAdjunto(id: string) {
  const { data } = await supabaseAdmin.from("ia_adjuntos_conversacion").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function corregirAdjunto(id: string, contenidoCorregido: string) {
  await supabaseAdmin.from("ia_adjuntos_conversacion").update({ contenido_corregido: contenidoCorregido.slice(0, getLimitesDocs().maxCaracteres), estado_procesamiento: "listo" }).eq("id", id);
  return { ok: true as const };
}

export async function eliminarAdjunto(id: string) {
  const adj = await obtenerAdjunto(id);
  if (!adj) return { ok: false as const, status: 404, error: "No encontrado." };
  if (adj.storage_path) await borrar([adj.storage_path as string]);
  await supabaseAdmin.from("ia_adjuntos_conversacion").delete().eq("id", id);
  return { ok: true as const };
}

// OCR/visión de un adjunto (SOLO tras autorización explícita del admin, gateado en la API).
export async function analizarAdjuntoOCR(p: { adjuntoId: string; reprocesar?: boolean }): Promise<{ ok: true; adjunto: Record<string, unknown>; ocr: { reutilizado: boolean; estado: string; confianza: string; texto_detectado: string; descripcion_visual: string; advertencias: string[]; modelo: string; claseModelo: string; motivoModelo: string; paginas_o_imagenes: number; tokens: { in: number; out: number }; costo: number | null } } | Fail> {
  if (!iaEstaConfigurada()) return { ok: false, status: 503, error: "IA SIM todavía no está configurada. No se puede usar OCR/visión." };
  const provider = crearProvider();
  if (!provider || !provider.analizarVisual) return { ok: false, status: 503, error: "El proveedor de IA no está disponible para OCR/visión." };

  const adj = await obtenerAdjunto(p.adjuntoId);
  if (!adj || !adj.storage_path) return { ok: false, status: 404, error: "Adjunto no encontrado." };
  const buf = await descargar(adj.storage_path as string);
  if (!buf) return { ok: false, status: 500, error: "No se pudo leer el archivo." };
  const u8 = new Uint8Array(buf);
  const det = detectar(u8, (adj.nombre_original as string) || "");
  const resultadoLocal = await extraer(u8, det, getLimitesDocs());

  const r = await analizarArchivoOCR({ buf: u8, nombre: (adj.nombre_original as string) || "", sha256: (adj.sha256 as string) || sha256(u8), resultadoLocal, provider, owner: IA_OWNER_ADMIN, actor: IA_OWNER_ADMIN, reprocesar: p.reprocesar });
  if (!r.ok) return r;

  const { data, error } = await supabaseAdmin.from("ia_adjuntos_conversacion").update({
    contenido_extraido: r.contenidoCombinado, metodo_extraccion: "ocr_vision", estado_procesamiento: r.estado,
    ocr_texto_detectado: r.texto_detectado, ocr_descripcion_visual: r.descripcion_visual, ocr_confianza: r.confianza,
    advertencias: r.advertencias,
  }).eq("id", p.adjuntoId).select("*").single();
  if (error || !data) return { ok: false, status: 500, error: "No se pudo guardar el resultado del OCR." };

  await supabaseAdmin.from("ia_procesamientos_archivos").insert({ ambito: "adjunto", ref_id: p.adjuntoId, evento: `ocr:${r.estado}`, detalle: { modelo: r.modelo, reutilizado: r.reutilizado, confianza: r.confianza, tokens: r.uso } });
  return { ok: true, adjunto: data, ocr: { reutilizado: r.reutilizado, estado: r.estado, confianza: r.confianza, texto_detectado: r.texto_detectado, descripcion_visual: r.descripcion_visual, advertencias: r.advertencias, modelo: r.modelo, claseModelo: r.claseModelo, motivoModelo: r.motivoModelo, paginas_o_imagenes: r.paginas_o_imagenes, tokens: { in: r.uso.tokensIn, out: r.uso.tokensOut }, costo: r.costo } };
}

// Promoción a documento de conocimiento (independiente de la conversación).
export async function promoverAdjunto(p: { adjuntoId: string; titulo: string; categoriaId: string | null; descripcion: string | null; contenido: string; vigenciaDesde: string | null; vigenciaHasta: string | null; actor: string }): Promise<{ ok: true; documentoId: string; versionId: string } | Fail> {
  const adj = await obtenerAdjunto(p.adjuntoId);
  if (!adj) return { ok: false, status: 404, error: "Adjunto no encontrado." };
  if (adj.promovido_documento_id) return { ok: false, status: 409, error: "El adjunto ya fue guardado como conocimiento." };
  if (!p.titulo.trim()) return { ok: false, status: 400, error: "El título es obligatorio." };
  if (!p.contenido.trim()) return { ok: false, status: 400, error: "El contenido a guardar no puede estar vacío." };

  // Copiar el archivo a una ruta de documento (independiente del adjunto/conversación).
  const destPath = adj.storage_path ? rutaDocumento(randomUUID(), (adj.nombre_original as string) || "doc") : null;
  if (adj.storage_path && destPath) {
    const cp = await copiar(adj.storage_path as string, destPath, (adj.mime as string) || "application/octet-stream");
    if (!cp.ok) return { ok: false, status: 500, error: "No se pudo copiar el archivo al conocimiento." };
  }

  const { data, error } = await supabaseAdmin.rpc("ia_promover_adjunto", {
    p_adjunto_id: p.adjuntoId, p_titulo: p.titulo.trim().slice(0, 300), p_categoria_id: p.categoriaId,
    p_descripcion: p.descripcion?.slice(0, 2000) ?? null, p_contenido: p.contenido.slice(0, getLimitesDocs().maxCaracteres),
    p_storage_path: destPath, p_vigencia_desde: p.vigenciaDesde, p_vigencia_hasta: p.vigenciaHasta, p_actor: p.actor,
  });
  if (error) { if (destPath) await borrar([destPath]); return { ok: false, status: 409, error: "No se pudo guardar como conocimiento." }; }
  const res = data as { documento_id: string; version_id: string };

  // Indexar fragmentos de la nueva versión activa.
  const { data: ver } = await supabaseAdmin.from("ia_documento_versiones").select("*").eq("id", res.version_id).single();
  const { data: doc } = await supabaseAdmin.from("ia_documentos").select("categoria_id").eq("id", res.documento_id).single();
  if (ver) await reindexarFragmentos(res.documento_id, res.version_id, doc?.categoria_id ?? null, await fragmentosParaVersion(ver));

  await supabaseAdmin.from("ia_procesamientos_archivos").insert({ ambito: "version", ref_id: res.version_id, evento: "promovido_desde_adjunto", detalle: { documento_id: res.documento_id, adjunto_id: p.adjuntoId } });
  return { ok: true, documentoId: res.documento_id, versionId: res.version_id };
}
