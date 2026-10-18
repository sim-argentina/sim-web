// Interacciones del stand — acceso de SERVIDOR (service_role). Solo lo importan
// las rutas de /api/admin/interacciones.
//
// Toda escritura pasa por las RPCs de db/interacciones-bloque1.sql: service_role
// no tiene INSERT/UPDATE/DELETE sobre las tablas del módulo, a propósito. Las
// lecturas usan columnas explícitas (nunca select *) y los IDs bigint viajan como
// texto desde la propia consulta (::text), sin pasar por Number.
//
// El rol que reciben las RPCs lo pasa la ruta desde la sesión firmada; nada de
// lo que manda el navegador decide autoridad.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMesVista } from "@/lib/cronogramaServer";
import { resolverPresencia, type EstadoMes, type FuentePresencia } from "@/lib/cronograma";
import {
  LIMITES, coincideBusqueda, codificarCursor, dtoInteraccion, errorApi, errorDeRpc, fechaSim, horaSim,
  minutoLocal, pagoContradictorio, ventanaVinculables,
  type CuerpoAlta, type CuerpoEdicion, type DetalleBase, type ErrorApi, type FiltrosListado,
  type InteraccionDto, type MotivoCierre, type ParamsVinculables, type Rol, type TurnoVinculableDto,
  type VentanaVinculables,
} from "@/lib/interacciones";

/** ok · error conocido (e) · error inesperado (e = null: la ruta contesta 500 y lo registra). */
export type R<T> = { ok: true; valor: T } | { ok: false; e: ErrorApi | null; causa?: string };

type ErrorPg = { code?: string | null; message?: string | null } | null;

function fallo<T>(error: ErrorPg): R<T> {
  const e = errorDeRpc(error);
  return e ? { ok: false, e } : { ok: false, e: null, causa: `${error?.code ?? ""} ${error?.message ?? ""}`.trim() };
}

const COLS_INTERACCION =
  "id, version, ocurrida_en, fecha_negocio, hora_negocio, registrada_en, registrada_por_rol, actualizada_en, " +
  "actualizada_por_rol, resultado, personas_grupo, hombres, mujeres, rango_etario, conocia_sim, se_subio_antes, " +
  "iniciador, atendio_empleado_id, motivo, observaciones, cierre_motivo, cierre_nota, cerrada_en, cerrada_por_rol, " +
  "anulada_en, anulada_por_rol, anulada_motivo";
const COLS_ESTADO =
  "interaccion_id, vinculo_estado, turnos_vinculados, turnos_activos, turnos_pagos, turnos_gratis, " +
  "turnos_pago_contradictorio, participaciones, venta_verificada";
const COLS_CONTROL =
  "interaccion_id, turno_stand_id:turno_stand_id::text, vinculado_en, vinculado_por_rol, turno_fecha, turno_hora, " +
  "turno_hora_subida, turno_personas, turno_minutos, turno_modalidad, turno_total, turno_pago, turno_activo, " +
  "dias_diferencia, fuera_de_tolerancia, turno_modificado, turno_metodo_pago, pago_contradictorio";

// ── Estado del módulo ─────────────────────────────────────────────────────
export type EstadoModulo = { instalado: boolean; habilitado: boolean; inicio_registro: string | null };

/** instalado = la migración existe; habilitado = hay inicio_registro (lanzamiento). */
export async function estadoModulo(): Promise<R<EstadoModulo>> {
  const { data, error } = await supabaseAdmin
    .from("interacciones_config").select("inicio_registro").eq("id", true).maybeSingle();
  if (error) {
    const e = errorDeRpc(error);
    if (e?.codigo === "modulo_no_instalado") return { ok: true, valor: { instalado: false, habilitado: false, inicio_registro: null } };
    return fallo(error);
  }
  const inicio = (data?.inicio_registro as string | null | undefined) ?? null;
  return { ok: true, valor: { instalado: true, habilitado: inicio !== null, inicio_registro: inicio } };
}

