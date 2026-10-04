// IA SIM · Bloque 5C — CATÁLOGO DE CAPACIDADES del planificador multiherramienta.
//
// No describe las herramientas de nuevo: cada capacidad apunta al registro REAL
// (lib/ia/tools.ts) y los argumentos se validan contra el schema que esa herramienta ya
// declara. Lo que se agrega acá es lo que el registro no dice y el planificador necesita
// saber: a qué dominio y universo pertenece el resultado, qué regla temporal usa, si se puede
// correr en paralelo, qué cuesta, si toca datos sensibles y con qué no se puede combinar.
//
// Una herramienta nueva aparece sola en el inventario; para que el PLANIFICADOR la use hace
// falta declararla acá, y una prueba contractual avisa si el registro y este catálogo
// divergen (capacidades.contrato.test.ts).


/** Universo de los datos que devuelve una capacidad: no se cruzan entre sí sin una regla. */
export const UNIVERSOS_PLAN = {
  facturacion: {
    etiqueta: "Facturación",
    regla: "Composición canónica de Finanzas: turnero por fecha de servicio; reservas web, gift cards, campeonatos y mensualidades por fecha de pago; ingresos manuales por su fecha contable.",
  },
  actividad: {
    etiqueta: "Actividad",
    regla: "Turnero del stand y reservas web por fecha de SERVICIO, con la modalidad persistida de cada operación.",
  },
  equipo: {
    etiqueta: "Equipo y cronograma",
    regla: "Jornadas programadas del cronograma CONFIRMADO, por integrante y día.",
  },
  financiero: {
    etiqueta: "Cierre financiero",
    regla: "Cierre mensual de Finanzas: bruto, comisiones, neto, costos, gastos y ganancia. Mensual, no diario.",
  },
  diagnostico: {
    etiqueta: "Diagnóstico",
    regla: "Señales calculadas sobre los datos internos (anomalías, proyecciones). No son hechos de negocio nuevos.",
  },
  documental: {
    etiqueta: "Conocimiento documental",
    regla: "Documentos de conocimiento activos de SIM. Texto, no cifras de negocio.",
  },
} as const;
export type UniversoPlan = keyof typeof UNIVERSOS_PLAN;

/** De dónde sale la fecha con la que una capacidad imputa sus datos. */
export const REGLAS_TEMPORALES = {
  mixta_canonica: "Cada fuente con su fecha contable canónica (servicio para el turnero, pago para lo web).",
  servicio: "Fecha de servicio.",
  pago: "Fecha de pago.",
  cronograma: "Fecha de la jornada programada en el cronograma.",
  mes_contable: "Mes contable del cierre.",
  ninguna: "Sin dimensión temporal.",
} as const;
export type ReglaTemporal = keyof typeof REGLAS_TEMPORALES;

export type Capacidad = {
  /** Nombre EXACTO en el registro de herramientas. */
  id: string;
  dominio: string;
  descripcion: string;
  universo: UniversoPlan;
  reglaTemporal: ReglaTemporal;
  /** Qué período admite: un mes, dos meses, o una ventana flexible. */
  periodos: "mes" | "dos_meses" | "ventana" | "ninguno";
  /** Si devuelve datos estructurados reutilizables como evidencia. */
  salida: "estructurada" | "texto";
  /** Métricas que la capacidad puede aportar como evidencia. Vacío = no aporta cifras. */
  metricas: readonly string[];
  /**
   * true  → la capacidad publica SIEMPRE todas sus métricas (su salida es fija);
   * false → publica las que se le pidieron en esa llamada (como la analítica interna).
   * El contrato exige cobertura total solo en el primer caso.
   */
  metricasFijas: boolean;
  /** Se puede ejecutar a la vez que otras capacidades (no muta nada ni depende de orden). */
  paralelizable: boolean;
  /** Costo relativo de la lectura, para acotar un plan. */
  costo: 1 | 2 | 3;
  /** Datos sensibles que podría devolver y que NO deben salir en un agregado. */
  datosSensibles: "ninguno" | "nombres_equipo" | "documental";
  /** Política de web: todas las capacidades del planificador son internas. */
  web: "prohibida";
  /** Con qué capacidades NO se puede combinar, y por qué. */
  incompatibleCon: readonly string[];
};

