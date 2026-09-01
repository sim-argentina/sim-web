process.env.IA_PROVIDER = "fake";
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearCategoria, actualizarCategoria, activarVersion, buscarConocimiento, listarCategorias } from "@/lib/ia/docs/conocimientoServer";
import { crearDocumento } from "@/lib/ia/docs/documentosServer";
import { crearAdjunto, promoverAdjunto } from "@/lib/ia/docs/adjuntosServer";
import { correrChat } from "@/lib/ia/server";
import { borrar } from "@/lib/ia/docs/storage";

//   npx tsx --env-file=.env.local lib/ia/docs/recuperacionGlobal.integration.ts
const OWNER = "ZZTEST:recup";
const enc = (s: string) => new TextEncoder().encode(s);
const CONTENIDO = "SIM ARGENTINA\nDOCUMENTO DE PRUEBA OCR ZZTEST\nCÓDIGO DE VERIFICACIÓN: PISTA-9931\nPALABRA SECRETA: TURBO\nHORA DE PRUEBA: 18:30\nCOLOR DEL CASCO: ROJO\nRESPONSABLE FICTICIA: LAURA GÓMEZ";

async function limpiar() {
  const { data: docs } = await supabaseAdmin.from("ia_documentos").select("id").ilike("titulo", "ZZTEST%");
  const ids = (docs ?? []).map((d) => d.id as string);
  if (ids.length) {
    const { data: v } = await supabaseAdmin.from("ia_documento_versiones").select("storage_path").in("documento_id", ids);
    await borrar((v ?? []).map((x) => x.storage_path as string).filter(Boolean));
    await supabaseAdmin.from("ia_documento_fragmentos").delete().in("documento_id", ids);
    await supabaseAdmin.from("ia_documento_versiones").delete().in("documento_id", ids);
    await supabaseAdmin.from("ia_documentos").delete().in("id", ids);
  }
  const { data: convs } = await supabaseAdmin.from("ia_conversaciones").select("id").eq("owner", OWNER);
  const cids = (convs ?? []).map((c) => c.id as string);
  if (cids.length) {
    const { data: adj } = await supabaseAdmin.from("ia_adjuntos_conversacion").select("storage_path").in("conversacion_id", cids);
    await borrar((adj ?? []).map((a) => a.storage_path as string).filter(Boolean));
    const { data: ej } = await supabaseAdmin.from("ia_ejecuciones").select("id").in("conversacion_id", cids);
    if ((ej ?? []).length) await supabaseAdmin.from("ia_herramientas_ejecuciones").delete().in("ejecucion_id", (ej ?? []).map((e) => e.id as string));
    await supabaseAdmin.from("ia_ejecuciones").delete().in("conversacion_id", cids);
    await supabaseAdmin.from("ia_conversaciones").delete().in("id", cids);
  }
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_conocimiento_categorias").delete().ilike("nombre", "ZZTEST%");
}

