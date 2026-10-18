// Interacciones del stand — carga de SERVIDOR del análisis (Bloque 4). Solo la
// usa /api/admin/interacciones/metricas (admin).
//
// Nunca calcula sobre "la primera página": PostgREST corta cada respuesta en
// max_rows (1000 en Supabase), así que se pagina por clave (interaccion_id /
// turno_stand_id ascendente) y se contrasta lo cargado con un conteo exacto.
// Si no coincide (alguien escribió en el medio) se reintenta una vez; si sigue
// sin coincidir, la respuesta lo dice (consistente: false) en vez de esconderlo.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { errorDeRpc, fechaSim } from "@/lib/interacciones";
import { estadoModulo, type R } from "@/lib/interaccionesServer";
import {
  aplicarFiltros, calcularMetricas, cobertura, compararCantidad, compararTasa, periodo,
  type BloqueMetricas, type CargaInfo, type Deltas, type EmpleadoRef, type FilaAnalisis, type FilaCobertura, type ParamsMetricas,
  type Periodo, type RespuestaMetricas,
} from "@/lib/interaccionesMetricas";

export const MAX_FILAS_POSTGREST = 1000;

const COLS_ANALISIS =
  "interaccion_id, fecha_negocio, hora_negocio, resultado, personas_grupo, hombres, mujeres, rango_etario, conocia_sim, " +
  "se_subio_antes, iniciador, atendio_empleado_id, motivo, vinculo_estado, turnos_vinculados, turnos_activos, turnos_pagos, " +
  "turnos_gratis, turnos_pago_contradictorio, participaciones, venta_verificada";
const COLS_COBERTURA = "turno_stand_id:turno_stand_id::text, fecha, es_pago, pago_contradictorio, vinculado";

export type Carga = CargaInfo;
type ErrorPg = { code?: string | null; message?: string | null };

function falla<T>(e: ErrorPg): R<T> {
  const conocido = errorDeRpc(e);
  return conocido ? { ok: false, e: conocido } : { ok: false, e: null, causa: `${e.code ?? ""} ${e.message ?? ""}`.trim() };
}

/** Todas las filas de una vista en [desde, hasta] por `columnaFecha`, paginando por `clave`. */
async function cargarTodo<T extends Record<string, unknown>>(
  vista: "interacciones_analisis" | "interacciones_cobertura_turnos",
  columnas: string,
  clave: "interaccion_id" | "turno_stand_id",
  columnaFecha: "fecha_negocio" | "fecha",
  rango: { desde: string; hasta: string },
  tamPagina: number,
): Promise<R<{ filas: T[]; carga: Carga }>> {
  const tam = Math.max(1, Math.min(tamPagina, MAX_FILAS_POSTGREST));
  for (let intento = 0; intento < 2; intento++) {
    const conteo = await supabaseAdmin.from(vista).select(clave, { count: "exact", head: true })
      .gte(columnaFecha, rango.desde).lte(columnaFecha, rango.hasta);
    if (conteo.error) return falla(conteo.error);
    const esperadas = conteo.count ?? 0;
    const filas: T[] = [];
    let ultima: string | null = null;
    let paginas = 0;
    for (;;) {
      let q = supabaseAdmin.from(vista).select(columnas)
        .gte(columnaFecha, rango.desde).lte(columnaFecha, rango.hasta)
        .order(clave, { ascending: true }).limit(tam);
      if (ultima !== null) q = q.gt(clave, ultima);
      const { data, error } = await q;
      if (error) return falla(error);
      const lote = (data ?? []) as unknown as T[];
      paginas++;
      filas.push(...lote);
      if (lote.length < tam) break;
      ultima = String(lote[lote.length - 1][clave]);
    }
    if (filas.length === esperadas || intento === 1) {
      return { ok: true, valor: { filas, carga: { filas: filas.length, paginas, esperadas, consistente: filas.length === esperadas } } };
    }
  }
  return { ok: false, e: null, causa: "carga inconsistente" };
}

async function empleados(ids: string[]): Promise<R<Map<string, EmpleadoRef>>> {
  const mapa = new Map<string, EmpleadoRef>();
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return { ok: true, valor: mapa };
  const { data, error } = await supabaseAdmin.from("empleados").select("id, nombre_formal, activo").in("id", unicos);
  if (error) return falla(error);
  for (const e of data ?? []) mapa.set(String(e.id), { id: String(e.id), nombre: String(e.nombre_formal), activo: Boolean(e.activo) });
  return { ok: true, valor: mapa };
}

type Bloque = {
  periodo: Periodo;
  filas: FilaAnalisis[];
  turnos: FilaCobertura[];
  carga: { interacciones: Carga | null; turnos: Carga | null };
};

