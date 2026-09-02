// IA SIM · Bloque 4C — Orquestación server-side de informes. El modelo NUNCA toca
// Supabase/Storage: solo propone un spec validado (herramienta preparar_informe) y el
// SERVIDOR crea/edita/confirma/genera. Borrador → edición (persistida, auditada) →
// confirmación (revalida, reconcilia, congela snapshot) → generación determinística de
// todos los formatos desde ESE snapshot → archivos adjuntos a la conversación.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarInforme, type InformeSpec } from "@/lib/ia/informes/schema";
import { getLimitesInforme, FORMATOS_VALIDOS, type FormatoArchivo } from "@/lib/ia/informes/limites";
import { reconciliar } from "@/lib/ia/informes/reconciliacion";
import { renderFormato } from "@/lib/ia/informes/render/index";
import { nombreDescargaAmigable, mimeDe } from "@/lib/ia/informes/nombreArchivo";
import { rutaArchivo, subirArchivo, urlFirmadaArchivo, borrarArchivos, sha256 } from "@/lib/ia/informes/storage";
import type { Requisitos } from "@/lib/ia/informes/requisitos";
import { evaluarIntegridad } from "@/lib/ia/informes/integridad";
import { completarInformeMetricas, armarDesde, type DatosMetricas, type MetaInforme } from "@/lib/ia/informes/completar";

