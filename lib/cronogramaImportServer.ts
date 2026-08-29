import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarAlias } from "@/lib/empleados";
import { validarDia, type DiaInput } from "@/lib/cronograma";
import { analizarBuffer } from "@/lib/cronogramaPdfExtract";
import { getMesVista } from "@/lib/cronogramaServer";
import type { Incidencia } from "@/lib/cronogramaPdf";

// Capa de servidor de la importación PDF/Canva (server-only). Resuelve alias
// contra empleado_aliases, arma la propuesta editable, detecta conflictos con el
// borrador existente, calcula incidencias bloqueantes y aplica atómicamente vía
// RPC. Nunca confirma el mes.

export type JornadaProp = {
  alias_texto: string;
  empleado_id: string | null;
  hora_inicio: string;
  hora_fin: string;
};
export type DiaProp = {
  fecha: string;
  cerrado: boolean;
  apertura: string;
  cierre: string;
  jornadas: JornadaProp[];
};
export type ClaseConflicto = "sin_cambios" | "solo_pdf" | "solo_borrador" | "diferente";
export type Conflicto = {
  fecha: string;
  clase: ClaseConflicto;
  decision: "pdf" | "actual" | null;
  actual: DiaProp | null;
  pdf: DiaProp | null;
};
export type AliasResuelto = { empleado_id: string | null; nombre: string | null; activo: boolean };
export type Propuesta = {
  mes_estado_actual: "inexistente" | "borrador" | "confirmado";
  aliases: Record<string, AliasResuelto>;
  dias: DiaProp[];
  conflictos: Conflicto[];
};

export type ImportacionRow = {
  id: string;
  anio: number;
  mes: number;
  archivo_nombre: string;
  archivo_tamano: number;
  archivo_hash: string;
  paginas: number | null;
  estado: string;
  bloquea_confirmacion: boolean;
  propuesta: Propuesta | null;
  incidencias: Incidencia[] | null;
  resumen: unknown;
  created_at: string;
  updated_at: string;
};

export type Fail = { ok: false; status: number; error: string };
export type Ok<T> = { ok: true; data: T };

const APERTURA = "10:00";
const CIERRE = "22:00";

// Mapa alias_normalizado → integrante (para resolución).
async function mapaAliases(): Promise<Map<string, { empleado_id: string; nombre: string; activo: boolean }>> {
  const { data, error } = await supabaseAdmin
    .from("empleado_aliases")
    .select("alias_normalizado, empleados ( id, nombre_formal, activo )");
  if (error) throw error;
  const m = new Map<string, { empleado_id: string; nombre: string; activo: boolean }>();
  for (const row of (data ?? []) as unknown as Array<{ alias_normalizado: string; empleados: { id: string; nombre_formal: string; activo: boolean } | null }>) {
    if (row.empleados) m.set(row.alias_normalizado, { empleado_id: row.empleados.id, nombre: row.empleados.nombre_formal, activo: row.empleados.activo });
  }
  return m;
}

const hhmm = (t: string) => String(t).slice(0, 5);

// Firma canónica de un día para comparar (conflictos).
function firmaDia(d: DiaProp): string {
  if (d.cerrado) return "CERRADO";
  const js = d.jornadas
    .map((j) => `${j.empleado_id ?? j.alias_texto}:${hhmm(j.hora_inicio)}-${hhmm(j.hora_fin)}`)
    .sort()
    .join("|");
  return `${hhmm(d.apertura)}-${hhmm(d.cierre)}#${js}`;
}

function diaVistaToProp(d: { fecha: string; cerrado: boolean; apertura: string; cierre: string; jornadas: Array<{ empleado_id: string; nombre: string; hora_inicio: string; hora_fin: string }> }): DiaProp {
  return {
    fecha: d.fecha,
    cerrado: d.cerrado,
    apertura: hhmm(d.apertura),
    cierre: hhmm(d.cierre),
    jornadas: d.jornadas.map((j) => ({ alias_texto: j.nombre, empleado_id: j.empleado_id, hora_inicio: hhmm(j.hora_inicio), hora_fin: hhmm(j.hora_fin) })),
  };
}