// ── Empleados ─────────────────────────────────────────────────────────────
async function empleadosPorId(ids: string[]): Promise<Map<string, { nombre: string | null; activo: boolean }>> {
  const unicos = [...new Set(ids)];
  const mapa = new Map<string, { nombre: string | null; activo: boolean }>();
  if (unicos.length === 0) return mapa;
  const { data, error } = await supabaseAdmin.from("empleados").select("id, nombre_formal, activo").in("id", unicos);
  if (error) throw new Error(`empleados: ${error.code ?? ""} ${error.message ?? ""}`);
  for (const e of data ?? []) mapa.set(String(e.id), { nombre: (e.nombre_formal as string) ?? null, activo: Boolean(e.activo) });
  return mapa;
}

async function aDto(det: DetalleBase & Record<string, unknown>, rol: Rol, ahora: Date): Promise<InteraccionDto> {
  const empId = det.interaccion.atendio_empleado_id ? String(det.interaccion.atendio_empleado_id) : null;
  const emp = empId ? (await empleadosPorId([empId])).get(empId) ?? null : null;
  return dtoInteraccion(det, { rol, ahora, atendio: emp }, {
    turnos_liberados: Array.isArray(det.turnos_liberados) ? (det.turnos_liberados as unknown[]).map(String) : undefined,
    cierre_retirado: det.cierre_retirado === true,
  });
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<R<(DetalleBase & Record<string, unknown>) | null>> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) return fallo(error);
  return { ok: true, valor: (data ?? null) as (DetalleBase & Record<string, unknown>) | null };
}

// ── Lectura de una interacción ────────────────────────────────────────────
export async function detalle(id: string, rol: Rol, ahora: Date): Promise<R<InteraccionDto>> {
  const r = await rpc("interaccion_detalle", { p_id: id });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
  return { ok: true, valor: await aDto(r.valor, rol, ahora) };
}

// ── Escrituras (todas por RPC) ────────────────────────────────────────────
export async function registrar(c: CuerpoAlta, rol: Rol, ahora: Date): Promise<R<{ interaccion: InteraccionDto; repetida: boolean }>> {
  const r = await rpc("interaccion_registrar", {
    p_idempotency_key: c.idempotency_key,
    p_datos: c.datos,
    p_turnos: c.turnos.length > 0 ? c.turnos : null,
    p_rol: rol,
  });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: null, causa: "interaccion_registrar sin respuesta" };
  return { ok: true, valor: { interaccion: await aDto(r.valor, rol, ahora), repetida: r.valor.repetida === true } };
}

/**
 * Edición parcial. Si el cambio de resultado LIBERA turnos o RETIRA un cierre,
 * exige confirmar_liberacion: nada se borra sin que el pedido lo diga. La lectura
 * previa es segura: la RPC vuelve a exigir la misma versión al escribir, así que
 * si algo cambió en el medio contesta 409 y no escribe.
 */
