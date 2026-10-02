// IA SIM · Bloque 5B — CATÁLOGO SEMÁNTICO de los análisis internos. Puro (sin base, sin reloj).
//
// Qué resuelve: en 5A el plan era rígido —una métrica, una agrupación, cero cálculos— y la
// compatibilidad vivía en `if`s sueltos. Acá cada métrica DECLARA qué es, de dónde sale, con qué
// regla temporal, qué agrupaciones y filtros admite y a qué universo pertenece. El modelo elige
// identificadores de estas listas cerradas; nunca escribe SQL, ni nombra tablas o columnas, ni
// inventa fórmulas.
//
// Regla que atraviesa todo: NUNCA se cruzan universos. Dividir facturación (que incluye
// campeonatos, mensualidades e ingresos manuales) por operaciones del Turnero y llamarlo
// "ticket promedio" da un número que no significa nada. Si los universos no coinciden, se
// rechaza antes de leer un solo dato.

// ── Universos ───────────────────────────────────────────────────────────────────
// Un universo es un conjunto de hechos con la MISMA base de imputación y el mismo
// denominador válido. Solo se pueden combinar métricas del mismo universo.
export const UNIVERSOS = {
  facturacion: {
    etiqueta: "Facturación",
    descripcion:
      "Eventos contables de la composición canónica de Finanzas (fin_eventos_facturacion): turnero por fecha de servicio; reservas web, gift cards, campeonatos y mensualidades por fecha de pago; ingresos manuales por su fecha contable.",
  },
  actividad: {
    etiqueta: "Actividad",
    descripcion:
      "Operaciones del Turnero del stand y reservas web por fecha de SERVICIO, con los minutos y turnos comerciales de la modalidad persistida de cada fila (legacy o v2).",
  },
} as const;
export type Universo = keyof typeof UNIVERSOS;

// ── Unidades y formato ──────────────────────────────────────────────────────────
export const UNIDADES = ["ars", "turnos", "personas", "cantidad", "minutos", "porcentaje"] as const;
export type Unidad = (typeof UNIDADES)[number];

// ── Dimensiones (agrupaciones) ──────────────────────────────────────────────────
export const DIMENSIONES = {
  dia: { etiqueta: "Día", temporal: true, descripcion: "Un día calendario de Córdoba." },
  semana: { etiqueta: "Semana", temporal: true, descripcion: "Semana calendario de lunes a domingo, recortada al período pedido (las semanas parciales se conservan)." },
  mes: { etiqueta: "Mes", temporal: true, descripcion: "Mes calendario." },
  dia_semana: { etiqueta: "Día de la semana", temporal: false, descripcion: "Lunes a domingo, agrupando todas las fechas de ese día." },
  fuente: { etiqueta: "Fuente", temporal: false, descripcion: "Origen del registro dentro de su universo." },
  clase: { etiqueta: "Automático / manual", temporal: false, descripcion: "Si el ingreso lo generó un circuito automático de SIM o se cargó a mano en Finanzas." },
  metodo_pago: { etiqueta: "Método de pago", temporal: false, descripcion: "Medio con el que se cobró." },
  modalidad: { etiqueta: "Modalidad comercial", temporal: false, descripcion: "Modalidad persistida de la fila: legacy o v2 (10/20/30)." },
  duracion: { etiqueta: "Duración", temporal: false, descripcion: "Duración vendida, etiquetada según la modalidad de cada fila (no se fuerza a 15 o 30)." },
  simuladores: { etiqueta: "Simuladores", temporal: false, descripcion: "Cantidad de simuladores de la operación. Los simuladores son recursos equivalentes: no se los distingue por identidad." },
} as const;
export type Dimension = keyof typeof DIMENSIONES;
export const DIMENSIONES_VALIDAS = Object.keys(DIMENSIONES) as Dimension[];
export const MAX_DIMENSIONES = 2;

// ── Filtros ─────────────────────────────────────────────────────────────────────
export const FILTROS = {
  dias_semana: { etiqueta: "Días de la semana", descripcion: "Días ISO a incluir (1=lunes … 7=domingo)." },
  fuente: { etiqueta: "Fuente", descripcion: "Limita a una o varias fuentes del universo." },
  clase: { etiqueta: "Automático / manual", descripcion: "Limita a ingresos automáticos o manuales." },
  metodo_pago: { etiqueta: "Método de pago", descripcion: "Limita a uno o varios medios de cobro." },
  modalidad: { etiqueta: "Modalidad comercial", descripcion: "Limita a filas legacy o v2." },
  duracion: { etiqueta: "Duración", descripcion: "Limita a una o varias duraciones vendidas (en minutos)." },
  simuladores: { etiqueta: "Simuladores", descripcion: "Limita por cantidad de simuladores." },
} as const;
export type FiltroId = keyof typeof FILTROS;
export const FILTROS_VALIDOS = Object.keys(FILTROS) as FiltroId[];