// Recalcula conflictos (contra el borrador actual) e incidencias bloqueantes.
async function recomputar(anio: number, mes: number, propuesta: Propuesta, incidenciasBase: Incidencia[]): Promise<{ propuesta: Propuesta; incidencias: Incidencia[]; bloquea: boolean }> {
  const vista = await getMesVista(anio, mes);
  propuesta.mes_estado_actual = vista.estado;

  const actualPorFecha = new Map<string, DiaProp>();
  for (const d of vista.dias) actualPorFecha.set(d.fecha, diaVistaToProp(d));
  const pdfPorFecha = new Map<string, DiaProp>();
  for (const d of propuesta.dias) pdfPorFecha.set(d.fecha, d);

  const conflictosPrev = new Map(propuesta.conflictos.map((c) => [c.fecha, c.decision]));
  const conflictos: Conflicto[] = [];
  const fechas = [...new Set([...actualPorFecha.keys(), ...pdfPorFecha.keys()])].sort();
  for (const fecha of fechas) {
    const actual = actualPorFecha.get(fecha) ?? null;
    const pdf = pdfPorFecha.get(fecha) ?? null;
    let clase: ClaseConflicto;
    if (actual && pdf) clase = firmaDia(actual) === firmaDia(pdf) ? "sin_cambios" : "diferente";
    else if (pdf) clase = "solo_pdf";
    else clase = "solo_borrador";
    const decision = clase === "diferente" ? (conflictosPrev.get(fecha) ?? null) : null;
    conflictos.push({ fecha, clase, decision, actual, pdf });
  }
  propuesta.conflictos = conflictos;

  // Incidencias derivadas del estado actual de la propuesta.
  const incidencias: Incidencia[] = incidenciasBase.filter((i) => i.tipo !== "alias_desconocido" && i.tipo !== "conflicto_borrador" && i.tipo !== "superposicion_invalida");

  // Alias sin resolver (en jornadas propuestas).
  const aliasSinResolver = new Set<string>();
  for (const d of propuesta.dias) {
    if (d.cerrado) continue;
    for (const j of d.jornadas) {
      const emp = j.empleado_id ?? propuesta.aliases[j.alias_texto]?.empleado_id ?? null;
      const activo = j.empleado_id ? true : propuesta.aliases[j.alias_texto]?.activo ?? false;
      if (!emp) aliasSinResolver.add(j.alias_texto);
      else if (!activo) aliasSinResolver.add(j.alias_texto);
    }
  }
  for (const a of aliasSinResolver) {
    incidencias.push({ tipo: "alias_desconocido", severidad: "bloqueante", detalle: `Alias sin resolver o integrante inactivo: "${a}". Elegí un integrante activo.`, texto: a });
  }

  // Validación determinística por día (mismas reglas que el editor manual).
  for (const d of propuesta.dias) {
    const di = diaPropToInput(d, propuesta);
    if (!di) continue; // alias sin resolver ya está reportado
    const v = validarDia(di);
    if (!v.ok) {
      incidencias.push({ tipo: "superposicion_invalida", severidad: "bloqueante", detalle: `Día ${d.fecha}: ${v.error}`, fecha: d.fecha });
    }
  }

  // Conflictos "diferente" sin decisión.
  for (const c of conflictos) {
    if (c.clase === "diferente" && !c.decision) {
      incidencias.push({ tipo: "conflicto_borrador", severidad: "bloqueante", detalle: `El día ${c.fecha} difiere entre el borrador actual y el PDF. Elegí qué versión usar.`, fecha: c.fecha });
    }
  }

  const bloqueantes = incidencias.filter((i) => i.severidad === "bloqueante");
  const bloquea = bloqueantes.length > 0 && vista.estado !== "confirmado";
  return { propuesta, incidencias, bloquea };
}

// DiaProp (con alias resueltos) → DiaInput para validarDia / apply.
function diaPropToInput(d: DiaProp, propuesta: Propuesta): DiaInput | null {
  const jornadas: DiaInput["jornadas"] = [];
  if (!d.cerrado) {
    for (const j of d.jornadas) {
      const emp = j.empleado_id ?? propuesta.aliases[j.alias_texto]?.empleado_id ?? null;
      if (!emp) return null;
      jornadas.push({ empleado_id: emp, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin });
    }
  }
  return { cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas };
}

