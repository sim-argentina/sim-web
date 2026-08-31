import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarAnioMes } from "@/lib/cronograma";
import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { getMesVista, getHorasMensuales } from "@/lib/cronogramaServer";
import { calcularMes, getCierreMes } from "@/lib/finanzas";
import { agregarStand } from "@/lib/metricasStand";
import { idsReembolsadas } from "@/lib/reservasReembolsos";

// IA SIM · Bloque 4A — REGISTRO CERRADO de herramientas de SOLO LECTURA.
// El modelo NUNCA elige tablas/columnas ni genera SQL: solo puede invocar estas
// funciones tipadas con parámetros validados por el servidor. Ningún resultado
// incluye PII de clientes (nombres/teléfonos). Los textos internos son DATOS.

export class ToolParamError extends Error {}

export type ToolFuente = {
  modulo: string;
  periodo?: string;
  registros?: number;
  estadoMes?: string;
  exclusiones?: number;
  actualizado: string;
};
export type ToolResultado = {
  contenido: string; // JSON compacto que ve el modelo
  resumen: Record<string, unknown>; // para auditoría (ia_herramientas_ejecuciones)
  fuente: ToolFuente;
};
export type ToolDef = {
  nombre: string;
  descripcion: string;
  schema: Record<string, unknown>;
  periodoMaxDias?: number;
  ejecutar: (input: Record<string, unknown>) => Promise<ToolResultado>;
};

const ahoraISO = () => new Date().toISOString();
const mesStr = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;
const finDeMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);

function pedirAnioMes(input: Record<string, unknown>): { anio: number; mes: number } {
  const v = validarAnioMes(input.anio, input.mes);
  if (!v.ok) throw new ToolParamError(v.error);
  return { anio: v.anio, mes: v.mes };
}

const schemaAnioMes = {
  type: "object",
  properties: {
    anio: { type: "integer", description: "Año (2020-2100)" },
    mes: { type: "integer", description: "Mes 1-12" },
  },
  required: ["anio", "mes"],
  additionalProperties: false,
};

// ── consultar_metricas_equipo (reutiliza el motor del Bloque 3B) ──────────────
const consultar_metricas_equipo: ToolDef = {
  nombre: "consultar_metricas_equipo",
  descripcion: "Métricas de servicio por integrante (Ramiro/Francisco/Federico) de un mes: horas, turnos, personas, operaciones, minutos, facturación bruta, comisiones, neta, desglose Stand/Reservas, actividad sin atribuir, exclusiones, estado del cronograma y calidad de datos. Atribuye por mes de servicio (no altera Finanzas).",
  schema: schemaAnioMes,
  ejecutar: async (input) => {
    const { anio, mes } = pedirAnioMes(input);
    const r = await consultarMetricasEquipo({ desde: `${mesStr(anio, mes)}-01`, hasta: finDeMes(anio, mes) });
    const integrantes = r.integrantes.map((i) => ({ nombre: i.nombre, archivado: i.archivado, horas_min: Math.round(i.horas_minutos), turnos: i.total.turnos, personas: i.total.personas, operaciones: i.total.operaciones, minutos: i.total.minutos, bruto: i.total.bruto, comision: i.total.comision, neto: i.total.neto, stand: { bruto: i.stand.bruto, turnos: i.stand.turnos }, reservas: { bruto: i.reservas.bruto, turnos: i.reservas.turnos } }));
    const payload = { periodo: r.periodo, zonaHoraria: r.zonaHoraria, corte: r.corte, cronograma: r.cronograma, integrantes, totalesOrigen: r.totalesOrigen, totalesAtribuidos: r.totalesAtribuidos, sinAtribuir: r.sinAtribuir, actividadFuturaPendiente: r.actividadFuturaPendiente, exclusiones: r.exclusiones, anomalias: r.anomalias, reconciliacion: { ok: r.reconciliacion.ok }, registros: r.registros, nota_comision_reservas: "Finanzas no modela comisión de Reservas web → 0 (no se inventa)." };
    return {
      contenido: JSON.stringify(payload),
      resumen: { integrantes: integrantes.length, reconciliacion: r.reconciliacion.ok, registros: r.registros },
      fuente: { modulo: "Métricas Equipo", periodo: mesStr(anio, mes), registros: r.registros.stand + r.registros.reservas, estadoMes: r.cronograma.cobertura[0]?.estado, exclusiones: r.exclusiones.length, actualizado: ahoraISO() },
    };
  },
};