// ── Métricas ────────────────────────────────────────────────────────────────────
// `claseFacturacion` no es un filtro que el modelo pueda cambiar: es parte de la DEFINICIÓN de
// la métrica. facturacion_automatica y facturacion_manual salen de la MISMA fuente canónica que
// facturacion_bruta; no son una segunda composición.
export type MetricaDef = {
  id: string;
  etiqueta: string;
  definicion: string;
  unidad: Unidad;
  universo: Universo;
  reglaTemporal: string;
  dimensiones: readonly Dimension[];
  filtros: readonly FiltroId[];
  /** Cómo se tratan los días sin movimientos al promediar. */
  ceros: "cuentan_como_cero";
  /** Restricción de clase que forma parte de la definición (no la elige el modelo). */
  claseFacturacion?: "automatico" | "manual";
};

const DIMS_FACTURACION = ["dia", "semana", "mes", "dia_semana", "fuente", "clase", "metodo_pago"] as const;
const FILTROS_FACTURACION = ["dias_semana", "fuente", "clase", "metodo_pago"] as const;
const DIMS_ACTIVIDAD = ["dia", "semana", "mes", "dia_semana", "fuente", "modalidad", "duracion", "simuladores"] as const;
const FILTROS_ACTIVIDAD = ["dias_semana", "fuente", "modalidad", "duracion", "simuladores"] as const;

export const METRICAS_SEMANTICAS: Record<string, MetricaDef> = {
  facturacion_bruta: {
    id: "facturacion_bruta",
    etiqueta: "Facturación bruta",
    definicion:
      "Facturación total operativa BRUTA: todas las fuentes de ingreso operativo que reconoce Finanzas, automáticas y manuales. No incluye transferencias entre cuentas, préstamos, ajustes de saldo, egresos ni el Colectivo.",
    unidad: "ars",
    universo: "facturacion",
    reglaTemporal: "Cada fuente con su fecha contable canónica: turnero por fecha de servicio; lo web, gift cards, campeonatos y mensualidades por fecha de pago; los manuales por su fecha contable.",
    dimensiones: DIMS_FACTURACION,
    filtros: FILTROS_FACTURACION,
    ceros: "cuentan_como_cero",
  },
  facturacion_automatica: {
    id: "facturacion_automatica",
    etiqueta: "Facturación automática",
    definicion:
      "La parte de la facturación que generan los circuitos automáticos de SIM (turnero, reservas web, gift cards, campeonatos, mensualidades). Es lo que el panel de Finanzas llama 'ingresos automáticos'.",
    unidad: "ars",
    universo: "facturacion",
    reglaTemporal: "La misma fecha contable canónica de cada fuente.",
    dimensiones: DIMS_FACTURACION,
    filtros: FILTROS_FACTURACION,
    ceros: "cuentan_como_cero",
    claseFacturacion: "automatico",
  },
  facturacion_manual: {
    id: "facturacion_manual",
    etiqueta: "Ingresos manuales operativos",
    definicion:
      "Ingresos operativos cargados a mano en Finanzas. Excluye préstamos (financiamiento) y el ajuste inicial de saldo, que no son facturación.",
    unidad: "ars",
    universo: "facturacion",
    reglaTemporal: "Fecha contable del movimiento, dentro de su mes contable.",
    dimensiones: DIMS_FACTURACION,
    filtros: FILTROS_FACTURACION,
    ceros: "cuentan_como_cero",
    claseFacturacion: "manual",
  },
  cobros: {
    id: "cobros",
    etiqueta: "Cobros",
    definicion:
      "Cantidad de cobros registrados. Una venta pagada con dos medios cuenta como dos cobros: sirve para saber qué método de pago se usó más, no cuántas ventas hubo.",
    unidad: "cantidad",
    universo: "facturacion",
    reglaTemporal: "La misma fecha contable canónica de cada fuente.",
    dimensiones: DIMS_FACTURACION,
    filtros: FILTROS_FACTURACION,
    ceros: "cuentan_como_cero",
  },
  turnos: {
    id: "turnos",
    etiqueta: "Turnos comerciales",
    definicion:
      "Turnos comerciales vendidos, calculados con la modalidad persistida de cada fila: legacy conserva su fórmula histórica y v2 cuenta bloques comerciales por persona. Nunca entra el buffer de agenda.",
    unidad: "turnos",
    universo: "actividad",
    reglaTemporal: "Fecha de servicio.",
    dimensiones: DIMS_ACTIVIDAD,
    filtros: FILTROS_ACTIVIDAD,
    ceros: "cuentan_como_cero",
  },
  personas: {
    id: "personas",
    etiqueta: "Personas",
    definicion: "Personas atendidas, sumando las de cada operación. En el stand sale de las personas cargadas en el turno; en una reserva web, de la cantidad de simuladores reservados, con un mínimo de una.",
    unidad: "personas",
    universo: "actividad",
    reglaTemporal: "Fecha de servicio.",
    dimensiones: DIMS_ACTIVIDAD,
    filtros: FILTROS_ACTIVIDAD,
    ceros: "cuentan_como_cero",
  },
  operaciones: {
    id: "operaciones",
    etiqueta: "Operaciones",
    definicion: "Cantidad de operaciones registradas (un turno del stand o una reserva web).",
    unidad: "cantidad",
    universo: "actividad",
    reglaTemporal: "Fecha de servicio.",
    dimensiones: DIMS_ACTIVIDAD,
    filtros: FILTROS_ACTIVIDAD,
    ceros: "cuentan_como_cero",
  },
  minutos_actividad: {
    id: "minutos_actividad",
    etiqueta: "Minutos de actividad",
    definicion:
      "Minutos comerciales vendidos a clientes, por la modalidad de cada fila (legacy: turnos × 15; v2: duración × personas). No son horas trabajadas ni capacidad.",
    unidad: "minutos",
    universo: "actividad",
    reglaTemporal: "Fecha de servicio.",
    dimensiones: DIMS_ACTIVIDAD,
    filtros: FILTROS_ACTIVIDAD,
    ceros: "cuentan_como_cero",
  },
};
export const METRICAS_IDS = Object.keys(METRICAS_SEMANTICAS);
export const MAX_METRICAS = 3;

