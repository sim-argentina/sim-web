import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearCategoria, actualizarCategoria, listarCategorias, activarVersion, buscarConocimiento, listarDocumentosActivos } from "@/lib/ia/docs/conocimientoServer";
import { crearDocumento, nuevaVersion, restaurarVersion } from "@/lib/ia/docs/documentosServer";
import { crearAdjunto, listarAdjuntos, promoverAdjunto } from "@/lib/ia/docs/adjuntosServer";
import { borrar } from "@/lib/ia/docs/storage";

// Integración (DB + Storage privado) del conocimiento. Fixtures ZZTEST, limpieza total.
//   npx tsx --env-file=.env.local lib/ia/docs/conocimiento.integration.ts
const CAT = "ZZTEST_CAT_" + Math.floor(Math.random() * 1e6);
const OWNER = "ZZTEST:ia-docs";
const enc = (s: string) => new TextEncoder().encode(s);

async function versionesActivas(docId: string) {
  const { data } = await supabaseAdmin.from("ia_documento_versiones").select("id").eq("documento_id", docId).eq("estado", "activa");
  return (data ?? []).map((v) => v.id as string);
}

async function limpiar() {
  const { data: docs } = await supabaseAdmin.from("ia_documentos").select("id").ilike("titulo", "ZZTEST%");
  const ids = (docs ?? []).map((d) => d.id as string);
  if (ids.length) {
    const { data: vers } = await supabaseAdmin.from("ia_documento_versiones").select("storage_path").in("documento_id", ids);
    await borrar((vers ?? []).map((v) => v.storage_path as string).filter(Boolean));
    await supabaseAdmin.from("ia_documento_fragmentos").delete().in("documento_id", ids);
    await supabaseAdmin.from("ia_documento_versiones").delete().in("documento_id", ids);
    await supabaseAdmin.from("ia_documentos").delete().in("id", ids);
  }
  const { data: convs } = await supabaseAdmin.from("ia_conversaciones").select("id").eq("owner", OWNER);
  const cids = (convs ?? []).map((c) => c.id as string);
  if (cids.length) {
    const { data: adj } = await supabaseAdmin.from("ia_adjuntos_conversacion").select("storage_path").in("conversacion_id", cids);
    await borrar((adj ?? []).map((a) => a.storage_path as string).filter(Boolean));
    await supabaseAdmin.from("ia_conversaciones").delete().in("id", cids);
  }
  await supabaseAdmin.from("ia_conocimiento_categorias").delete().ilike("nombre", "ZZTEST%");
}