// ── consultar_cronograma ──────────────────────────────────────────────────────
const consultar_cronograma: ToolDef = {
  nombre: "consultar_cronograma",
  descripcion: "Cronograma de un mes: estado (inexistente/borrador/confirmado; solo confirmado es oficial), días abiertos/cerrados, horario operativo, jornadas manuales por integrante y horas por integrante (con cobertura calculada de Ramiro en huecos).",
  schema: schemaAnioMes,
  ejecutar: async (input) => {
    const { anio, mes } = pedirAnioMes(input);
    const vista = await getMesVista(anio, mes);
    const horas = await getHorasMensuales(anio, mes);
    const dias = vista.dias.map((d) => ({ fecha: d.fecha, cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas.map((j) => ({ integrante: j.nombre, inicio: j.hora_inicio, fin: j.hora_fin, archivado: !j.empleado_activo })) }));
    const payload = { anio, mes, estado: vista.estado, oficial: vista.estado === "confirmado", apertura_default: vista.apertura_default, cierre_default: vista.cierre_default, dias_total: dias.length, dias_cerrados: dias.filter((d) => d.cerrado).length, horas: horas ? { label: horas.label, integrantes: horas.integrantes.map((h) => ({ nombre: h.nombre, horas_min: h.minutos, archivado: h.archivado })) } : null, dias };
    return {
      contenido: JSON.stringify(payload),
      resumen: { estado: vista.estado, dias: dias.length },
      fuente: { modulo: "Cronograma", periodo: mesStr(anio, mes), registros: dias.length, estadoMes: vista.estado, actualizado: ahoraISO() },
    };
  },
};

// ── consultar_finanzas (fuente de verdad; excluye Colectivo) ──────────────────
const consultar_finanzas: ToolDef = {
  nombre: "consultar_finanzas",
  descripcion: "Finanzas SIM de un mes (excluye Colectivo): ingresos brutos, reembolsos de reservas, ingresos después de reembolsos, comisiones, ingresos netos, costos, gastos, inversiones, Mi sueldo, Ganancia SIM (= netos − costos − gastos − inversiones − Mi sueldo), saldos y estado del cierre. En meses cerrados prioriza el cierre guardado; si se reabrió, usa datos actuales e informa.",
  schema: schemaAnioMes,
  ejecutar: async (input) => {
    const { anio, mes } = pedirAnioMes(input);
    const mesC = mesStr(anio, mes);
    const { resumen } = await calcularMes(mesC);
    const cierre = await getCierreMes(mesC);
    const gananciaSIM = resumen.ingresos - resumen.costos - resumen.gastos - resumen.inversiones - resumen.sueldoAsignado;
    const estadoCierre = cierre ? cierre.estado : "abierto";
    const payload = {
      periodo: mesC,
      ingresos_brutos: resumen.ingresosBruto,
      reembolsos_reservas: resumen.reembolsosReservas,
      ingresos_despues_reembolsos: resumen.ingresosDespuesReembolsos,
      comisiones_cobro: resumen.comisionesCobro,
      ingresos_netos: resumen.ingresos,
      costos: resumen.costos,
      gastos: resumen.gastos,
      inversiones: resumen.inversiones,
      mi_sueldo: resumen.sueldoAsignado,
      ganancia_sim: gananciaSIM,
      saldo_final_teorico: resumen.saldoFinalTeoricoGeneral,
      cierre: { estado: estadoCierre, saldo_real: cierre ? Number(cierre.saldo_real_general) : null },
      nota: "Excluye Colectivo. Comisiones ya descontadas en netos (no se restan dos veces). Ganancia SIM = netos − costos − gastos − inversiones − Mi sueldo.",
    };
    return {
      contenido: JSON.stringify(payload),
      resumen: { ganancia_sim: gananciaSIM, estadoCierre },
      fuente: { modulo: "Finanzas SIM", periodo: mesC, estadoMes: estadoCierre, actualizado: ahoraISO() },
    };
  },
};