// ── Métricas que NO se calculan acá ─────────────────────────────────────────────
// Cada una dice a dónde ir. No se improvisa una fórmula ni se cruza un universo con otro.
export const METRICAS_DERIVADAS: Record<string, string> = {
  facturacion_neta: "La facturación NETA descuenta comisiones y se calcula por mes: pedila con consultar_finanzas (o comparar_periodos para dos meses).",
  ingresos_netos: "Los ingresos netos son mensuales (descuentan comisiones): usá consultar_finanzas.",
  ganancia: "La ganancia es mensual (ingresos − costos − gastos − inversiones − sueldo): usá consultar_finanzas.",
  rentabilidad: "La rentabilidad se calcula sobre el cierre mensual de Finanzas: usá consultar_finanzas.",
  horas_cronograma: "Las horas de cronograma son del universo del EQUIPO (jornadas programadas por empleado), no del de facturación ni de actividad: usá consultar_metricas_equipo o consultar_cronograma.",
  horas_trabajadas: "Las horas trabajadas salen del cronograma, no de las ventas: usá consultar_metricas_equipo.",
  ticket_promedio:
    "No hay un ticket promedio confiable acá: la facturación incluye campeonatos, mensualidades e ingresos manuales, y las operaciones son solo del Turnero y las reservas. Dividir uno por otro cruza dos universos distintos. Si querés el promedio por operación de una sola fuente, pedí esa fuente explícitamente.",
  ocupacion: "La ocupación compara minutos vendidos contra capacidad disponible y vive en Finanzas/Métricas, no en esta herramienta.",
};

// ── Cálculos determinísticos ────────────────────────────────────────────────────
export const CALCULOS = {
  total: { etiqueta: "Total", requiere: "nada" },
  promedio_dia_calendario: {
    etiqueta: "Promedio por día calendario",
    requiere: "nada",
    nota: "Divide por TODOS los días calendario del período que cumplen los filtros, incluidos los días sin movimientos.",
  },
  participacion: { etiqueta: "Participación", requiere: "dimension", nota: "Porcentaje de cada grupo sobre el total del período." },
  maximo: { etiqueta: "Máximo", requiere: "dimension_o_segmentacion", nota: "Con segmentación es el mejor día de cada grupo." },
  minimo: { etiqueta: "Mínimo", requiere: "dimension_o_segmentacion", nota: "Con segmentación es el peor día de cada grupo." },
  ranking: { etiqueta: "Ranking", requiere: "dimension" },
  diferencia: { etiqueta: "Diferencia", requiere: "segmentacion" },
  variacion_pct: { etiqueta: "Variación porcentual", requiere: "segmentacion" },
} as const;
export type Calculo = keyof typeof CALCULOS;
export const CALCULOS_VALIDOS = Object.keys(CALCULOS) as Calculo[];

export const SENTIDOS_RANKING = ["mejores", "peores"] as const;
export type SentidoRanking = (typeof SENTIDOS_RANKING)[number];