async function cargarPeriodo(p: Periodo, tamPagina: number): Promise<R<Bloque>> {
  if (!p.cubierto) return { ok: true, valor: { periodo: p, filas: [], turnos: [], carga: { interacciones: null, turnos: null } } };
  const rango = { desde: p.cubierto.desde, hasta: p.cubierto.hasta };
  const [a, c] = await Promise.all([
    cargarTodo<FilaAnalisis>("interacciones_analisis", COLS_ANALISIS, "interaccion_id", "fecha_negocio", rango, tamPagina),
    cargarTodo<FilaCobertura>("interacciones_cobertura_turnos", COLS_COBERTURA, "turno_stand_id", "fecha", rango, tamPagina),
  ]);
  if (!a.ok) return a;
  if (!c.ok) return c;
  const filas = a.valor.filas.map((x) => ({
    ...x,
    personas_grupo: Number(x.personas_grupo),
    hombres: x.hombres === null ? null : Number(x.hombres),
    mujeres: x.mujeres === null ? null : Number(x.mujeres),
    turnos_vinculados: Number(x.turnos_vinculados),
    turnos_activos: Number(x.turnos_activos),
    turnos_pagos: Number(x.turnos_pagos),
    turnos_gratis: Number(x.turnos_gratis),
    turnos_pago_contradictorio: Number(x.turnos_pago_contradictorio),
    participaciones: Number(x.participaciones),
  }));
  return { ok: true, valor: { periodo: p, filas, turnos: c.valor.filas, carga: { interacciones: a.valor.carga, turnos: c.valor.carga } } };
}

/**
 * Análisis de un período y, opcional, de otro para comparar. Los filtros se
 * aplican a las interacciones de los DOS períodos; la cobertura general solo
 * sigue al período (fecha del turno), nunca a los filtros.
 */
export async function metricas(params: ParamsMetricas, ahora: Date, opciones: { tamPagina?: number } = {}): Promise<R<RespuestaMetricas>> {
  const tam = opciones.tamPagina ?? MAX_FILAS_POSTGREST;
  const modulo = await estadoModulo();
  if (!modulo.ok) return modulo;
  if (!modulo.valor.instalado) return { ok: false, e: errorDeRpc({ code: "42P01" }) };
  const hoy = fechaSim(ahora);
  const inicio = modulo.valor.inicio_registro;
  const actual = await cargarPeriodo(periodo(params.desde, params.hasta, inicio, hoy), tam);
  if (!actual.ok) return actual;
  const comp = params.comparar ? await cargarPeriodo(periodo(params.comparar.desde, params.comparar.hasta, inicio, hoy), tam) : null;
  if (comp && !comp.ok) return comp;
  const emp = await empleados([...actual.valor.filas, ...(comp?.ok ? comp.valor.filas : [])]
    .map((x) => x.atendio_empleado_id).filter((x): x is string => x !== null));
  if (!emp.ok) return emp;

  const armar = (b: Bloque): BloqueMetricas => ({
    periodo: b.periodo,
    metricas: calcularMetricas(aplicarFiltros(b.filas, params.filtros), b.periodo.cubierto, emp.valor),
    cobertura: cobertura(b.turnos),
    carga: b.carga,
  });
  const a = armar(actual.valor);
  const c = comp?.ok ? armar(comp.valor) : null;
  const deltas: Deltas | null = c ? {
    interacciones: compararCantidad(a.metricas.embudo.interacciones, c.metricas.embudo.interacciones),
    personas: compararCantidad(a.metricas.embudo.personas, c.metricas.embudo.personas),
    miraron: compararCantidad(a.metricas.embudo.miraron, c.metricas.embudo.miraron),
    preguntaron: compararCantidad(a.metricas.embudo.preguntaron, c.metricas.embudo.preguntaron),
    subieron: compararCantidad(a.metricas.embudo.subieron, c.metricas.embudo.subieron),
    miro_pregunto: compararTasa(a.metricas.embudo.tasas.miro_pregunto, c.metricas.embudo.tasas.miro_pregunto),
    pregunto_subio: compararTasa(a.metricas.embudo.tasas.pregunto_subio, c.metricas.embudo.tasas.pregunto_subio),
    miro_subio: compararTasa(a.metricas.embudo.tasas.miro_subio, c.metricas.embudo.tasas.miro_subio),
    cobertura: compararTasa(a.cobertura.tasa, c.cobertura.tasa),
    mismos_dias: (a.periodo.cubierto?.dias ?? 0) === (c.periodo.cubierto?.dias ?? 0),
  } : null;
  return {
    ok: true,
    valor: {
      hoy,
      modulo: { habilitado: modulo.valor.habilitado, inicio_registro: inicio },
      filtros: params.filtros,
      actual: a,
      comparacion: c && deltas ? { ...c, deltas } : null,
    },
  };
}