// ── consultar_metricas_stand_reservas (agregados operativos; sin doble conteo) ─
const consultar_metricas_stand_reservas: ToolDef = {
  nombre: "consultar_metricas_stand_reservas",
  descripcion: "Agregados operativos de un mes: Turnero Stand y Reservas web POR SEPARADO (turnos, personas, minutos, facturación, operaciones) y días con más actividad. Las reservas se cuentan una sola vez (tabla propia, no se mezclan con el stand).",
  schema: schemaAnioMes,
  ejecutar: async (input) => {
    const { anio, mes } = pedirAnioMes(input);
    const desde = `${mesStr(anio, mes)}-01`, hasta = finDeMes(anio, mes);
    // Stand
    const { data: standRows } = await supabaseAdmin.from("turnos_stand").select("fecha, estado, total, cantidad_personas, cantidad_simuladores, cantidad_turnos").gte("fecha", desde).lte("fecha", hasta);
    const standValidos = (standRows ?? []).filter((t) => { const e = String(t.estado ?? "").toLowerCase(); return e !== "anulado" && e !== "cancelado"; });
    const standAgg = agregarStand(standValidos as never);
    const standPorDia: Record<string, number> = {};
    for (const t of standValidos) standPorDia[String(t.fecha)] = (standPorDia[String(t.fecha)] || 0) + (Number(t.total) || 0);
    // Reservas (una sola vez; excluye canceladas y reembolsadas)
    const { data: resRows } = await supabaseAdmin.from("reservas").select("id, fecha, estado, total, cantidad_turnos, simuladores").gte("fecha", desde).lte("fecha", hasta);
    const rows = (resRows ?? []) as Array<Record<string, unknown>>;
    const reemb = await idsReembolsadas(rows.map((r) => Number(r.id)));
    const resValidas = rows.filter((r) => String(r.estado) === "activa" && !reemb.has(Number(r.id)));
    let rTurnos = 0, rPersonas = 0, rFact = 0;
    for (const r of resValidas) { rTurnos += Number(r.cantidad_turnos) || 0; rPersonas += Array.isArray(r.simuladores) ? (r.simuladores as unknown[]).length : 0; rFact += Number(r.total) || 0; }
    const topDias = Object.entries(standPorDia).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([fecha, fact]) => ({ fecha, facturacion_stand: fact }));
    const payload = {
      periodo: mesStr(anio, mes),
      stand: { operaciones: standAgg.ventas, turnos: standAgg.turnos, personas: standAgg.personas, minutos: standAgg.minutos, facturacion: standAgg.facturacion },
      reservas: { operaciones: resValidas.length, turnos: rTurnos, personas: rPersonas, minutos: rTurnos * 15, facturacion: rFact },
      dias_top_actividad: topDias,
      nota: "Stand y Reservas son fuentes separadas; cada operación se cuenta una sola vez.",
    };
    return {
      contenido: JSON.stringify(payload),
      resumen: { stand_oper: standAgg.ventas, reservas_oper: resValidas.length },
      fuente: { modulo: "Turnero Stand + Reservas web", periodo: mesStr(anio, mes), registros: standValidos.length + resValidas.length, actualizado: ahoraISO() },
    };
  },
};

