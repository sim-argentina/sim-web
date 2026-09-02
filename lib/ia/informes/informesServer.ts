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
import { nombreDescarga, mimeDe } from "@/lib/ia/informes/nombreArchivo";
import { rutaArchivo, subirArchivo, urlFirmadaArchivo, borrarArchivos, sha256 } from "@/lib/ia/informes/storage";

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
export async function crearBorrador(p: {
  conversacionId: string; owner: string; ejecucionId: string | null; specRaw: unknown; snapshotFuentes: unknown[];
}): Promise<{ ok: true; informeId: string; versionId: string; version: number } | Fail> {
  const val = validarInforme(p.specRaw);
  if (!val.ok) return { ok: false, status: 400, error: "El borrador no pasó la validación.", detalle: val.errores };
  const spec = val.spec;

  const { data: inf, error: e1 } = await supabaseAdmin.from("ia_informes").insert({
    conversacion_id: p.conversacionId, owner: p.owner, ejecucion_id: p.ejecucionId,
    titulo: spec.titulo, tipo_informe: spec.tipo_informe, periodo: spec.periodo, incluye_pii: spec.incluye_pii, estado: "borrador", version_actual: 1,
  }).select("id").single();
  if (e1 || !inf) return { ok: false, status: 500, error: "No se pudo crear el informe." };

  const { data: ver, error: e2 } = await supabaseAdmin.from("ia_informe_versiones").insert({
    informe_id: inf.id, version: 1, spec, hash: hashSpec(spec), snapshot_fuentes: p.snapshotFuentes, fecha_corte: spec.fecha_corte, actor: p.owner, estado: "borrador",
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

// ── Vista previa ──────────────────────────────────────────────────────────────
export async function obtenerPreview(informeId: string, owner: string): Promise<{ ok: true; informe: unknown; version: unknown; spec: InformeSpec; reconciliacion: unknown; archivos: unknown[] } | Fail> {
  const c = await cargar(informeId, owner);
  if (!c || !c.ver) return { ok: false, status: 404, error: "Informe no encontrado." };
  const spec = c.ver.spec as InformeSpec;
  const rec = reconciliar(spec, (c.ver.snapshot_fuentes as unknown[]) ?? []);
  const { data: archivos } = await supabaseAdmin.from("ia_archivos_generados").select("id, formato, nombre_descarga, mime, tamano_bytes, hash_sha256, incluye_pii, estado, created_at, version_id").eq("informe_id", informeId).order("created_at", { ascending: true });
  return { ok: true, informe: { id: c.inf.id, titulo: c.inf.titulo, estado: c.inf.estado, version_actual: c.inf.version_actual, incluye_pii: c.inf.incluye_pii, conversacion_id: c.inf.conversacion_id }, version: { id: c.ver.id, version: c.ver.version, estado: c.ver.estado }, spec, reconciliacion: rec, archivos: archivos ?? [] };
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

  const spec = validarInforme(c.ver.spec);
  if (!spec.ok) return { ok: false, status: 400, error: "El borrador no es válido.", detalle: spec.errores };
  if (spec.spec.incluye_pii && !p.confirmarPii) return { ok: false, status: 428, error: "El informe incluye datos personales (PII). Requiere confirmación adicional." };

  // Reconciliación determinística contra el snapshot de herramientas.
  const rec = reconciliar(spec.spec, (c.ver.snapshot_fuentes as unknown[]) ?? []);
  await supabaseAdmin.from("ia_informe_versiones").update({ reconciliacion: rec }).eq("id", c.ver.id);
  if (!rec.ok) return { ok: false, status: 409, error: "El contenido numérico no reconcilia con las fuentes. No se generó el archivo.", detalle: rec };
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
      const nombre = nombreDescarga({ tipoInforme: spec.spec.tipo_informe, periodo: spec.spec.periodo, version: ctx.version, formato });
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