const TZ = "America/Argentina/Cordoba";
function ahoraCordoba(): string {
  const d = new Date();
  const fecha = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const hora = d.toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fecha} ${hora} (Córdoba)`;
}
function hashSpec(spec: InformeSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

type Fail = { ok: false; status: number; error: string; detalle?: unknown };
async function historial(informeId: string, versionId: string | null, accion: string, actor: string, detalle?: unknown) {
  await supabaseAdmin.from("ia_informe_historial").insert({ informe_id: informeId, version_id: versionId, accion, actor, detalle: detalle ?? null });
}

// ── Crear borrador (llamado por el SERVIDOR desde el flujo de chat) ───────────
// Idempotente por (conversación, mensaje de usuario): reintentos/refresh/doble clic
// reutilizan el borrador existente en vez de duplicarlo. NO consume Claude.
export async function crearBorrador(p: {
  conversacionId: string; owner: string; ejecucionId: string | null; mensajeUsuarioId?: string | null; specRaw: unknown; snapshotFuentes: unknown[];
  requisitos?: Requisitos | null;
}): Promise<{ ok: true; informeId: string; versionId: string; version: number; reutilizado?: boolean } | Fail> {
  // Idempotencia: si ya hay un borrador ACTIVO para este mensaje, reutilizarlo.
  if (p.mensajeUsuarioId) {
    const { data: existente } = await supabaseAdmin.from("ia_informes")
      .select("id, version_actual").eq("conversacion_id", p.conversacionId).eq("mensaje_usuario_id", p.mensajeUsuarioId)
      .not("estado", "in", "(descartado,papelera,eliminado)").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existente) {
      const { data: ver } = await supabaseAdmin.from("ia_informe_versiones").select("id, version").eq("informe_id", existente.id).order("version", { ascending: false }).limit(1).maybeSingle();
      return { ok: true, informeId: existente.id as string, versionId: (ver?.id as string) ?? "", version: (ver?.version as number) ?? 1, reutilizado: true };
    }
  }
  const val = validarInforme(p.specRaw);
  if (!val.ok) return { ok: false, status: 400, error: "El borrador no pasó la validación.", detalle: val.errores };
  const spec = val.spec;

  const { data: inf, error: e1 } = await supabaseAdmin.from("ia_informes").insert({
    conversacion_id: p.conversacionId, owner: p.owner, ejecucion_id: p.ejecucionId, mensaje_usuario_id: p.mensajeUsuarioId ?? null,
    titulo: spec.titulo, tipo_informe: spec.tipo_informe, periodo: spec.periodo, incluye_pii: spec.incluye_pii, estado: "borrador", version_actual: 1,
    requisitos: p.requisitos ?? null,
  }).select("id").single();
  if (e1 || !inf) {
    // Carrera con el índice único (conv, mensaje): reutilizar el que quedó.
    if (p.mensajeUsuarioId && (e1 as { code?: string } | null)?.code === "23505") {
      const { data: ya } = await supabaseAdmin.from("ia_informes").select("id, version_actual").eq("conversacion_id", p.conversacionId).eq("mensaje_usuario_id", p.mensajeUsuarioId).not("estado", "in", "(descartado,papelera,eliminado)").maybeSingle();
      if (ya) { const { data: ver } = await supabaseAdmin.from("ia_informe_versiones").select("id, version").eq("informe_id", ya.id).order("version", { ascending: false }).limit(1).maybeSingle(); return { ok: true, informeId: ya.id as string, versionId: (ver?.id as string) ?? "", version: (ver?.version as number) ?? 1, reutilizado: true }; }
    }
    return { ok: false, status: 500, error: "No se pudo crear el informe." };
  }

  // Formatos seleccionados por defecto = los solicitados; si no se pidió ninguno, PDF.
  const formatosSel = (p.requisitos?.formatos?.length ? p.requisitos.formatos : ["pdf"]) as FormatoArchivo[];
  const { data: ver, error: e2 } = await supabaseAdmin.from("ia_informe_versiones").insert({
    informe_id: inf.id, version: 1, spec, hash: hashSpec(spec), snapshot_fuentes: p.snapshotFuentes, fecha_corte: spec.fecha_corte, actor: p.owner, estado: "borrador", formatos: formatosSel,
  }).select("id").single();
  if (e2 || !ver) return { ok: false, status: 500, error: "No se pudo crear la versión." };

  if (spec.fuentes.length > 0) {
    await supabaseAdmin.from("ia_informe_fuentes").insert(spec.fuentes.map((f) => ({ version_id: ver.id, modulo: f.modulo, periodo: f.periodo, registros: f.registros, actualizado: f.actualizado })));
  }
  await historial(inf.id, ver.id, "crear_borrador", p.owner, { titulo: spec.titulo });
  return { ok: true, informeId: inf.id, versionId: ver.id, version: 1 };
}

// ── Cargar informe + versión actual (con validación de propiedad) ────────────
async function cargar(informeId: string, owner: string) {
  const { data: inf } = await supabaseAdmin.from("ia_informes").select("*").eq("id", informeId).maybeSingle();
  if (!inf || inf.owner !== owner) return null;
  const { data: ver } = await supabaseAdmin.from("ia_informe_versiones").select("*").eq("informe_id", informeId).eq("version", inf.version_actual).maybeSingle();
  return { inf, ver };
}

// ── Listar informes de una conversación (para la UI al recargar) ─────────────
export async function listarPorConversacion(conversacionId: string, owner: string): Promise<{ ok: true; informes: unknown[] }> {
  const { data } = await supabaseAdmin.from("ia_informes")
    .select("id, titulo, tipo_informe, periodo, estado, version_actual, incluye_pii, updated_at")
    .eq("conversacion_id", conversacionId).eq("owner", owner)
    .not("estado", "in", "(papelera,eliminado,descartado)")
    .order("updated_at", { ascending: false }).limit(50);
  return { ok: true, informes: data ?? [] };
}

// ── Vista previa (con requisitos, integridad y formatos seleccionados) ────────
export async function obtenerPreview(informeId: string, owner: string): Promise<{ ok: true; informe: unknown; version: unknown; spec: InformeSpec; reconciliacion: unknown; archivos: unknown[]; requisitos: Requisitos | null; formatos_seleccionados: FormatoArchivo[]; integridad: unknown } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };
  const spec = c.ver.spec as InformeSpec;
  const rec = reconciliar(spec, (c.ver.snapshot_fuentes as unknown[]) ?? []);
  const { count: nFuentes } = await supabaseAdmin.from("ia_informe_fuentes").select("id", { count: "exact", head: true }).eq("version_id", c.ver.id);
  const { data: archivos } = await supabaseAdmin.from("ia_archivos_generados").select("id, formato, nombre_descarga, mime, tamano_bytes, hash_sha256, incluye_pii, estado, created_at, version_id").eq("informe_id", informeId).order("created_at", { ascending: true });
  const requisitos = (c.inf.requisitos as Requisitos | null) ?? null;
  const formatos_seleccionados = ((c.ver.formatos as FormatoArchivo[] | null) ?? (requisitos?.formatos?.length ? requisitos.formatos : ["pdf"])) as FormatoArchivo[];
  const integridad = requisitos
    ? evaluarIntegridad({ spec, requisitos, formatosSeleccionados: formatos_seleccionados, fuentesVinculadas: nFuentes ?? 0, reconciliacion: rec })
    : null;
  return {
    ok: true,
    informe: { id: c.inf.id, titulo: c.inf.titulo, tipo_informe: c.inf.tipo_informe, periodo: c.inf.periodo, estado: c.inf.estado, version_actual: c.inf.version_actual, incluye_pii: c.inf.incluye_pii, conversacion_id: c.inf.conversacion_id },
    version: { id: c.ver.id, version: c.ver.version, estado: c.ver.estado },
    spec, reconciliacion: rec, archivos: archivos ?? [], requisitos, formatos_seleccionados, integridad,
  };
}

// ── Completado DETERMINÍSTICO (sin Claude): crea una NUEVA versión con los componentes
// faltantes construidos desde el snapshot real de las herramientas. Conserva la versión previa.
export async function completarBorrador(informeId: string, owner: string): Promise<{ ok: true; version: number; agregados: string[] } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };
  if (["papelera", "eliminado", "descartado"].includes(c.inf.estado as string)) return { ok: false, status: 409, error: "El informe no admite completado en su estado actual." };
  const requisitos = (c.inf.requisitos as Requisitos | null) ?? { componentes: [], formatos: [] };
  const specBase = validarInforme(c.ver.spec);
  if (!specBase.ok) return { ok: false, status: 400, error: "El borrador no es válido." };

  // Idempotencia: si la versión actual ya cubre los componentes completables solicitados,
  // NO crear otra versión (doble clic / reintento no duplican).
  const { count: nF } = await supabaseAdmin.from("ia_informe_fuentes").select("id", { count: "exact", head: true }).eq("version_id", c.ver.id);
  const integActual = evaluarIntegridad({ spec: specBase.spec, requisitos, formatosSeleccionados: (c.ver.formatos as FormatoArchivo[]) ?? [], fuentesVinculadas: nF ?? 0 });
  const completablesFaltantes = integActual.faltantes.filter((f) => ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"].includes(f));
  if (completablesFaltantes.length === 0) {
    return { ok: true, version: c.ver.version as number, agregados: [] };
  }

  // Determinar anio/mes + integrante desde la ejecución que originó el informe.
  const ctx = await contextoMetricas(c.inf.ejecucion_id as string | null, c.inf.mensaje_usuario_id as string | null, c.inf.titulo as string);
  if (!ctx) return { ok: false, status: 422, error: "No hay datos de métricas de un integrante para completar automáticamente. Falta el snapshot de consultar_metricas_equipo.", detalle: { faltante: "snapshot_metricas_equipo" } };

  const comp = await completarInformeMetricas({ specBase: specBase.spec, anio: ctx.anio, mes: ctx.mes, nombreIntegrante: ctx.integrante, componentesRequeridos: requisitos.componentes });
  if (!comp.ok) return { ok: false, status: 422, error: comp.motivo, detalle: { faltan: comp.faltan } };

  // Nueva versión (no sobrescribe). formatos = solicitados (o los actuales).
  const version = (c.ver.version as number) + 1;
  const formatos = (requisitos.formatos?.length ? requisitos.formatos : ((c.ver.formatos as FormatoArchivo[] | null) ?? ["pdf"]));
  const { data: nv, error } = await supabaseAdmin.from("ia_informe_versiones").insert({
    informe_id: informeId, version, spec: comp.spec, hash: hashSpec(comp.spec), snapshot_fuentes: comp.snapshotFull, fecha_corte: comp.spec.fecha_corte, actor: owner, estado: "borrador", formatos, ediciones_manuales: null,
  }).select("id").single();
  if (error || !nv) return { ok: false, status: 500, error: "No se pudo crear la versión completada." };
  await supabaseAdmin.from("ia_informes").update({ version_actual: version, estado: "borrador", updated_at: new Date().toISOString() }).eq("id", informeId);
  // Vincular fuentes (auto).
  if (comp.spec.fuentes.length > 0) await supabaseAdmin.from("ia_informe_fuentes").insert(comp.spec.fuentes.map((f) => ({ version_id: nv.id, modulo: f.modulo, periodo: f.periodo, registros: f.registros, actualizado: f.actualizado, herramienta: "consultar_metricas_equipo" })));
  await historial(informeId, nv.id, "completar_deterministico", owner, { agregados: comp.agregados, integrante: ctx.integrante, periodo: `${ctx.anio}-${String(ctx.mes).padStart(2, "0")}`, sin_consumo_ia: true, version_anterior: c.ver.version, version_nueva: version });
  return { ok: true, version, agregados: comp.agregados };
}

// Detecta {anio, mes, integrante} para el completado, desde la ejecución y el pedido.
const NOMBRES_EQUIPO: Array<{ re: RegExp; nombre: string }> = [
  { re: /\bfede(rico)?\b/i, nombre: "Federico" }, { re: /\bfran(cisco)?\b/i, nombre: "Francisco" }, { re: /\bram(iro|i)\b/i, nombre: "Ramiro" },
];
// Sujeto (integrante) del informe, para el nombre de descarga amigable. Sin PII sensible.
function detectarSujeto(texto: string | null | undefined): string | null {
  return NOMBRES_EQUIPO.find((n) => n.re.test(texto ?? ""))?.nombre ?? null;
}
async function contextoMetricas(ejecucionId: string | null, mensajeUsuarioId: string | null, titulo: string): Promise<{ anio: number; mes: number; integrante: string } | null> {
  let anio: number | undefined, mes: number | undefined;
  if (ejecucionId) {
    const { data: he } = await supabaseAdmin.from("ia_herramientas_ejecuciones").select("herramienta, params").eq("ejecucion_id", ejecucionId).eq("herramienta", "consultar_metricas_equipo");
    const params = (he ?? []).map((x) => x.params as { anio?: number; mes?: number }).find((x) => x?.anio && x?.mes);
    if (params) { anio = Number(params.anio); mes = Number(params.mes); }
  }
  // Integrante: del pedido del usuario o del título.
  let texto = titulo;
  if (mensajeUsuarioId) { const { data: msg } = await supabaseAdmin.from("ia_mensajes").select("contenido").eq("id", mensajeUsuarioId).maybeSingle(); if (msg?.contenido) texto = `${msg.contenido} ${titulo}`; }
  const integrante = NOMBRES_EQUIPO.find((n) => n.re.test(texto))?.nombre;
  if (!anio || !mes || !integrante) return null;
  return { anio, mes, integrante };
}

// ── Editar borrador (persistente + auditado). Si la versión ya está generada,
// crea una NUEVA versión (no sobrescribe). ───────────────────────────────────
export async function editarBorrador(informeId: string, owner: string, specRaw: unknown): Promise<{ ok: true; versionId: string; version: number } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };
  if (["papelera", "eliminado", "descartado"].includes(c.inf.estado as string)) return { ok: false, status: 409, error: "El informe no admite edición en su estado actual." };
  const val = validarInforme(specRaw);
  if (!val.ok) return { ok: false, status: 400, error: "El borrador no pasó la validación.", detalle: val.errores };
  const spec = val.spec;
  const specAnterior = c.ver.spec as InformeSpec;

  let versionId = c.ver.id as string;
  let version = c.ver.version as number;
  if (c.ver.estado !== "borrador") {
    // Nueva versión editable copiando el snapshot de fuentes de la anterior.
    version = version + 1;
    const { data: nv, error } = await supabaseAdmin.from("ia_informe_versiones").insert({
      informe_id: informeId, version, spec, hash: hashSpec(spec), snapshot_fuentes: c.ver.snapshot_fuentes, fecha_corte: spec.fecha_corte, actor: owner, estado: "borrador", ediciones_manuales: spec.cambios_manuales,
    }).select("id").single();
    if (error || !nv) return { ok: false, status: 500, error: "No se pudo crear la nueva versión." };
    versionId = nv.id;
    await supabaseAdmin.from("ia_informes").update({ version_actual: version, estado: "borrador", titulo: spec.titulo, updated_at: new Date().toISOString() }).eq("id", informeId);
  } else {
    await supabaseAdmin.from("ia_informe_versiones").update({ spec, hash: hashSpec(spec), fecha_corte: spec.fecha_corte, ediciones_manuales: spec.cambios_manuales }).eq("id", versionId);
    await supabaseAdmin.from("ia_informes").update({ titulo: spec.titulo, incluye_pii: spec.incluye_pii, updated_at: new Date().toISOString() }).eq("id", informeId);
    // Refrescar fuentes.
    await supabaseAdmin.from("ia_informe_fuentes").delete().eq("version_id", versionId);
    if (spec.fuentes.length > 0) await supabaseAdmin.from("ia_informe_fuentes").insert(spec.fuentes.map((f) => ({ version_id: versionId, modulo: f.modulo, periodo: f.periodo, registros: f.registros, actualizado: f.actualizado })));
  }
  await historial(informeId, versionId, "editar", owner, { antes: recortarSpec(specAnterior), despues: recortarSpec(spec), cambios_manuales: spec.cambios_manuales });
  return { ok: true, versionId, version };
}

// Persistir la selección de formatos en la versión actual (se restaura al recargar).
export async function actualizarFormatos(informeId: string, owner: string, formatos: string[]): Promise<{ ok: true } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };
  const fs = [...new Set(formatos)].filter((f): f is FormatoArchivo => (FORMATOS_VALIDOS as readonly string[]).includes(f));
  await supabaseAdmin.from("ia_informe_versiones").update({ formatos: fs }).eq("id", c.ver.id);
  return { ok: true };
}

// Snapshot compacto para el historial (evita jsonb gigantes).
function recortarSpec(s: InformeSpec) {
  return { titulo: s.titulo, resumen_ejecutivo: s.resumen_ejecutivo.slice(0, 500), tablas: s.tablas.map((t) => ({ titulo: t.titulo, filas: t.filas.length })), graficos: s.graficos.map((g) => g.titulo), incluye_pii: s.incluye_pii };
}

// ── Confirmar y generar (idempotente, con lock y reconciliación bloqueante) ──
export async function confirmarYGenerar(p: { informeId: string; owner: string; formatos: string[]; idempotencyKey?: string | null; confirmarPii?: boolean; confirmarManuales?: boolean }): Promise<
  { ok: true; version: number; archivos: Array<{ id: string; formato: string; nombre_descarga: string; mime: string; tamano_bytes: number; hash_sha256: string }>; reconciliacion: unknown } | Fail
> {
  const lim = getLimitesInforme();
  const c = await cargar(p.informeId, p.owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };

  // Conversación válida y activa (revalidar propiedad).
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").select("owner, estado").eq("id", c.inf.conversacion_id).maybeSingle();
  if (!conv || conv.owner !== p.owner) return { ok: false, status: 404, error: "Conversación no encontrada." };
  if (conv.estado !== "activa") return { ok: false, status: 409, error: "La conversación no está activa." };

  const formatos = [...new Set(p.formatos)].filter((f): f is FormatoArchivo => (FORMATOS_VALIDOS as readonly string[]).includes(f));
  if (formatos.length === 0) return { ok: false, status: 400, error: "Elegí al menos un formato válido." };
  if (formatos.length > lim.formatosPorConfirmacion) return { ok: false, status: 400, error: `Máximo ${lim.formatosPorConfirmacion} formatos por confirmación.` };
  // Persistir la selección de formatos en la versión (se restaura al recargar).
  await supabaseAdmin.from("ia_informe_versiones").update({ formatos }).eq("id", c.ver.id);

  const spec = validarInforme(c.ver.spec);
  if (!spec.ok) return { ok: false, status: 400, error: "El borrador no es válido.", detalle: spec.errores };
  if (spec.spec.incluye_pii && !p.confirmarPii) return { ok: false, status: 428, error: "El informe incluye datos personales (PII). Requiere confirmación adicional." };

  // Reconciliación determinística contra el snapshot de herramientas.
  const rec = reconciliar(spec.spec, (c.ver.snapshot_fuentes as unknown[]) ?? []);
  await supabaseAdmin.from("ia_informe_versiones").update({ reconciliacion: rec }).eq("id", c.ver.id);
  if (!rec.ok) return { ok: false, status: 409, error: "El contenido numérico no reconcilia con las fuentes. No se generó el archivo.", detalle: rec };

  // GATE de integridad: si el pedido tenía requisitos, no se genera si faltan componentes
  // solicitados o los formatos pedidos no están seleccionados.
  const requisitos = (c.inf.requisitos as Requisitos | null) ?? null;
  if (requisitos) {
    const { count: nFuentes } = await supabaseAdmin.from("ia_informe_fuentes").select("id", { count: "exact", head: true }).eq("version_id", c.ver.id);
    const integ = evaluarIntegridad({ spec: spec.spec, requisitos, formatosSeleccionados: formatos, fuentesVinculadas: nFuentes ?? 0, reconciliacion: rec });
    if (integ.estado !== "completo") {
      return { ok: false, status: 409, error: "El informe no cumple todo lo solicitado; no se puede generar.", detalle: { integridad: integ } };
    }
  }
  if (spec.spec.cambios_manuales.length > 0 && !p.confirmarManuales) return { ok: false, status: 428, error: "El informe tiene valores modificados manualmente. Requiere confirmación adicional.", detalle: { cambios_manuales: spec.spec.cambios_manuales } };

  // Idempotencia / lock de concurrencia.
  const { data: lockData } = await supabaseAdmin.rpc("ia_informe_lock_generacion", { p_version_id: c.ver.id });
  const lock = String(lockData ?? "");
  if (lock === "generando") return { ok: false, status: 409, error: "El informe se está generando en este momento." };
  if (lock === "generado") {
    const { data: existentes } = await supabaseAdmin.from("ia_archivos_generados").select("id, formato, nombre_descarga, mime, tamano_bytes, hash_sha256").eq("version_id", c.ver.id).eq("estado", "ok");
    return { ok: true, version: c.ver.version, archivos: (existentes ?? []) as never, reconciliacion: rec };
  }
  if (lock !== "lock_ok") return { ok: false, status: 409, error: "El borrador no está en un estado generable." };

  // Congelar snapshot y RENDER TODO en memoria antes de tocar Storage (sin estado parcial).
  const ctx = { spec: spec.spec, generadoISO: ahoraCordoba(), version: c.ver.version as number };
  const buffers: Array<{ formato: FormatoArchivo; buf: Buffer }> = [];
  try {
    for (const f of formatos) {
      const buf = await renderFormato(f, ctx);
      if (buf.length > lim.tamanoArchivoBytes) throw new Error(`El archivo ${f} supera ${Math.round(lim.tamanoArchivoBytes / 1024 / 1024)} MB. Dividí el informe o generá un CSV/Excel complementario.`);
      buffers.push({ formato: f, buf });
    }
  } catch (e) {
    // Falla de render: liberar el lock (volver a borrador), sin archivos parciales.
    await supabaseAdmin.from("ia_informe_versiones").update({ estado: "borrador" }).eq("id", c.ver.id);
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "No se pudo generar el archivo." };
  }

  // Subir + registrar (upsert por versión+formato → idempotente ante reintentos).
  const archivos: Array<{ id: string; formato: string; nombre_descarga: string; mime: string; tamano_bytes: number; hash_sha256: string }> = [];
  const subidos: string[] = [];
  try {
    for (const { formato, buf } of buffers) {
      const path = rutaArchivo(c.inf.conversacion_id, p.informeId, ctx.version, formato);
      const up = await subirArchivo(path, new Uint8Array(buf), mimeDe(formato));
      if (!up.ok) throw new Error("No se pudo subir el archivo.");
      subidos.push(path);
      const nombre = nombreDescargaAmigable({ tipoInforme: spec.spec.tipo_informe, sujeto: detectarSujeto(c.inf.titulo as string), periodo: spec.spec.periodo, version: ctx.version, formato });
      const { data: reg, error } = await supabaseAdmin.from("ia_archivos_generados").upsert({
        version_id: c.ver.id, informe_id: p.informeId, formato, storage_path: path, nombre_descarga: nombre, mime: mimeDe(formato), tamano_bytes: buf.length, hash_sha256: sha256(new Uint8Array(buf)), incluye_pii: spec.spec.incluye_pii, estado: "ok",
      }, { onConflict: "version_id,formato" }).select("id, formato, nombre_descarga, mime, tamano_bytes, hash_sha256").single();
      if (error || !reg) throw new Error("No se pudo registrar el archivo.");
      archivos.push(reg as never);
    }
  } catch (e) {
    // Error al persistir: limpiar lo subido y volver a borrador (sin inconsistencia).
    await borrarArchivos(subidos);
    await supabaseAdmin.from("ia_informe_versiones").update({ estado: "borrador" }).eq("id", c.ver.id);
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "No se pudo generar el archivo." };
  }

  await supabaseAdmin.from("ia_informe_versiones").update({ estado: "generado" }).eq("id", c.ver.id);
  await supabaseAdmin.from("ia_informes").update({ estado: "generado", updated_at: new Date().toISOString() }).eq("id", p.informeId);
  await historial(p.informeId, c.ver.id, "generar", p.owner, { formatos, generadoISO: ctx.generadoISO, incluye_pii: spec.spec.incluye_pii, cambios_manuales: spec.spec.cambios_manuales.length });
  return { ok: true, version: ctx.version, archivos, reconciliacion: rec };
}

// ── Reparación de RENDERIZADO (4C.3): v2 → v3 desde el snapshot CONGELADO ─────
// NO re-ejecuta consultar_metricas_equipo, NO consume Claude, NO altera datos de negocio.
// Usa exclusivamente el snapshot congelado de la versión origen (misma data, mismos números)
// y sólo corrige presentación: corte único, PDF/Excel profesionales, conclusiones
// determinísticas, nombres amigables. Conserva la v2 y sus archivos. Idempotente
// (correr dos veces NO crea v4 ni duplica archivos/historial).
type Cronograma = { estado?: string | null; dias?: number | null; cerrados?: number | null };
function cronogramaDesdeMetodologia(metodologia: string | null | undefined): Cronograma {
  const m = /estado\s+(\w+)(?:\s*\((\d+)\s*d[ií]as,\s*(\d+)\s*cerrados\))?/i.exec(metodologia ?? "");
  if (!m) return { estado: "confirmado", dias: null, cerrados: null };
  return { estado: m[1] ?? "confirmado", dias: m[2] != null ? Number(m[2]) : null, cerrados: m[3] != null ? Number(m[3]) : null };
}

type ResultadoReparacion = { ok: true; version: number; yaExistia: boolean; archivos: Array<{ id: string; formato: string; nombre_descarga: string; mime: string; tamano_bytes: number; hash_sha256: string }> } | Fail;

// Reparación genérica de renderizado: crea la siguiente versión desde el snapshot CONGELADO
// de la versión actual (misma data/números; sin re-ejecutar métricas ni llamar a Claude),
// re-arma los componentes determinísticos (conclusiones/metodología/tablas actualizadas) y
// genera PDF+Excel con nombres amigables en rutas nuevas. Idempotente POR ACCIÓN: si ya se
// hizo esta corrección, devuelve la versión existente sin crear otra ni duplicar archivos.
async function repararRenderizado(p: { informeId: string; owner: string }, accion: string, detalleExtra: Record<string, unknown>): Promise<ResultadoReparacion> {
  const c = await cargar(p.informeId, p.owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };
  if (["papelera", "eliminado", "descartado"].includes(c.inf.estado as string)) return { ok: false, status: 409, error: "El informe no admite reparación en su estado actual." };

  // Idempotencia por acción: si ya se aplicó esta corrección, devolver su versión sin crear otra.
  const { data: hechos } = await supabaseAdmin.from("ia_informe_historial")
    .select("version_id, detalle").eq("informe_id", p.informeId).eq("accion", accion)
    .order("created_at", { ascending: false }).limit(1);
  if (hechos && hechos.length > 0) {
    const versionNueva = Number((hechos[0].detalle as { version_nueva?: number } | null)?.version_nueva ?? c.inf.version_actual);
    const { data: verR } = await supabaseAdmin.from("ia_informe_versiones").select("id").eq("informe_id", p.informeId).eq("version", versionNueva).maybeSingle();
    const { data: archivos } = await supabaseAdmin.from("ia_archivos_generados").select("id, formato, nombre_descarga, mime, tamano_bytes, hash_sha256").eq("version_id", (verR?.id as string) ?? "").eq("estado", "ok");
    return { ok: true, version: versionNueva, yaExistia: true, archivos: (archivos ?? []) as never };
  }

  // Snapshot CONGELADO de la versión origen (la actual).
  const snap = ((c.ver.snapshot_fuentes as Array<{ datos?: DatosMetricas; corte?: string; periodo?: string; integrante?: string; registros?: { stand: number; reservas: number } }>) ?? [])[0];
  if (!snap?.datos || !snap.corte || !snap.periodo) return { ok: false, status: 422, error: "La versión no tiene un snapshot congelado de métricas para reparar.", detalle: { faltante: "snapshot_datos" } };
  const mSem = /(\d{4})-(\d{2})/.exec(snap.periodo);
  if (!mSem) return { ok: false, status: 422, error: "El snapshot no tiene un período válido." };
  const anio = Number(mSem[1]), mes = Number(mSem[2]);
  // Corte único, presentado sin la 'T' ISO ("2026-09-01T23:20" → "2026-09-01 23:20").
  const corte = String(snap.corte).replace("T", " ");

  const specBaseVal = validarInforme(c.ver.spec);
  if (!specBaseVal.ok) return { ok: false, status: 400, error: "La versión origen no es válida." };
  // Forzar conclusiones DETERMINÍSTICAS re-generadas (descartar las de la versión previa).
  const specBase = { ...specBaseVal.spec, conclusiones: [] as string[] };
  const meta: MetaInforme = {
    integrante: snap.integrante || detectarSujeto(c.inf.titulo as string) || "el integrante",
    anio, mes, corte,
    registros: { stand: snap.registros?.stand ?? 0, reservas: snap.registros?.reservas ?? 0 },
    cronograma: cronogramaDesdeMetodologia(specBaseVal.spec.metodologia),
  };
  const requisitos = (c.inf.requisitos as Requisitos | null) ?? { componentes: [], formatos: [] };
  const armado = armarDesde(specBase, snap.datos, meta, requisitos.componentes);
  if (!armado.ok) return { ok: false, status: 422, error: armado.motivo, detalle: { faltan: armado.faltan } };

  // Nueva versión (conserva la origen y todas las anteriores). MISMO snapshot congelado.
  const version = (c.ver.version as number) + 1;
  const formatos = ((c.ver.formatos as FormatoArchivo[] | null) ?? (requisitos.formatos?.length ? requisitos.formatos : ["pdf", "xlsx"])) as FormatoArchivo[];
  const { data: nv, error: eNv } = await supabaseAdmin.from("ia_informe_versiones").insert({
    informe_id: p.informeId, version, spec: armado.spec, hash: hashSpec(armado.spec), snapshot_fuentes: c.ver.snapshot_fuentes,
    fecha_corte: armado.spec.fecha_corte, actor: p.owner, estado: "borrador", formatos, ediciones_manuales: null,
  }).select("id").single();
  if (eNv || !nv) return { ok: false, status: 500, error: `No se pudo crear la versión v${version}.` };
  await supabaseAdmin.from("ia_informes").update({ version_actual: version, estado: "borrador", updated_at: new Date().toISOString() }).eq("id", p.informeId);
  if (armado.spec.fuentes.length > 0) await supabaseAdmin.from("ia_informe_fuentes").insert(armado.spec.fuentes.map((f) => ({ version_id: nv.id, modulo: f.modulo, periodo: f.periodo, registros: f.registros, actualizado: f.actualizado, herramienta: "consultar_metricas_equipo" })));
  await historial(p.informeId, nv.id, accion, p.owner, {
    version_origen: c.ver.version, version_nueva: version, mismo_snapshot: true, unificacion_corte: corte, sin_consumo_ia: true, ...detalleExtra,
  });

  // Generar los archivos de la nueva versión (nombres amigables + rutas nuevas; no tocan las previas).
  const gen = await confirmarYGenerar({ informeId: p.informeId, owner: p.owner, formatos, confirmarPii: c.inf.incluye_pii as boolean, confirmarManuales: true });
  if (!gen.ok) return gen;
  return { ok: true, version, yaExistia: false, archivos: gen.archivos };
}

// 4C.3 — corrección de renderizado (v2 → v3): corte único, PDF/Excel profesionales,
// conclusiones determinísticas, nombres amigables.
export function repararRenderizadoV3(p: { informeId: string; owner: string }): Promise<ResultadoReparacion> {
  return repararRenderizado(p, "correccion_renderizado", { correccion_pdf: true, correccion_excel: true, conclusiones_deterministicas: true, nombres_amigables: true });
}

// 4C.4 — corrección de portabilidad (v3 → v4): fuente INCRUSTADA (Liberation Sans reg+bold),
// paginación compacta sin títulos huérfanos, tildes correctas, autofiltros del Excel completos.
export function repararPortabilidadV4(p: { informeId: string; owner: string }): Promise<ResultadoReparacion> {
  return repararRenderizado(p, "correccion_portabilidad_pdf", { fuente_incrustada: "Liberation Sans (regular + bold, OFL)", paginacion_corregida: true, tildes_corregidas: true, autofiltros_corregidos: true });
}

// ── Listar versiones ──────────────────────────────────────────────────────────
export async function listarVersiones(informeId: string, owner: string): Promise<{ ok: true; versiones: unknown[] } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c) return { ok: false, status: 404, error: "Informe no encontrado." };
  const { data: vers } = await supabaseAdmin.from("ia_informe_versiones").select("id, version, estado, hash, created_at").eq("informe_id", informeId).order("version", { ascending: false });
  const { data: archivos } = await supabaseAdmin.from("ia_archivos_generados").select("id, version_id, formato, nombre_descarga, tamano_bytes, created_at, estado").eq("informe_id", informeId);
  return { ok: true, versiones: (vers ?? []).map((v) => ({ ...v, archivos: (archivos ?? []).filter((a) => a.version_id === v.id) })) };
}

// ── Descargar: valida propiedad + conversación y emite URL firmada corta ─────
export async function urlDescarga(archivoId: string, owner: string): Promise<{ ok: true; url: string; nombre: string } | Fail> {
  const { data: arch } = await supabaseAdmin.from("ia_archivos_generados").select("id, informe_id, storage_path, nombre_descarga, estado").eq("id", archivoId).maybeSingle();
  if (!arch || arch.estado !== "ok") return { ok: false, status: 404, error: "Archivo no encontrado." };
  const { data: inf } = await supabaseAdmin.from("ia_informes").select("owner, estado").eq("id", arch.informe_id).maybeSingle();
  if (!inf || inf.owner !== owner) return { ok: false, status: 404, error: "Archivo no encontrado." };
  if (inf.estado === "eliminado") return { ok: false, status: 410, error: "El archivo ya no está disponible." };
  const url = await urlFirmadaArchivo(arch.storage_path, arch.nombre_descarga, 60);
  if (!url) return { ok: false, status: 500, error: "No se pudo generar la descarga." };
  return { ok: true, url, nombre: arch.nombre_descarga };
}

// ── Descartar / papelera / restaurar ─────────────────────────────────────────
export async function descartarBorrador(informeId: string, owner: string): Promise<{ ok: true } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c) return { ok: false, status: 404, error: "Informe no encontrado." };
  await supabaseAdmin.from("ia_informes").update({ estado: "descartado", updated_at: new Date().toISOString() }).eq("id", informeId).eq("owner", owner);
  await historial(informeId, c.ver?.id ?? null, "descartar", owner);
  return { ok: true };
}
export async function enviarPapelera(informeId: string, owner: string): Promise<{ ok: true } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c) return { ok: false, status: 404, error: "Informe no encontrado." };
  await supabaseAdmin.from("ia_informes").update({ estado: "papelera", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", informeId).eq("owner", owner);
  await historial(informeId, c.ver?.id ?? null, "papelera", owner);
  return { ok: true };
}
export async function restaurarInforme(informeId: string, owner: string): Promise<{ ok: true } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c) return { ok: false, status: 404, error: "Informe no encontrado." };
  if (c.inf.estado !== "papelera") return { ok: false, status: 409, error: "El informe no está en la papelera." };
  const { count } = await supabaseAdmin.from("ia_archivos_generados").select("id", { count: "exact", head: true }).eq("informe_id", informeId).eq("estado", "ok");
  const estado = (count ?? 0) > 0 ? "generado" : "borrador";
  await supabaseAdmin.from("ia_informes").update({ estado, deleted_at: null, updated_at: new Date().toISOString() }).eq("id", informeId).eq("owner", owner);
  await historial(informeId, c.ver?.id ?? null, "restaurar", owner);
  return { ok: true };
}

// ── Purga definitiva (papelera > N días): borra Storage y luego filas ────────
export async function purgarInformes(dias: number): Promise<{ eliminados: number }> {
  const corte = new Date(Date.now() - dias * 86400000).toISOString();
  const { data: vencidos } = await supabaseAdmin.from("ia_informes").select("id").eq("estado", "papelera").lt("deleted_at", corte);
  const ids = (vencidos ?? []).map((x) => x.id as string);
  if (ids.length > 0) {
    const { data: archs } = await supabaseAdmin.from("ia_archivos_generados").select("storage_path").in("informe_id", ids);
    await borrarArchivos((archs ?? []).map((a) => a.storage_path as string));
  }
  const { data } = await supabaseAdmin.rpc("ia_informes_purgar", { p_dias: dias });
  return { eliminados: Number(data ?? 0) };
}

// Limpieza de Storage de informes cuyas conversaciones se purgan (cascade DB borra filas).
export async function limpiarStorageDeConversaciones(conversacionIds: string[]): Promise<void> {
  if (conversacionIds.length === 0) return;
  const { data: archs } = await supabaseAdmin.from("ia_archivos_generados").select("storage_path, informe_id").in("informe_id",
    (await supabaseAdmin.from("ia_informes").select("id").in("conversacion_id", conversacionIds)).data?.map((x) => x.id as string) ?? []);
  await borrarArchivos((archs ?? []).map((a) => a.storage_path as string));
}
