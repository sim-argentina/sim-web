import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearBorrador, editarBorrador, confirmarYGenerar, obtenerPreview, listarVersiones, urlDescarga, enviarPapelera, restaurarInforme, purgarInformes } from "@/lib/ia/informes/informesServer";
import { descargarArchivo, BUCKET_INFORMES } from "@/lib/ia/informes/storage";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/informes/informes.integration.ts
// Datos ZZTEST aislados con limpieza verificada. No toca datos de negocio.

const OWNER = "ZZTEST-informes";

const SNAPSHOT = [{ facturacion_bruta: 150000, comisiones: 8000, facturacion_neta: 142000, turnos: 60 }];
function specValido(extra: Record<string, unknown> = {}) {
  return {
    titulo: "ZZTEST Informe agosto", tipo_informe: "analitico_mensual", periodo: "2026-08", fecha_corte: "2026-08-31",
    resumen_ejecutivo: "Facturación neta $142.000 con 60 turnos.", conclusiones: ["Crecimiento."], hallazgos: [],
    tablas: [{ titulo: "Fin", columnas: [{ clave: "m", etiqueta: "Métrica", tipo: "texto" }, { clave: "v", etiqueta: "Valor", tipo: "ars" }], filas: [["Bruta", 150000], ["Neta", 142000]] }],
    graficos: [{ tipo: "barras", titulo: "Fact", categorias: ["Jul", "Ago"], series: [{ nombre: "Neta", valores: [114000, 142000] }] }],
    fuentes: [{ modulo: "finanzas", periodo: "2026-08", registros: 120 }], modulos_consultados: ["finanzas"], registros_utilizados: 120,
    anexo: [], advertencias: [], datos_faltantes: [], cambios_manuales: [], incluye_pii: false, ...extra,
  };
}

async function limpiar() {
  const { data: infs } = await supabaseAdmin.from("ia_informes").select("id").eq("owner", OWNER);
  const ids = (infs ?? []).map((x) => x.id as string);
  if (ids.length) {
    const { data: archs } = await supabaseAdmin.from("ia_archivos_generados").select("storage_path").in("informe_id", ids);
    const paths = (archs ?? []).map((a) => a.storage_path as string);
    if (paths.length) await supabaseAdmin.storage.from(BUCKET_INFORMES).remove(paths);
    await supabaseAdmin.from("ia_informes").delete().eq("owner", OWNER);
  }
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
}

