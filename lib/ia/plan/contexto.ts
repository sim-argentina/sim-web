// IA SIM · Bloque 5C — Contexto analítico de la conversación. Puro (sin DB, sin reloj).
//
// Permite preguntas cortas de seguimiento ("¿y solo los fines de semana?", "¿y contra agosto?",
// "separalo por fuente") sin que el modelo tenga que recordar nada: el servidor guarda lo
// ESTRUCTURADO del último análisis y lo ofrece como punto de partida.
//
// Lo que NO se guarda: razonamiento, texto del modelo, datos personales, ni resultados. Solo la
// forma del pedido anterior. Y la instrucción nueva siempre gana sobre lo heredado.

import { FILTRO_POR_CAMPO } from "@/lib/ia/analisis/catalogoSemantico";

export type ContextoAnalitico = {
  /** Períodos del último análisis, del más antiguo al más reciente. */
  periodos: string[];
  metricas: string[];
  /** Filtros por nombre, con los valores que se usaron. */
  filtros: Record<string, string[]>;
  dimensiones: string[];
  segmentacion: { tipo: string; grupoA: string[]; grupoB: string[] } | null;
  herramientas: string[];
  evidencias: string[];
  tipoComparacion: string | null;
};

export const CONTEXTO_VACIO: ContextoAnalitico = {
  periodos: [], metricas: [], filtros: {}, dimensiones: [], segmentacion: null, herramientas: [], evidencias: [], tipoComparacion: null,
};

// Campos que NUNCA entran al contexto, por si un resumen los trajera.
const PROHIBIDOS = /^(razonamiento|chain|thinking|texto|narracion|cliente|email|telefono|dni|nombre_cliente)$/i;

const lista = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim()).filter((x) => x && x.length <= 60).slice(0, 12);

/** Arma el contexto a partir del resumen estructurado de un análisis ya ejecutado. */
export function contextoDesdeAnalisis(resumen: Record<string, unknown> | null | undefined): ContextoAnalitico | null {
  if (!resumen || resumen.ok !== true) return null;

  // Análisis multiherramienta (5C).
  if (Array.isArray(resumen.evidencias)) {
    const ev = resumen.evidencias as Array<Record<string, unknown>>;
    const comps = Array.isArray(resumen.comparaciones) ? (resumen.comparaciones as Array<Record<string, unknown>>) : [];
    return {
      periodos: [...new Set(ev.map((e) => String(e.periodo)).filter(Boolean))].sort().slice(0, 4),
      metricas: [...new Set(ev.map((e) => String(e.metrica)).filter(Boolean))].slice(0, 8),
      filtros: {},
      dimensiones: [],
      segmentacion: null,
      herramientas: [...new Set(ev.map((e) => String(e.herramienta)).filter(Boolean))].slice(0, 6),
      evidencias: ev.map((e) => String(e.evidenciaId)).filter(Boolean).slice(0, 24),
      tipoComparacion: comps.length > 0 ? "periodos" : null,
    };
  }

  // Consulta analítica simple (5B).
  const ventana = resumen.ventana as { desde?: string; hasta?: string } | undefined;
  const metricas = Array.isArray(resumen.metricas) ? (resumen.metricas as Array<Record<string, unknown>>).map((m) => String(m.id)) : [];
  const filtrosCrudos = (resumen.filtros ?? {}) as Record<string, unknown>;
  const filtros: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(filtrosCrudos)) {
    if (v == null || PROHIBIDOS.test(k)) continue;
    const vals = lista(v);
    // Se publica el nombre PÚBLICO del filtro (el que el contrato acepta), no el interno: si el
    // modelo reusa lo que lee, tiene que poder escribirlo como argumento válido.
    const nombre = FILTRO_POR_CAMPO[k] ?? k;
    if (vals.length > 0) filtros[nombre] = vals;
  }
  const seg = resumen.segmentos && Array.isArray(resumen.segmentos) ? (resumen.segmentos as Array<Record<string, unknown>>) : null;
  return {
    periodos: ventana?.desde ? [`${ventana.desde}..${ventana.hasta}`] : [],
    metricas: metricas.slice(0, 8),
    filtros,
    dimensiones: lista(resumen.dimensiones),
    segmentacion: seg && seg.length === 2 ? { tipo: "grupos", grupoA: [String(seg[0].etiqueta)], grupoB: [String(seg[1].etiqueta)] } : null,
    herramientas: ["consulta_analitica_interna"],
    evidencias: [],
    tipoComparacion: seg ? "segmentos" : null,
  };
}

/**
 * Lo que se le ofrece al modelo como punto de partida de un seguimiento. Es una SUGERENCIA
 * explícita, no un plan: la instrucción nueva manda y, si hay dos lecturas razonables, el modelo
 * tiene que preguntar en vez de elegir por su cuenta.
 */
export function pistaDeContexto(ctx: ContextoAnalitico | null): string | null {
  if (!ctx) return null;
  const partes: string[] = [];
  if (ctx.periodos.length > 0) partes.push(`período(s) ${ctx.periodos.join(" y ")}`);
  if (ctx.metricas.length > 0) partes.push(`métrica(s) ${ctx.metricas.join(", ")}`);
  const filtros = Object.entries(ctx.filtros).map(([k, v]) => `${k}=${v.join("/")}`);
  if (filtros.length > 0) partes.push(`filtro(s) ${filtros.join(", ")}`);
  if (ctx.dimensiones.length > 0) partes.push(`agrupación(es) ${ctx.dimensiones.join(", ")}`);
  if (partes.length === 0) return null;
  return (
    `Contexto del último análisis de ESTA conversación: ${partes.join("; ")}. ` +
    "Si la nueva pregunta es un seguimiento corto, reusá lo que corresponda y cambiá SOLO lo que el administrador pidió: " +
    "un período nuevo REEMPLAZA al anterior, un filtro nuevo REEMPLAZA al del mismo campo, y lo que no se menciona se mantiene. " +
    "Si hay dos lecturas razonables de la pregunta, preguntá cuál antes de ejecutar. Si el pedido es independiente, ignorá este contexto."
  );
}

/** Aplica un seguimiento sobre el contexto: lo nuevo reemplaza, lo no mencionado se hereda. */
export function heredar(ctx: ContextoAnalitico, nuevo: Partial<ContextoAnalitico>): ContextoAnalitico {
  const filtros = { ...ctx.filtros };
  for (const [k, v] of Object.entries(nuevo.filtros ?? {})) {
    if (v.length === 0) delete filtros[k]; // el usuario lo sacó explícitamente
    else filtros[k] = v;                   // lo reemplazó
  }
  return {
    periodos: nuevo.periodos && nuevo.periodos.length > 0 ? nuevo.periodos : ctx.periodos,
    metricas: nuevo.metricas && nuevo.metricas.length > 0 ? nuevo.metricas : ctx.metricas,
    filtros,
    dimensiones: nuevo.dimensiones && nuevo.dimensiones.length > 0 ? nuevo.dimensiones : ctx.dimensiones,
    segmentacion: nuevo.segmentacion !== undefined ? nuevo.segmentacion : ctx.segmentacion,
    herramientas: nuevo.herramientas && nuevo.herramientas.length > 0 ? nuevo.herramientas : ctx.herramientas,
    evidencias: nuevo.evidencias ?? [],
    tipoComparacion: nuevo.tipoComparacion !== undefined ? nuevo.tipoComparacion : ctx.tipoComparacion,
  };
}