// ── Analizar un PDF y persistir la importación ────────────────────────────────
export async function analizarImportacion(buf: Buffer, nombre: string): Promise<Ok<ImportacionRow> | Fail> {
  const res = await analizarBuffer(buf);
  if (!res.ok) return res;
  const hash = createHash("sha256").update(buf).digest("hex");
  const nombreSeguro = String(nombre || "cronograma.pdf").slice(0, 200);

  // Rechazo de formato: se persiste como 'rechazada' (auditoría) y se informa.
  if (!res.parse.ok) {
    const inc = res.parse.incidencia;
    const { data, error } = await supabaseAdmin
      .from("cronograma_importaciones")
      .insert({ anio: 2000, mes: 1, archivo_nombre: nombreSeguro, archivo_tamano: buf.length, archivo_hash: hash, paginas: res.paginas, estado: "rechazada", incidencias: [inc], bloquea_confirmacion: false })
      .select("*").single();
    if (error || !data) return { ok: false, status: 422, error: inc.detalle };
    return { ok: true, data: data as ImportacionRow };
  }

  const parsed = res.parse;
  const aliasMap = await mapaAliases();

  // Resolución inicial de alias.
  const aliases: Record<string, AliasResuelto> = {};
  for (const a of parsed.aliasesTexto) {
    const r = aliasMap.get(normalizarAlias(a));
    aliases[a] = r ? { empleado_id: r.empleado_id, nombre: r.nombre, activo: r.activo } : { empleado_id: null, nombre: null, activo: false };
  }

  // Días propuestos: agrupar jornadas por fecha + días cerrados.
  const porFecha = new Map<string, DiaProp>();
  const dia = (fecha: string): DiaProp => {
    let d = porFecha.get(fecha);
    if (!d) { d = { fecha, cerrado: false, apertura: APERTURA, cierre: CIERRE, jornadas: [] }; porFecha.set(fecha, d); }
    return d;
  };
  for (const f of parsed.diasCerrados) { dia(f).cerrado = true; }
  for (const j of parsed.jornadas) {
    const d = dia(j.fecha);
    if (d.cerrado) continue;
    d.jornadas.push({ alias_texto: j.alias_texto, empleado_id: aliases[j.alias_texto]?.empleado_id ?? null, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin });
  }
  const dias = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const propuesta: Propuesta = { mes_estado_actual: "inexistente", aliases, dias, conflictos: [] };
  const { propuesta: prop2, incidencias, bloquea } = await recomputar(parsed.anio, parsed.mes, propuesta, parsed.incidencias);
  const estado = bloquea ? "pendiente_correcciones" : "pendiente";

  const { data, error } = await supabaseAdmin
    .from("cronograma_importaciones")
    .insert({ anio: parsed.anio, mes: parsed.mes, archivo_nombre: nombreSeguro, archivo_tamano: buf.length, archivo_hash: hash, paginas: res.paginas, estado, bloquea_confirmacion: bloquea, propuesta: prop2, incidencias })
    .select("*").single();
  if (error || !data) return { ok: false, status: 500, error: "No se pudo guardar la importación." };
  return { ok: true, data: data as ImportacionRow };
}

export async function getImportacion(id: string): Promise<ImportacionRow | null> {
  const { data, error } = await supabaseAdmin.from("cronograma_importaciones").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as ImportacionRow) ?? null;
}

// Guardar correcciones/decisiones. Solo sobre importaciones aún editables.
export async function guardarCorrecciones(id: string, entrada: { aliases?: Record<string, string | null>; dias?: DiaProp[]; decisiones?: Record<string, "pdf" | "actual" | null> }): Promise<Ok<ImportacionRow> | Fail> {
  const imp = await getImportacion(id);
  if (!imp || !imp.propuesta) return { ok: false, status: 404, error: "Importación no encontrada." };
  if (!["pendiente", "pendiente_correcciones"].includes(imp.estado)) {
    return { ok: false, status: 409, error: "La importación ya no admite cambios." };
  }
  const propuesta = imp.propuesta;

  // Resolución manual de alias → integrante activo elegido por el admin.
  if (entrada.aliases) {
    const activos = await mapaAliasesActivos();
    for (const [alias, empId] of Object.entries(entrada.aliases)) {
      if (!propuesta.aliases[alias]) continue;
      if (empId === null) { propuesta.aliases[alias] = { empleado_id: null, nombre: null, activo: false }; continue; }
      const info = activos.get(empId);
      if (!info) return { ok: false, status: 400, error: "Integrante inválido o inactivo." };
      propuesta.aliases[alias] = { empleado_id: empId, nombre: info.nombre, activo: true };
      // Propaga a las jornadas que usan ese alias y no tienen override.
      for (const d of propuesta.dias) for (const j of d.jornadas) if (j.alias_texto === alias) j.empleado_id = empId;
    }
  }
  if (entrada.dias) propuesta.dias = entrada.dias;
  if (entrada.decisiones) {
    for (const c of propuesta.conflictos) {
      if (c.fecha in entrada.decisiones) c.decision = entrada.decisiones[c.fecha];
    }
  }

  const { propuesta: prop2, incidencias, bloquea } = await recomputar(imp.anio, imp.mes, propuesta, imp.incidencias ?? []);
  const estado = bloquea ? "pendiente_correcciones" : "pendiente";
  const { data, error } = await supabaseAdmin
    .from("cronograma_importaciones")
    .update({ propuesta: prop2, incidencias, bloquea_confirmacion: bloquea, estado, updated_at: new Date().toISOString() })
    .eq("id", id).select("*").single();
  if (error || !data) return { ok: false, status: 500, error: "No se pudieron guardar las correcciones." };
  return { ok: true, data: data as ImportacionRow };
}