async function main() {
  await limpiar();
  // Conversación ZZTEST para atar el informe (FK).
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST conv", estado: "activa" }).select("id").single();
  assert.ok(conv?.id, "conversación creada");
  const convId = conv!.id as string;

  try {
    // ── Crear borrador ────────────────────────────────────────────────────────
    const cre = await crearBorrador({ conversacionId: convId, owner: OWNER, ejecucionId: null, specRaw: specValido(), snapshotFuentes: SNAPSHOT });
    assert.ok(cre.ok, "borrador creado");
    if (!cre.ok) return;
    const informeId = cre.informeId;

    let prev = await obtenerPreview(informeId, OWNER);
    assert.ok(prev.ok && prev.spec.titulo === "ZZTEST Informe agosto", "preview con el spec");

    // ── Editar (persistente + auditado) ────────────────────────────────────────
    const ed = await editarBorrador(informeId, OWNER, specValido({ resumen_ejecutivo: "Editado: neta $142.000." }));
    assert.ok(ed.ok, "editado");
    prev = await obtenerPreview(informeId, OWNER);
    assert.ok(prev.ok && prev.spec.resumen_ejecutivo.includes("Editado"), "edición persistida (sobrevive relectura)");
    const { count: nHist } = await supabaseAdmin.from("ia_informe_historial").select("id", { count: "exact", head: true }).eq("informe_id", informeId);
    assert.ok((nHist ?? 0) >= 2, "historial registra crear + editar");

    // ── Reconciliación BLOQUEA: cambio manual con valor_original inexistente ───
    await editarBorrador(informeId, OWNER, specValido({ cambios_manuales: [{ ubicacion: "tabla:Fin/fila 2/col Valor", etiqueta: "Neta", valor_original: 99999, valor_nuevo: 143000, motivo: "x" }] }));
    const bloq = await confirmarYGenerar({ informeId, owner: OWNER, formatos: ["pdf"], confirmarManuales: true });
    assert.equal(bloq.ok, false, "reconciliación bloquea (valor_original inexistente)");
    if (!bloq.ok) assert.equal(bloq.status, 409, "409 por no reconciliar");

    // ── Corregir (valor_original real 142000) y confirmar+generar ──────────────
    await editarBorrador(informeId, OWNER, specValido({ cambios_manuales: [{ ubicacion: "tabla:Fin/fila 2/col Valor", etiqueta: "Neta", valor_original: 142000, valor_nuevo: 143000, motivo: "ajuste" }] }));
    // Gating de cambios manuales.
    const sinConf = await confirmarYGenerar({ informeId, owner: OWNER, formatos: ["pdf", "xlsx", "csv"] });
    assert.equal(sinConf.ok, false, "sin confirmar cambios manuales → bloquea");
    if (!sinConf.ok) assert.equal(sinConf.status, 428, "428 requiere confirmación adicional");

    const gen = await confirmarYGenerar({ informeId, owner: OWNER, formatos: ["pdf", "xlsx", "csv"], confirmarManuales: true });
    assert.ok(gen.ok, "generado");
    if (!gen.ok) return;
    assert.equal(gen.archivos.length, 3, "3 archivos generados desde un snapshot");
    for (const a of gen.archivos) assert.ok(a.hash_sha256.length === 64 && a.tamano_bytes > 0, `${a.formato} con hash y tamaño`);

    // Storage privado: el objeto existe (service role) y hay URL firmada.
    const { data: archRow } = await supabaseAdmin.from("ia_archivos_generados").select("id, storage_path").eq("informe_id", informeId).eq("formato", "pdf").single();
    const buf = await descargarArchivo(archRow!.storage_path as string);
    assert.ok(buf && buf.slice(0, 5).toString("latin1") === "%PDF-", "PDF en Storage privado");
    const dl = await urlDescarga(archRow!.id as string, OWNER);
    assert.ok(dl.ok && dl.url.includes("token"), "URL firmada emitida");
    // Acceso cruzado (otro owner) → 404.
    const cruz = await urlDescarga(archRow!.id as string, "ZZTEST-otro");
    assert.equal(cruz.ok, false, "otro owner no descarga");

    // ── Idempotencia: reconfirmar NO duplica archivos ──────────────────────────
    const gen2 = await confirmarYGenerar({ informeId, owner: OWNER, formatos: ["pdf", "xlsx", "csv"], confirmarManuales: true });
    assert.ok(gen2.ok, "reconfirmación ok (idempotente)");
    const { count: nArch } = await supabaseAdmin.from("ia_archivos_generados").select("id", { count: "exact", head: true }).eq("informe_id", informeId);
    assert.equal(nArch, 3, "sigue habiendo 3 archivos (sin duplicar)");

    // ── Nueva versión sin sobrescribir ─────────────────────────────────────────
    const ed2 = await editarBorrador(informeId, OWNER, specValido({ titulo: "ZZTEST v2", cambios_manuales: [] }));
    assert.ok(ed2.ok && ed2.version === 2, "edición tras generado crea versión 2");
    const vers = await listarVersiones(informeId, OWNER);
    assert.ok(vers.ok && (vers.versiones as unknown[]).length === 2, "2 versiones conservadas");

    // ── Papelera y restauración ────────────────────────────────────────────────
    assert.ok((await enviarPapelera(informeId, OWNER)).ok, "a papelera");
    const { data: enPap } = await supabaseAdmin.from("ia_informes").select("estado").eq("id", informeId).single();
    assert.equal(enPap?.estado, "papelera", "estado papelera");
    assert.ok((await restaurarInforme(informeId, OWNER)).ok, "restaurado");

    // ── Purga (simular vencimiento) ────────────────────────────────────────────
    await supabaseAdmin.from("ia_informes").update({ estado: "papelera", deleted_at: new Date(Date.now() - 40 * 86400000).toISOString() }).eq("id", informeId);
    const carpeta = `informes/${convId}/${informeId}/v1`;
    const antes = await supabaseAdmin.storage.from(BUCKET_INFORMES).list(carpeta);
    assert.ok((antes.data ?? []).length >= 1, "hay objetos en Storage antes de purgar");
    const purga = await purgarInformes(30);
    assert.ok(purga.eliminados >= 1, "purga eliminó el informe vencido");
    const { data: sigue } = await supabaseAdmin.from("ia_informes").select("id").eq("id", informeId).maybeSingle();
    assert.equal(sigue, null, "informe eliminado de la DB");
    // Storage limpiado (list NO usa el caché de download).
    const despues = await supabaseAdmin.storage.from(BUCKET_INFORMES).list(carpeta);
    assert.equal((despues.data ?? []).length, 0, "objetos de Storage purgados");

    console.log("OK — informes.integration (Phase C): borrador→editar(persistido+auditado)→reconciliación bloquea→confirmar/generar 3 formatos (1 snapshot)→Storage privado+URL firmada+acceso cruzado 404→idempotencia sin duplicar→versión 2 sin sobrescribir→papelera/restaurar→purga (DB+Storage).");
  } finally {
    await limpiar();
    const { count } = await supabaseAdmin.from("ia_informes").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    assert.equal(count ?? 0, 0, "limpieza: sin informes ZZTEST");
    console.log("Limpieza ZZTEST verificada.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