export async function editar(id: string, c: CuerpoEdicion, rol: Rol, ahora: Date): Promise<R<{ interaccion: InteraccionDto; sin_cambios: boolean }>> {
  if (c.cambios.resultado !== undefined && c.cambios.resultado !== "subio" && !c.confirmar_liberacion) {
    const actual = await rpc("interaccion_detalle", { p_id: id });
    if (!actual.ok) return actual;
    if (!actual.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
    const i = actual.valor.interaccion;
    if (Number(i.version) !== c.version) return { ok: false, e: errorApi("version_desactualizada") };
    const turnos = (actual.valor.turnos ?? []).map((t) => String(t.turno_stand_id));
    if (i.resultado === "subio" && (turnos.length > 0 || i.cierre_motivo)) {
      return { ok: false, e: errorApi("confirmar_liberacion", { turnos }) };
    }
  }
  const r = await rpc("interaccion_editar", { p_id: id, p_version: c.version, p_cambios: c.cambios, p_rol: rol });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
  return { ok: true, valor: { interaccion: await aDto(r.valor, rol, ahora), sin_cambios: r.valor.sin_cambios === true } };
}

export async function vincular(id: string, c: { version: number; turnos: string[] }, rol: Rol, ahora: Date): Promise<R<{ interaccion: InteraccionDto; sin_cambios: boolean }>> {
  const r = await rpc("interaccion_vincular", { p_id: id, p_version: c.version, p_turnos: c.turnos, p_rol: rol });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
  return { ok: true, valor: { interaccion: await aDto(r.valor, rol, ahora), sin_cambios: r.valor.sin_cambios === true } };
}

export async function desvincular(id: string, c: { version: number; turno: string }, rol: Rol, ahora: Date): Promise<R<{ interaccion: InteraccionDto }>> {
  const r = await rpc("interaccion_desvincular", { p_id: id, p_version: c.version, p_turno: c.turno, p_rol: rol });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
  return { ok: true, valor: { interaccion: await aDto(r.valor, rol, ahora) } };
}

export async function anular(id: string, c: { version: number; motivo: string | null }, rol: Rol, ahora: Date): Promise<R<{ interaccion: InteraccionDto; sin_cambios: boolean }>> {
  const r = await rpc("interaccion_anular", { p_id: id, p_version: c.version, p_motivo: c.motivo, p_rol: rol });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
  return { ok: true, valor: { interaccion: await aDto(r.valor, rol, ahora), sin_cambios: r.valor.sin_cambios === true } };
}

export async function cerrarSinVinculo(
  id: string, c: { version: number; motivo: MotivoCierre; nota: string | null }, rol: Rol, ahora: Date,
): Promise<R<{ interaccion: InteraccionDto; sin_cambios: boolean }>> {
  const r = await rpc("interaccion_cerrar_sin_vinculo", { p_id: id, p_version: c.version, p_motivo: c.motivo, p_nota: c.nota, p_rol: rol });
  if (!r.ok) return r;
  if (!r.valor) return { ok: false, e: errorApi("interaccion_inexistente") };
  return { ok: true, valor: { interaccion: await aDto(r.valor, rol, ahora), sin_cambios: r.valor.sin_cambios === true } };
}

// ── Listado ───────────────────────────────────────────────────────────────
/**
 * Página de interacciones: orden ocurrida_en desc, id desc (estable), cursor
 * sobre ese mismo par. Arma la forma de interaccion_detalle() con tres lecturas
 * (filas, estado, vínculos) y la convierte con el MISMO dtoInteraccion.
 */
export async function listar(f: FiltrosListado, rol: Rol, ahora: Date): Promise<R<{ items: InteraccionDto[]; siguiente: string | null }>> {
  let q = supabaseAdmin
    .from("interacciones_stand_estado")
    .select("interaccion_id, ocurrida_en")
    .order("ocurrida_en", { ascending: false })
    .order("interaccion_id", { ascending: false })
    .limit(f.limite + 1);
  if (f.desde) q = q.gte("fecha_negocio", f.desde);
  if (f.hasta) q = q.lte("fecha_negocio", f.hasta);
  if (f.resultado) q = q.eq("resultado", f.resultado);
  if (f.estado) q = q.eq("vinculo_estado", f.estado);
  if (!f.incluir_anuladas) q = q.eq("anulada", false);
  if (f.cursor) {
    const o = `"${f.cursor.ocurrida_en}"`;
    q = q.or(`ocurrida_en.lt.${o},and(ocurrida_en.eq.${o},interaccion_id.lt.${f.cursor.id})`);
  }
  const { data: pagina, error } = await q;
  if (error) return fallo(error);
  const filas = (pagina ?? []) as Array<{ interaccion_id: string; ocurrida_en: string }>;
  const hayMas = filas.length > f.limite;
  const visibles = filas.slice(0, f.limite);
  const ids = visibles.map((x) => x.interaccion_id);
  if (ids.length === 0) return { ok: true, valor: { items: [], siguiente: null } };

  const [rI, rE, rC] = await Promise.all([
    supabaseAdmin.from("interacciones_stand").select(COLS_INTERACCION).in("id", ids),
    supabaseAdmin.from("interacciones_stand_estado").select(COLS_ESTADO).in("interaccion_id", ids),
    supabaseAdmin.from("interacciones_vinculos_control").select(COLS_CONTROL).in("interaccion_id", ids)
      .order("vinculado_en", { ascending: true }).order("turno_stand_id", { ascending: true }),
  ]);
  for (const r of [rI, rE, rC]) if (r.error) return fallo(r.error);
  const porId = new Map((rI.data ?? []).map((x) => [String((x as unknown as Record<string, unknown>).id), x as unknown as Record<string, unknown>]));
  const estados = new Map((rE.data ?? []).map((x) => [String((x as unknown as Record<string, unknown>).interaccion_id), x as unknown as Record<string, unknown>]));
  const turnos = new Map<string, Array<Record<string, unknown>>>();
  for (const t of (rC.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const k = String(t.interaccion_id);
    turnos.set(k, [...(turnos.get(k) ?? []), t]);
  }
  const emps = await empleadosPorId(
    [...porId.values()].map((x) => x.atendio_empleado_id).filter((x): x is string => typeof x === "string"),
  );
  const items: InteraccionDto[] = [];
  for (const id of ids) {
    const i = porId.get(id);
    const e = estados.get(id);
    if (!i || !e) continue;
    const empId = typeof i.atendio_empleado_id === "string" ? i.atendio_empleado_id : null;
    items.push(dtoInteraccion({ interaccion: i, estado: e, turnos: turnos.get(id) ?? [] }, { rol, ahora, atendio: empId ? emps.get(empId) ?? null : null }));
  }
  const ultimo = visibles[visibles.length - 1];
  return { ok: true, valor: { items, siguiente: hayMas ? codificarCursor({ ocurrida_en: ultimo.ocurrida_en, id: ultimo.interaccion_id }) : null } };
}

// ── Turnos vinculables ────────────────────────────────────────────────────
// Solo turnos_stand activos: reservas web, históricos y Colectivo ni se consultan.
// Columnas mínimas: nada de nombre, teléfono, observaciones ni simuladores.
const COLS_TURNO = "id:id::text, fecha, hora, hora_subida, cantidad_personas, cantidad_minutos, modalidad, total, metodo_pago";
const MAX_TURNOS_CONSULTA = 500;

export async function turnosVinculables(
  p: ParamsVinculables, ahora: Date,
): Promise<R<{ ventana: VentanaVinculables; interaccion: string | null; turnos: TurnoVinculableDto[] }>> {
  let ancla = ahora;
  if (p.interaccion) {
    const { data, error } = await supabaseAdmin.from("interacciones_stand").select("id, ocurrida_en").eq("id", p.interaccion).maybeSingle();
    if (error) return fallo(error);
    if (!data) return { ok: false, e: errorApi("interaccion_inexistente") };
    ancla = new Date(String(data.ocurrida_en));
  } else if (p.ocurrida_en) {
    ancla = new Date(p.ocurrida_en.replace(" ", "T"));
  }
  const ventana = ventanaVinculables(ancla, p.alcance);
  const { data, error } = await supabaseAdmin
    .from("turnos_stand")
    .select(COLS_TURNO)
    .gte("fecha", ventana.fecha_desde)
    .lte("fecha", ventana.fecha_hasta)
    .or("estado.is.null,estado.eq.activo")
    .order("fecha", { ascending: false })
    .order("hora", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_TURNOS_CONSULTA);
  if (error) return fallo(error);
  const filas = ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map((t) => ({
      id: String(t.id),
      fecha: String(t.fecha),
      hora: String(t.hora ?? ""),
      hora_subida: t.hora_subida ? String(t.hora_subida) : null,
      personas: t.cantidad_personas === null || t.cantidad_personas === undefined ? null : Number(t.cantidad_personas),
      minutos: t.cantidad_minutos === null || t.cantidad_minutos === undefined ? null : Number(t.cantidad_minutos),
      modalidad: t.modalidad ? String(t.modalidad) : null,
      total: Number(t.total ?? 0),
      metodo: t.metodo_pago ? String(t.metodo_pago) : null,
    }))
    .filter((t) => {
      const m = minutoLocal(t.fecha, t.hora);
      return m !== null && m >= ventana.minuto_desde && m <= ventana.minuto_hasta && coincideBusqueda(t, p);
    });

  const vinculos = new Map<string, string>();
  if (filas.length > 0) {
    const { data: vs, error: ev } = await supabaseAdmin
      .from("interaccion_turnos")
      .select("turno_stand_id:turno_stand_id::text, interaccion_id")
      .in("turno_stand_id", filas.map((t) => t.id));
    if (ev) return fallo(ev);
    for (const v of (vs ?? []) as unknown as Array<{ turno_stand_id: string; interaccion_id: string }>) {
      vinculos.set(v.turno_stand_id, v.interaccion_id);
    }
  }
  const turnos: TurnoVinculableDto[] = [];
  for (const t of filas) {
    const duena = vinculos.get(t.id) ?? null;
    const vinculacion = duena === null ? "libre" : duena === p.interaccion ? "esta" : "otra";
    if (vinculacion === "otra" && !p.incluir_vinculados) continue;
    turnos.push({
      id: t.id, fecha: t.fecha, hora: t.hora, hora_subida: t.hora_subida, personas: t.personas, minutos: t.minutos,
      modalidad: t.modalidad, total: t.total, es_pago: t.total > 0, pago_contradictorio: pagoContradictorio(t.total, t.metodo),
      vinculacion, disponible: vinculacion === "libre",
    });
  }
  return { ok: true, valor: { ventana, interaccion: p.interaccion, turnos } };
}

// ── Empleados activos y sugerencia del cronograma ─────────────────────────
export type EmpleadosInteraccion = {
  empleados: Array<{ id: string; nombre: string }>;
  sugeridos: string[];
  cronograma: { estado: EstadoMes; fuente: FuentePresencia; oficial: boolean } | null;
  ancla: { fecha: string; hora: string };
};

/**
 * Integrantes ACTIVOS (solo id y nombre) y, como SUGERENCIA, quiénes figuran en
 * el cronograma a esa hora. Nunca asigna: "atendió" lo elige quien carga. Si el
 * cronograma no se puede leer, no hay sugerencias y el resto sigue.
 */
export async function empleadosParaInteraccion(ancla: Date): Promise<R<EmpleadosInteraccion>> {
  const { data, error } = await supabaseAdmin
    .from("empleados").select("id, nombre_formal").eq("activo", true)
    .order("nombre_formal", { ascending: true }).order("id", { ascending: true });
  if (error) return fallo(error);
  const empleados = (data ?? []).map((e) => ({ id: String(e.id), nombre: String(e.nombre_formal) }));
  const activos = new Set(empleados.map((e) => e.id));
  const fecha = fechaSim(ancla);
  const hora = horaSim(ancla);
  let sugeridos: string[] = [];
  let cronograma: EmpleadosInteraccion["cronograma"] = null;
  try {
    const [anio, mes] = fecha.split("-").map(Number);
    const vista = await getMesVista(anio, mes);
    const dia = vista.dias.find((d) => d.fecha === fecha);
    const r = resolverPresencia({
      estado: vista.estado,
      dia: dia
        ? { cerrado: dia.cerrado, apertura: dia.apertura, cierre: dia.cierre, jornadas: dia.jornadas.map((j) => ({ empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })) }
        : { cerrado: false, apertura: vista.apertura_default, cierre: vista.cierre_default, jornadas: [] },
      hora,
      fallbackEmpleadoId: vista.fallback?.id ?? "",
    });
    sugeridos = r.presentes.filter((id) => activos.has(id));
    cronograma = { estado: vista.estado, fuente: r.fuente, oficial: r.oficial };
  } catch (e) {
    console.error(`[interacciones] cronograma no disponible para sugerencias: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: true, valor: { empleados, sugeridos, cronograma, ancla: { fecha, hora } } };
}

export { LIMITES };