async function main() {
  await limpiar();
  const preg = "¿Qué código de verificación, palabra secreta, hora de prueba, color del casco y responsable ficticia aparecen en el documento de prueba OCR ZZTEST?";
  try {
    // ── Documento de conocimiento activo (con los 5 datos) ─────────────────────
    const cat = await crearCategoria("ZZTEST_CAT"); const catId = cat.ok ? cat.categoria.id as string : null;
    const doc = await crearDocumento({ buf: enc(CONTENIDO), nombre: "prueba.txt", titulo: "ZZTEST Documento prueba OCR", categoriaId: catId, descripcion: null, vigenciaDesde: null, vigenciaHasta: null, actor: OWNER });
    assert.ok(doc.ok, "documento creado"); if (!doc.ok) return;
    assert.ok((await activarVersion(doc.documentoId, doc.versionId)).ok, "activado");

    // ── FTS OR: la pregunta natural COMPLETA encuentra el documento ────────────
    const hits = await buscarConocimiento({ consulta: preg });
    const hit = hits.find((h) => h.documento_id === doc.documentoId);
    assert.ok(hit, "la pregunta natural completa recupera el documento (FTS OR)");
    assert.equal(hit!.version_numero, 1, "cita versión 1");
    // Sin coincidencias → 0 (no se inventan resultados).
    assert.equal((await buscarConocimiento({ consulta: "xyzptr no existe nada" })).length, 0, "sin coincidencias → 0");

    // ── Recuperación GLOBAL determinística en una conversación NUEVA ───────────
    const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id, titulo").single();
    const r = await correrChat({ owner: OWNER, conversacionId: conv!.id, pregunta: preg, idempotencyKey: "k1" });
    assert.ok(r.ok, "chat ok"); if (!r.ok) return;
    // La búsqueda previa (server-side, sin que el modelo decida) encontró y citó el documento.
    const fuentes = r.fuentes as Array<{ modulo: string }>;
    assert.ok(fuentes.some((f) => f.modulo.includes("ZZTEST Documento prueba OCR") && f.modulo.includes("versión 1")), "la respuesta cita el documento (búsqueda previa)");
    // Auditoría de la búsqueda previa.
    const { data: ej } = await supabaseAdmin.from("ia_ejecuciones").select("busqueda_previa").eq("conversacion_id", conv!.id).single();
    const bp = ej!.busqueda_previa as { coincidencias: number; documentos: string[] };
    assert.ok(bp.coincidencias >= 1 && bp.documentos.includes(doc.documentoId), "auditó la búsqueda previa con el documento");

    // ── Irrelevante → no se inyecta conocimiento ───────────────────────────────
    const { data: conv2 } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id").single();
    const r2 = await correrChat({ owner: OWNER, conversacionId: conv2!.id, pregunta: "hola, todo bien?", idempotencyKey: "k2" });
    assert.ok(r2.ok, "chat 2 ok"); if (!r2.ok) return;
    const { data: ej2 } = await supabaseAdmin.from("ia_ejecuciones").select("busqueda_previa").eq("conversacion_id", conv2!.id).single();
    assert.equal((ej2!.busqueda_previa as { coincidencias: number }).coincidencias, 0, "pregunta irrelevante → 0 coincidencias, nada inyectado");

    // ── Categoría: default General al promover sin categoría ───────────────────
    const { data: conv3 } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id").single();
    const adj = await crearAdjunto({ conversacionId: conv3!.id, buf: enc("ZZTEST nota: apertura 10 hs."), nombreOriginal: "nota.txt", actor: OWNER });
    assert.ok(adj.ok, "adjunto"); if (!adj.ok) return;
    const prom = await promoverAdjunto({ adjuntoId: adj.adjunto.id as string, titulo: "ZZTEST Promovido sin cat", categoriaId: null, descripcion: null, contenido: "apertura 10 hs", vigenciaDesde: null, vigenciaHasta: null, actor: OWNER });
    assert.ok(prom.ok, "promoción sin categoría → default"); if (!prom.ok) return;
    const { data: gen } = await supabaseAdmin.from("ia_conocimiento_categorias").select("id").eq("nombre_norm", "general").single();
    const { data: dp } = await supabaseAdmin.from("ia_documentos").select("categoria_id").eq("id", prom.documentoId).single();
    assert.equal(dp!.categoria_id, gen!.id, "promoción sin categoría → General");

    // ── Categoría archivada / inexistente rechazadas ──────────────────────────
    const catArch = await crearCategoria("ZZTEST_ARCH"); const catArchId = catArch.ok ? catArch.categoria.id as string : "";
    await actualizarCategoria(catArchId, { estado: "archivada" });
    const promArch = await promoverAdjunto({ adjuntoId: adj.adjunto.id as string, titulo: "x", categoriaId: catArchId, descripcion: null, contenido: "x", vigenciaDesde: null, vigenciaHasta: null, actor: OWNER });
    assert.ok(!promArch.ok, "categoría archivada rechazada");
    const docInex = await crearDocumento({ buf: enc("x"), nombre: "x.txt", titulo: "ZZTEST inex", categoriaId: "00000000-0000-0000-0000-000000000000", descripcion: null, vigenciaDesde: null, vigenciaHasta: null, actor: OWNER });
    assert.ok(!docInex.ok, "categoría inexistente rechazada");

    // ── Conteo de General refleja los activos ─────────────────────────────────
    assert.ok((await listarCategorias()).find((c) => c.nombre === "General")!.documentos_activos >= 1, "conteo General ≥ 1");

    // ── Atomicidad: versión sin contenido no se activa ────────────────────────
    const vac = await crearDocumento({ buf: new Uint8Array([1, 2, 3, 4]), nombre: "raro.bin", titulo: "ZZTEST vacio", categoriaId: catId, descripcion: null, vigenciaDesde: null, vigenciaHasta: null, actor: OWNER });
    if (vac.ok) {
      const act = await activarVersion(vac.documentoId, vac.versionId);
      assert.ok(!act.ok, "no se activa una versión sin contenido utilizable");
    }

    console.log("✔ recuperacionGlobal.integration OK (FTS OR encuentra pregunta natural; recuperación previa determinística cita el documento en conversación nueva; irrelevante no inyecta; categoría default General / archivada+inexistente rechazadas / conteo; atomicidad sin contenido)");
  } finally { await limpiar(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