export const CAPACIDADES: Record<string, Capacidad> = {
  consulta_analitica_interna: {
    id: "consulta_analitica_interna",
    dominio: "Analítica interna",
    descripcion: "Facturación y actividad con filtros, hasta dos agrupaciones, cálculos y segmentación.",
    universo: "facturacion", // el universo real lo fija la métrica pedida; se resuelve al validar
    reglaTemporal: "mixta_canonica",
    periodos: "ventana",
    salida: "estructurada",
    metricas: ["facturacion_bruta", "facturacion_automatica", "facturacion_manual", "cobros", "turnos", "personas", "operaciones", "minutos_actividad"],
    metricasFijas: false,
    paralelizable: true,
    costo: 2,
    datosSensibles: "ninguno",
    web: "prohibida",
    incompatibleCon: [],
  },
  consultar_cronograma: {
    id: "consultar_cronograma",
    dominio: "Cronograma",
    descripcion: "Estado del cronograma de un mes, días abiertos y cerrados y horas programadas por integrante.",
    universo: "equipo",
    reglaTemporal: "cronograma",
    periodos: "mes",
    salida: "estructurada",
    metricas: ["horas_programadas", "dias_abiertos"],
    metricasFijas: true,
    paralelizable: true,
    costo: 1,
    datosSensibles: "nombres_equipo",
    web: "prohibida",
    incompatibleCon: [],
  },
  consultar_metricas_stand_reservas: {
    id: "consultar_metricas_stand_reservas",
    dominio: "Operación",
    descripcion: "Agregados del mes del Turnero del stand y de las reservas web, por separado.",
    universo: "actividad",
    reglaTemporal: "servicio",
    periodos: "mes",
    salida: "estructurada",
    metricas: ["turnos", "personas", "minutos_actividad", "operaciones"],
    metricasFijas: true,
    paralelizable: true,
    costo: 1,
    datosSensibles: "ninguno",
    web: "prohibida",
    incompatibleCon: [],
  },
  consultar_finanzas: {
    id: "consultar_finanzas",
    dominio: "Finanzas",
    descripcion: "Cierre financiero del mes: bruto, comisiones, neto, costos, gastos y ganancia.",
    universo: "financiero",
    reglaTemporal: "mes_contable",
    periodos: "mes",
    salida: "estructurada",
    metricas: ["ingresos_brutos", "ingresos_netos", "comisiones", "ganancia_sim"],
    metricasFijas: true,
    paralelizable: true,
    costo: 2,
    datosSensibles: "ninguno",
    web: "prohibida",
    incompatibleCon: [],
  },
  detectar_anomalias: {
    id: "detectar_anomalias",
    dominio: "Diagnóstico",
    descripcion: "Días atípicos de turnos o facturación dentro de un mes.",
    universo: "diagnostico",
    reglaTemporal: "servicio",
    periodos: "mes",
    salida: "estructurada",
    metricas: [],
    metricasFijas: true,
    paralelizable: true,
    costo: 2,
    datosSensibles: "ninguno",
    web: "prohibida",
    incompatibleCon: [],
  },
  proyectar_periodo: {
    id: "proyectar_periodo",
    dominio: "Diagnóstico",
    descripcion: "Proyección del cierre de un mes EN CURSO, en tres escenarios.",
    universo: "diagnostico",
    reglaTemporal: "servicio",
    periodos: "mes",
    salida: "estructurada",
    metricas: [],
    metricasFijas: true,
    paralelizable: true,
    costo: 2,
    datosSensibles: "ninguno",
    web: "prohibida",
    // Una proyección es una estimación: no se compara contra un mes cerrado como si fuera un hecho.
    incompatibleCon: ["consultar_finanzas"],
  },
};

export const CAPACIDADES_IDS = Object.keys(CAPACIDADES);

/**
 * Capacidades que el planificador NO usa, con el motivo. Están en el inventario pero quedan
 * fuera de un plan multiherramienta a propósito; se declaran para que la decisión sea
 * auditable y para que la prueba contractual no las marque como olvidadas.
 */
export const FUERA_DEL_PLANIFICADOR: Record<string, string> = {
  analizar_multiherramienta:
    "Es el planificador mismo: un plan no puede contener otro plan. Esa recursión es justamente lo que 5C deja afuera.",
  emitir_sintesis_analitica:
    "Cierra un análisis ya ejecutado citando sus evidencias; no es un paso que produzca datos.",
  comparar_periodos:
    "Compara dos meses por su cuenta y ya publica su propio bloque determinístico. Dentro de un plan duplicaría los cálculos que el planificador hace server-side con evidencias.",
  consultar_metricas_equipo:
    "Atribuye actividad y facturación al integrante presente en el cronograma. Esa atribución no se puede usar como evidencia de desempeño individual (estar programado no demuestra la venta), así que el planificador pide horas programadas al cronograma y actividad al universo de actividad, por separado.",
  consultar_empleados: "Devuelve el padrón del equipo, no cifras: no aporta evidencia cuantitativa.",
  consultar_colectivo: "El Colectivo se administra aparte y no forma parte de Finanzas SIM.",
  preparar_informe: "Es terminal y produce un borrador de archivo, no evidencia.",
  buscar_conocimiento_sim: "Devuelve texto documental, no cifras comparables.",
  obtener_fragmento_documento: "Amplía un fragmento de texto, no aporta cifras.",
  listar_documentos_conocimiento: "Lista documentos, no aporta cifras.",
};

/** ¿Existe la capacidad y está habilitada para un plan interno? */
export function capacidadDe(id: string): Capacidad | null {
  return CAPACIDADES[id] ?? null;
}

/**
 * Acceso a los schemas REALES de las herramientas. Se inyecta en vez de importar el registro:
 * lib/ia/tools.ts importa el planificador, así que pedirle el registro desde acá en el nivel
 * superior armaría un ciclo de imports. Quien ejecuta ya tiene el registro inicializado.
 */
export type AccesoSchemas = {
  existe(id: string): boolean;
  permitidos(id: string): string[];
  requeridos(id: string): string[];
};

/** Construye el acceso a partir de un registro de herramientas con su schema declarado. */
export function accesoDesdeRegistro(registro: Record<string, { schema?: unknown }>): AccesoSchemas {
  const schemaDe = (id: string): Record<string, unknown> | null => {
    const h = registro[id];
    return h && h.schema && typeof h.schema === "object" ? (h.schema as Record<string, unknown>) : null;
  };
  return {
    existe: (id) => Boolean(registro[id]),
    permitidos: (id) => {
      const schema = schemaDe(id);
      const props = schema && typeof schema.properties === "object" ? (schema.properties as Record<string, unknown>) : {};
      return Object.keys(props);
    },
    requeridos: (id) => {
      const schema = schemaDe(id);
      return Array.isArray(schema?.required) ? (schema!.required as string[]) : [];
    },
  };
}