async function mapaAliasesActivos(): Promise<Map<string, { nombre: string }>> {
  const { data, error } = await supabaseAdmin.from("empleados").select("id, nombre_formal").eq("activo", true);
  if (error) throw error;
  const m = new Map<string, { nombre: string }>();
  for (const r of (data ?? []) as Array<{ id: string; nombre_formal: string }>) m.set(r.id, { nombre: r.nombre_formal });
  return m;
}

// ── Aplicar la importación (atómica, como borrador) ───────────────────────────
export async function aplicarImportacion(id: string): Promise<Ok<{ importacion: ImportacionRow }> | Fail> {
  const imp = await getImportacion(id);
  if (!imp || !imp.propuesta) return { ok: false, status: 404, error: "Importación no encontrada." };
  if (!["pendiente", "pendiente_correcciones"].includes(imp.estado)) {
    return { ok: false, status: 409, error: "La importación ya fue aplicada o descartada." };
  }
  // Re-validar incidencias bloqueantes en servidor.
  const { incidencias, bloquea } = await recomputar(imp.anio, imp.mes, imp.propuesta, imp.incidencias ?? []);
  if (bloquea) return { ok: false, status: 409, error: "Hay incidencias bloqueantes pendientes. Resolvelas antes de aplicar." };
  if (imp.propuesta.mes_estado_actual === "confirmado") {
    return { ok: false, status: 409, error: "El mes está confirmado. Las correcciones se hacen por día, no por importación masiva." };
  }

  // Construir los días a aplicar según los conflictos.
  const decidido = new Map(imp.propuesta.conflictos.map((c) => [c.fecha, c]));
  const diasAplicar: DiaInput[] = [];
  const fechas: string[] = [];
  for (const d of imp.propuesta.dias) {
    const c = decidido.get(d.fecha);
    // solo_borrador / sin_cambios / decisión 'actual' → conservar (no se envía).
    if (c && (c.clase === "sin_cambios" || (c.clase === "diferente" && c.decision === "actual"))) continue;
    const di = diaPropToInput(d, imp.propuesta);
    if (!di) return { ok: false, status: 409, error: `Quedó un alias sin resolver en ${d.fecha}.` };
    const v = validarDia(di);
    if (!v.ok) return { ok: false, status: 400, error: `Día ${d.fecha}: ${v.error}` };
    diasAplicar.push(v.dia as unknown as DiaInput);
    fechas.push(d.fecha);
  }

  const payload = diasAplicar.map((d, i) => ({ fecha: fechas[i], cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas }));
  const { data, error } = await supabaseAdmin.rpc("cronograma_aplicar_importacion", { p_import_id: id, p_dias: payload });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "22023") return { ok: false, status: 409, error: "El mes está confirmado o la importación no es aplicable." };
    if (code === "23514") return { ok: false, status: 409, error: "Hay integrantes inactivos o incidencias bloqueantes." };
    if (code === "23P01") return { ok: false, status: 409, error: "Superposición de jornadas del mismo integrante." };
    if (code === "22007") return { ok: false, status: 400, error: "Una fecha no pertenece al mes." };
    return { ok: false, status: 500, error: "No se pudo aplicar la importación." };
  }
  // incidencias re-guardadas (por si cambió algo) — no bloquea.
  await supabaseAdmin.from("cronograma_importaciones").update({ incidencias }).eq("id", id);
  return { ok: true, data: { importacion: data as ImportacionRow } };
}

// Descartar (auditoría preservada; no se borra la fila).
export async function descartarImportacion(id: string): Promise<Ok<ImportacionRow> | Fail> {
  const imp = await getImportacion(id);
  if (!imp) return { ok: false, status: 404, error: "Importación no encontrada." };
  if (imp.estado === "aplicada") return { ok: false, status: 409, error: "No se puede descartar una importación ya aplicada." };
  const { data, error } = await supabaseAdmin
    .from("cronograma_importaciones")
    .update({ estado: "descartada", bloquea_confirmacion: false, updated_at: new Date().toISOString() })
    .eq("id", id).select("*").single();
  if (error || !data) return { ok: false, status: 500, error: "No se pudo descartar la importación." };
  return { ok: true, data: data as ImportacionRow };
}
