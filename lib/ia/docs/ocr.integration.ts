process.env.IA_PROVIDER = "fake";
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { analizarArchivoOCR, subPdf } from "@/lib/ia/docs/ocr";
import { FakeVisionProvider } from "@/lib/ia/providerFake";
import { detectar } from "@/lib/ia/docs/deteccion";
import { extraer } from "@/lib/ia/docs/extractors";
import { crearAdjunto, analizarAdjuntoOCR } from "@/lib/ia/docs/adjuntosServer";
import { sha256, borrar } from "@/lib/ia/docs/storage";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

//   npx tsx --env-file=.env.local lib/ia/docs/ocr.integration.ts
const OWNER = "ZZTEST:ocr";
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
// PNG mínimo (magic bytes) — fixture sintético, NO dato de negocio.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(40).fill(0)]);

async function limpiarSha(sha: string) { await supabaseAdmin.from("ia_ocr_resultados").delete().eq("sha256", sha); }
async function limpiar() {
  await supabaseAdmin.from("ia_ocr_resultados").delete().eq("actor", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().in("owner", [OWNER, OWNER + ":lim"]);
  const { data: convs } = await supabaseAdmin.from("ia_conversaciones").select("id").eq("owner", OWNER);
  const cids = (convs ?? []).map((c) => c.id as string);
  if (cids.length) {
    const { data: adj } = await supabaseAdmin.from("ia_adjuntos_conversacion").select("storage_path, sha256").in("conversacion_id", cids);
    await borrar((adj ?? []).map((a) => a.storage_path as string).filter(Boolean));
    for (const a of adj ?? []) if (a.sha256) await limpiarSha(a.sha256 as string);
    await supabaseAdmin.from("ia_conversaciones").delete().in("id", cids);
  }
}

async function main() {
  await limpiar();
  // Snapshot del consumo real del admin de hoy (para restaurarlo al final).
  const { data: snap } = await supabaseAdmin.from("ia_consumo").select("*").eq("owner", IA_OWNER_ADMIN).eq("dia", hoy()).maybeSingle();
  try {
    // ── subPdf: solo las páginas pedidas ────────────────────────────────────
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF(); pdf.text("uno", 10, 10); pdf.addPage(); pdf.text("dos", 10, 10); pdf.addPage(); pdf.text("tres", 10, 10);
    const pdfBuf = new Uint8Array(pdf.output("arraybuffer"));
    const sub = await subPdf(pdfBuf, [2], 3);
    const { PDFDocument } = await import("pdf-lib");
    assert.equal((await PDFDocument.load(sub)).getPageCount(), 1, "subPdf devuelve solo 1 página");
    assert.equal((await subPdf(pdfBuf, [1, 2, 3], 3)).byteLength, pdfBuf.byteLength, "todas las páginas → original");

    // ── analizarArchivoOCR (proveedor de visión guionado, owner ZZTEST) ─────
    const det = detectar(PNG, "foto.png");
    const local = await extraer(PNG, det, { maxPaginas: 10, maxHojas: 10, maxFilas: 10, maxDiapositivas: 10, maxCaracteres: 1000 });
    const sha = sha256(PNG);
    await limpiarSha(sha);

    // OK
    let r = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha, resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "ok", resultado: { texto_detectado: "FACTURA total 5000" } }]), owner: OWNER, actor: OWNER });
    assert.ok(r.ok && r.estado === "listo" && r.texto_detectado.includes("5000"), "OCR ok");
    if (r.ok) assert.ok(r.fragmentos.some((f) => /Imagen \(OCR\)/.test(f.ubicacion)), "fragmento con procedencia OCR");
    const { data: filaOk } = await supabaseAdmin.from("ia_ocr_resultados").select("estado").eq("sha256", sha).eq("estado", "listo");
    assert.equal((filaOk ?? []).length, 1, "1 resultado listo persistido");

    // Idempotencia: reutiliza, no consume de nuevo (proveedor que tiraría error si se llamara).
    r = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha, resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "error", mensaje: "NO DEBERÍA LLAMARSE" }]), owner: OWNER, actor: OWNER });
    assert.ok(r.ok && r.reutilizado, "reutiliza resultado previo (sin nueva llamada)");

    // Reproceso explícito → nueva llamada; sigue habiendo un solo 'listo'.
    r = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha, resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "ok", resultado: { texto_detectado: "reprocesado" } }]), owner: OWNER, actor: OWNER, reprocesar: true });
    assert.ok(r.ok && !r.reutilizado && r.texto_detectado === "reprocesado", "reproceso genera nuevo resultado");
    const { data: listos } = await supabaseAdmin.from("ia_ocr_resultados").select("id").eq("sha256", sha).eq("estado", "listo");
    assert.equal((listos ?? []).length, 1, "sigue habiendo un solo 'listo' tras reproceso");

    // Baja confianza → necesita_revision.
    await limpiarSha(sha);
    r = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha, resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "ok", resultado: { confianza: "baja" } }]), owner: OWNER, actor: OWNER });
    assert.ok(r.ok && r.estado === "necesita_revision", "baja confianza → necesita_revision");

    // Error y timeout → fallo controlado + fila 'error'.
    await limpiarSha(sha);
    r = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha, resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "error", mensaje: "boom" }]), owner: OWNER, actor: OWNER });
    assert.ok(!r.ok, "error del proveedor → fallo");
    r = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha, resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "timeout" }]), owner: OWNER, actor: OWNER });
    assert.ok(!r.ok, "timeout → fallo");

    // Límite diario excedido → 429.
    process.env.IA_SOLICITUDES_DIA = "1";
    const owL = OWNER + ":lim";
    const r1 = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha + "x", resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "ok", resultado: {} }]), owner: owL, actor: owL });
    const r2 = await analizarArchivoOCR({ buf: PNG, nombre: "foto.png", sha256: sha + "y", resultadoLocal: local, provider: new FakeVisionProvider([{ tipo: "ok", resultado: {} }]), owner: owL, actor: owL });
    assert.ok(r1.ok && !r2.ok && r2.status === 429, "límite diario → 429");
    delete process.env.IA_SOLICITUDES_DIA;
    await limpiarSha(sha + "x"); await limpiarSha(sha + "y");
    await supabaseAdmin.from("ia_consumo").delete().eq("owner", owL);

    // ── E2E adjunto: subir NO consume; analizar (fake) consume; idempotente ─
    const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(48).fill(7)]); // sha distinto
    const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id").single();
    const adj = await crearAdjunto({ conversacionId: conv!.id, buf: PNG2, nombreOriginal: "captura.png", actor: OWNER });
    assert.ok(adj.ok, "adjunto creado"); if (!adj.ok) return;
    assert.equal(adj.adjunto.estado_procesamiento, "necesita_ocr", "imagen adjunta → necesita_ocr (SIN consumir la API)");
    const { data: preOcr } = await supabaseAdmin.from("ia_ocr_resultados").select("id").eq("sha256", adj.adjunto.sha256 as string);
    assert.equal((preOcr ?? []).length, 0, "no hay OCR antes de autorizar");

    const oc = await analizarAdjuntoOCR({ adjuntoId: adj.adjunto.id as string });
    assert.ok(oc.ok, "OCR del adjunto ok"); if (!oc.ok) return;
    assert.equal(oc.adjunto.estado_procesamiento, "listo", "adjunto pasa a listo");
    assert.equal(oc.adjunto.metodo_extraccion, "ocr_vision", "método ocr_vision");
    assert.ok((oc.adjunto.ocr_texto_detectado as string).length > 0, "guarda ocr_texto_detectado separado");
    const oc2 = await analizarAdjuntoOCR({ adjuntoId: adj.adjunto.id as string });
    assert.ok(oc2.ok && oc2.ocr.reutilizado, "segundo análisis reutiliza (sin nuevo consumo)");

    console.log("✔ ocr.integration OK (subPdf páginas; OCR ok/baja/errores/timeout/límite; idempotencia+reproceso; adjunto necesita_ocr sin consumo → analiza → listo; reutiliza)");
  } finally {
    await limpiar();
    // Restaurar el consumo real del admin de hoy tal como estaba.
    if (snap) await supabaseAdmin.from("ia_consumo").update({ solicitudes: snap.solicitudes, tokens_in: snap.tokens_in, tokens_out: snap.tokens_out, costo_estimado: snap.costo_estimado }).eq("owner", IA_OWNER_ADMIN).eq("dia", hoy());
    else await supabaseAdmin.from("ia_consumo").delete().eq("owner", IA_OWNER_ADMIN).eq("dia", hoy());
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