// ── consultar_empleados ───────────────────────────────────────────────────────
const ALIAS: Record<string, string[]> = { Ramiro: ["Rami"], Francisco: ["Fran"], Federico: ["Fede"] };
const consultar_empleados: ToolDef = {
  nombre: "consultar_empleados",
  descripcion: "Integrantes del equipo: nombre formal, alias (Fran=Francisco, Fede=Federico, Rami=Ramiro), estado activo/archivado y si es el fallback (Ramiro).",
  schema: { type: "object", properties: {}, additionalProperties: false },
  ejecutar: async () => {
    const { data } = await supabaseAdmin.from("empleados").select("nombre_formal, activo, es_fallback").order("es_fallback", { ascending: false }).order("created_at", { ascending: true });
    const integrantes = (data ?? []).map((e) => ({ nombre: e.nombre_formal, alias: ALIAS[e.nombre_formal as string] ?? [], estado: e.activo ? "activo" : "archivado", fallback: !!e.es_fallback }));
    return {
      contenido: JSON.stringify({ integrantes }),
      resumen: { total: integrantes.length },
      fuente: { modulo: "Empleados", registros: integrantes.length, actualizado: ahoraISO() },
    };
  },
};

// ── consultar_colectivo (SEPARADO de SIM; solo si se pide explícitamente) ──────
const consultar_colectivo: ToolDef = {
  nombre: "consultar_colectivo",
  descripcion: "SOLO usar si el administrador pregunta EXPLÍCITAMENTE por el Colectivo o pide compararlo con el stand. Devuelve eventos del Colectivo de un mes con turnos, facturación de simuladores y ventas de productos. NUNCA se mezcla con Finanzas SIM.",
  schema: schemaAnioMes,
  ejecutar: async (input) => {
    const { anio, mes } = pedirAnioMes(input);
    const desde = `${mesStr(anio, mes)}-01`, hasta = finDeMes(anio, mes);
    const [{ data: eventos }, { data: turnos }, { data: ventas }] = await Promise.all([
      supabaseAdmin.from("colectivo_eventos").select("id, nombre, fecha_inicio, fecha_fin, estado").gte("fecha_inicio", desde).lte("fecha_inicio", hasta),
      supabaseAdmin.from("colectivo_turnos").select("evento_id, total, estado, cantidad_turnos"),
      supabaseAdmin.from("colectivo_ventas").select("evento_id, total, estado"),
    ]);
    const ids = new Set((eventos ?? []).map((e) => e.id));
    const agg: Record<string, { turnos: number; fact_sim: number; ventas_prod: number }> = {};
    const g = (id: string) => (agg[id] = agg[id] || { turnos: 0, fact_sim: 0, ventas_prod: 0 });
    for (const t of turnos ?? []) { if (t.estado === "cancelado" || !ids.has(t.evento_id)) continue; const a = g(t.evento_id); a.turnos += Number(t.cantidad_turnos) || 1; a.fact_sim += Number(t.total) || 0; }
    for (const v of ventas ?? []) { if (v.estado !== "activa" || !ids.has(v.evento_id)) continue; g(v.evento_id).ventas_prod += Number(v.total) || 0; }
    const lista = (eventos ?? []).map((e) => { const a = agg[e.id] || { turnos: 0, fact_sim: 0, ventas_prod: 0 }; return { nombre: e.nombre, estado: e.estado, fecha_inicio: e.fecha_inicio, turnos: a.turnos, facturacion_simuladores: a.fact_sim, ventas_productos: a.ventas_prod, recaudacion_total: a.fact_sim + a.ventas_prod }; });
    return {
      contenido: JSON.stringify({ periodo: mesStr(anio, mes), eventos: lista, nota: "El Colectivo es un negocio SEPARADO de SIM; nunca se suma a Finanzas SIM." }),
      resumen: { eventos: lista.length },
      fuente: { modulo: "Colectivo (separado)", periodo: mesStr(anio, mes), registros: lista.length, actualizado: ahoraISO() },
    };
  },
};

export const HERRAMIENTAS: Record<string, ToolDef> = {
  consultar_metricas_equipo,
  consultar_cronograma,
  consultar_finanzas,
  consultar_metricas_stand_reservas,
  consultar_empleados,
  consultar_colectivo,
};

export function defsParaProveedor() {
  return Object.values(HERRAMIENTAS).map((t) => ({ nombre: t.nombre, descripcion: t.descripcion, schema: t.schema }));
}