export const ORDENES = ["cronologico", "mayor_a_menor", "menor_a_mayor"] as const;
export type Orden = (typeof ORDENES)[number];

// ── Segmentación en dos grupos ──────────────────────────────────────────────────
// Una sola pregunta que compara dos recortes del MISMO período: hábiles vs fin de semana,
// automático vs manual, lunes vs viernes, una fuente vs otra.
export const TIPOS_SEGMENTACION = ["dias_semana", "clase", "fuente"] as const;
export type TipoSegmentacion = (typeof TIPOS_SEGMENTACION)[number];

export const CLASES_FACTURACION = ["automatico", "manual"] as const;

// ── Límites ─────────────────────────────────────────────────────────────────────
export const LIMITE_MAX = 200;
export const LIMITE_DEFAULT = 100;
export const RANGO_MAX_DIAS = 750; // ~2 años: alcanza para interanual y acota el motor.

// ── Compatibilidad ──────────────────────────────────────────────────────────────
export type Incompatibilidad = { motivo: string; campo: string };

/** Todas las métricas pedidas tienen que vivir en el mismo universo. */
export function universoComun(ids: readonly string[]): Universo | Incompatibilidad {
  const universos = [...new Set(ids.map((id) => METRICAS_SEMANTICAS[id]?.universo).filter(Boolean))] as Universo[];
  if (universos.length === 0) return { motivo: "No hay ninguna métrica válida en el pedido.", campo: "metricas" };
  if (universos.length > 1) {
    const nombres = universos.map((u) => UNIVERSOS[u].etiqueta).join(" y ");
    return {
      motivo: `No se pueden combinar métricas de ${nombres} en una sola tabla: se imputan con fechas distintas y no comparten denominador. Pedí un grupo por vez.`,
      campo: "metricas",
    };
  }
  return universos[0];
}

/** ¿La dimensión sirve para TODAS las métricas pedidas? */
export function dimensionCompatible(ids: readonly string[], dim: Dimension): Incompatibilidad | null {
  for (const id of ids) {
    const def = METRICAS_SEMANTICAS[id];
    if (!def) continue;
    if (!def.dimensiones.includes(dim)) {
      return {
        motivo: `"${def.etiqueta}" no se puede agrupar por ${DIMENSIONES[dim].etiqueta.toLowerCase()}. Admite: ${def.dimensiones.map((d) => DIMENSIONES[d].etiqueta.toLowerCase()).join(", ")}.`,
        campo: "dimensiones",
      };
    }
  }
  return null;
}

/** ¿El filtro sirve para TODAS las métricas pedidas? */
export function filtroCompatible(ids: readonly string[], filtro: FiltroId): Incompatibilidad | null {
  for (const id of ids) {
    const def = METRICAS_SEMANTICAS[id];
    if (!def) continue;
    if (!def.filtros.includes(filtro)) {
      return {
        motivo: `"${def.etiqueta}" no se puede filtrar por ${FILTROS[filtro].etiqueta.toLowerCase()}. Admite: ${def.filtros.map((f) => FILTROS[f].etiqueta.toLowerCase()).join(", ")}.`,
        campo: `filtros.${filtro}`,
      };
    }
  }
  return null;
}

/** ¿El cálculo tiene el contexto que necesita? */
export function calculoCompatible(calc: Calculo, ctx: { dimensiones: number; segmentado: boolean }): Incompatibilidad | null {
  const req = CALCULOS[calc].requiere;
  if (req === "dimension" && ctx.dimensiones === 0) {
    return { motivo: `"${CALCULOS[calc].etiqueta}" necesita una agrupación: decime por qué dimensión querés verlo.`, campo: "calculos" };
  }
  if (req === "dimension_o_segmentacion" && ctx.dimensiones === 0 && !ctx.segmentado) {
    return { motivo: `"${CALCULOS[calc].etiqueta}" necesita una agrupación o una segmentación: decime de qué grupos querés el extremo.`, campo: "calculos" };
  }
  if (req === "segmentacion" && !ctx.segmentado) {
    return { motivo: `"${CALCULOS[calc].etiqueta}" compara dos grupos: hace falta una segmentación.`, campo: "calculos" };
  }
  return null;
}

/** Dos dimensiones temporales juntas no aportan (semana ya contiene día). */
export function parDimensionesCompatible(dims: readonly Dimension[]): Incompatibilidad | null {
  if (dims.length < 2) return null;
  const temporales = dims.filter((d) => DIMENSIONES[d].temporal);
  if (temporales.length > 1) {
    return {
      motivo: `No tiene sentido agrupar por ${temporales.map((d) => DIMENSIONES[d].etiqueta.toLowerCase()).join(" y ")} a la vez: una contiene a la otra. Elegí una.`,
      campo: "dimensiones",
    };
  }
  return null;
}