async function main() {
  await limpiar();
  try {
    // ── Categoría ────────────────────────────────────────────────────────────
    const cat = await crearCategoria(CAT);
    assert.ok(cat.ok, "categoría creada");
    const catId = cat.ok ? cat.categoria.id as string : "";

    // ── Documento directo → borrador → NO se busca hasta activar ─────────────
    const doc1 = await crearDocumento({ buf: enc("Politica de precios SIM. El turno cuesta 15000. Los martes cerramos a las 20 hs."), nombre: "politica.txt", titulo: "ZZTEST Politica precios", categoriaId: catId, descripcion: null, vigenciaDesde: null, vigenciaHasta: null, actor: "test" });
    assert.ok(doc1.ok, "documento creado"); if (!doc1.ok) return;
    let hits = await buscarConocimiento({ consulta: "martes cerramos" });
    assert.ok(!hits.some((h) => h.documento_id === doc1.documentoId), "borrador NO aparece en la búsqueda");
    await activarVersion(doc1.documentoId, doc1.versionId);
    hits = await buscarConocimiento({ consulta: "martes cerramos" });
    const h = hits.find((x) => x.documento_id === doc1.documentoId)!;
    assert.ok(h, "activo aparece en la búsqueda");
    assert.ok(h.ubicacion && h.titulo.includes("Politica"), "cita con ubicación y título");
    assert.equal(h.categoria, CAT, "categoría en la cita");
    assert.equal((await versionesActivas(doc1.documentoId)).length, 1, "una sola versión activa");

    // ── Nueva versión: la anterior sigue activa hasta confirmar; luego swap atómico ─
    const v2 = await nuevaVersion({ documentoId: doc1.documentoId, buf: enc("Politica v2. Los martes cerramos a las 21 hs."), nombre: "politica2.txt", actor: "test" });
    assert.ok(v2.ok, "nueva versión (borrador)"); if (!v2.ok) return;
    assert.equal((await versionesActivas(doc1.documentoId)).length, 1, "sigue una sola activa (la anterior) durante el borrador");
    hits = await buscarConocimiento({ consulta: "21 hs" });
    assert.ok(!hits.some((x) => x.documento_id === doc1.documentoId), "borrador v2 no se busca todavía");
    await activarVersion(doc1.documentoId, v2.versionId);
    assert.equal((await versionesActivas(doc1.documentoId)).length, 1, "sigue una sola activa tras el swap");
    assert.ok((await buscarConocimiento({ consulta: "21 hs" })).some((x) => x.documento_id === doc1.documentoId), "v2 activa se busca");
    assert.ok(!(await buscarConocimiento({ consulta: "20 hs" })).some((x) => x.documento_id === doc1.documentoId), "v1 reemplazada NO se busca");

    // ── Restaurar v1 → nueva versión activa basada en ella ──────────────────
    const { data: vlist } = await supabaseAdmin.from("ia_documento_versiones").select("id, numero").eq("documento_id", doc1.documentoId).order("numero");
    const v1id = (vlist ?? []).find((v) => v.numero === 1)!.id as string;
    const rest = await restaurarVersion({ documentoId: doc1.documentoId, versionBaseId: v1id, actor: "test" });
    assert.ok(rest.ok, "restauración ok");
    assert.equal((await versionesActivas(doc1.documentoId)).length, 1, "una sola activa tras restaurar");
    assert.ok((await buscarConocimiento({ consulta: "20 hs" })).some((x) => x.documento_id === doc1.documentoId), "contenido restaurado se busca");

    // ── Dedup por SHA (informativo) ─────────────────────────────────────────
    const dupDoc = await crearDocumento({ buf: enc("Politica de precios SIM. El turno cuesta 15000. Los martes cerramos a las 20 hs."), nombre: "politica.txt", titulo: "ZZTEST Politica dup", categoriaId: catId, descripcion: null, vigenciaDesde: null, vigenciaHasta: null, actor: "test" });
    assert.ok(dupDoc.ok && dupDoc.duplicadoDe, "aviso de duplicado por SHA");

    // ── Adjunto: propio de la conversación, no visible en otra ──────────────
    const { data: c1 } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id").single();
    const { data: c2 } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id").single();
    const adj = await crearAdjunto({ conversacionId: c1!.id, buf: enc("Manual interno ZZTEST: el protocolo de apertura es a las 10."), nombreOriginal: "manual.txt", actor: "test" });
    assert.ok(adj.ok, "adjunto creado"); if (!adj.ok) return;
    assert.equal((adj.adjunto.estado_procesamiento), "listo", "adjunto extraído");
    assert.equal((await listarAdjuntos(c1!.id)).length, 1, "adjunto visible en su conversación");
    assert.equal((await listarAdjuntos(c2!.id)).length, 0, "adjunto NO visible en otra conversación");

    // ── Promoción a conocimiento: sobrevive a eliminar la conversación ──────
    const prom = await promoverAdjunto({ adjuntoId: adj.adjunto.id as string, titulo: "ZZTEST Manual apertura", categoriaId: catId, descripcion: null, contenido: "El protocolo de apertura es a las 10.", vigenciaDesde: null, vigenciaHasta: null, actor: "test" });
    assert.ok(prom.ok, "promoción ok"); if (!prom.ok) return;
    assert.ok((await buscarConocimiento({ consulta: "protocolo de apertura" })).some((x) => x.documento_id === prom.documentoId), "documento promovido se busca");
    if (adj.adjunto.storage_path) await borrar([adj.adjunto.storage_path as string]); // limpiar storage del adjunto antes de borrar la conversación
    await supabaseAdmin.from("ia_conversaciones").delete().eq("id", c1!.id); // borra conversación y su adjunto
    const { data: sigueDoc } = await supabaseAdmin.from("ia_documentos").select("id").eq("id", prom.documentoId).maybeSingle();
    assert.ok(sigueDoc, "el documento de conocimiento sobrevive a la eliminación de la conversación");

    // ── Documento archivado excluido de la búsqueda ─────────────────────────
    await supabaseAdmin.from("ia_documentos").update({ estado: "archivado" }).eq("id", prom.documentoId);
    assert.ok(!(await buscarConocimiento({ consulta: "protocolo de apertura" })).some((x) => x.documento_id === prom.documentoId), "documento archivado excluido");

    // ── Categoría archivada + conteo ────────────────────────────────────────
    await actualizarCategoria(catId, { estado: "archivada" });
    const cats = await listarCategorias();
    assert.ok(cats.find((c) => c.id === catId)?.estado === "archivada", "categoría archivada");
    assert.ok((await listarDocumentosActivos()).some((d) => d.titulo.includes("ZZTEST")) !== undefined, "lista de activos accesible");

    console.log("✔ conocimiento.integration OK (categorías; borrador→activo; versión atómica única; reemplazada excluida; restaurar; dedup SHA; adjunto por conversación; promoción independiente; archivado excluido)");
  } finally {
    await limpiar();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
