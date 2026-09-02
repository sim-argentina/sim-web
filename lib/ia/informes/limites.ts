// IA SIM · Bloque 4C — Límites configurables de generación de informes.
// Si se supera un límite NO se trunca en silencio: se explica y se propone
// dividir el informe o generar un CSV/Excel complementario.

function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export type LimitesInforme = {
  formatosPorConfirmacion: number;
  graficos: number;
  tablas: number;
  filasAnexo: number;       // por tabla de anexo
  filasTabla: number;       // por tabla del cuerpo
  paginasPdfEstimadas: number;
  tamanoArchivoBytes: number;
  secciones: number;
  columnasTabla: number;
  seriesGrafico: number;
  categoriasGrafico: number;
  tituloLen: number;
  textoLargoLen: number;    // resumen ejecutivo, secciones
  itemBreveLen: number;     // conclusiones, hallazgos, advertencias
  timeoutFormatoMs: number;
  concurrenciaFormatos: number;
};

export function getLimitesInforme(): LimitesInforme {
  return {
    formatosPorConfirmacion: num("IA_INF_FORMATOS_MAX", 5),
    graficos: num("IA_INF_GRAFICOS_MAX", 10),
    tablas: num("IA_INF_TABLAS_MAX", 20),
    filasAnexo: num("IA_INF_FILAS_ANEXO_MAX", 20000),
    filasTabla: num("IA_INF_FILAS_TABLA_MAX", 500),
    paginasPdfEstimadas: num("IA_INF_PAGINAS_PDF_MAX", 50),
    tamanoArchivoBytes: num("IA_INF_ARCHIVO_BYTES_MAX", 25 * 1024 * 1024),
    secciones: num("IA_INF_SECCIONES_MAX", 30),
    columnasTabla: num("IA_INF_COLUMNAS_MAX", 30),
    seriesGrafico: num("IA_INF_SERIES_MAX", 12),
    categoriasGrafico: num("IA_INF_CATEGORIAS_MAX", 200),
    tituloLen: num("IA_INF_TITULO_LEN", 200),
    textoLargoLen: num("IA_INF_TEXTO_LEN", 8000),
    itemBreveLen: num("IA_INF_ITEM_LEN", 600),
    timeoutFormatoMs: num("IA_INF_TIMEOUT_FORMATO_MS", 20000),
    concurrenciaFormatos: num("IA_INF_CONCURRENCIA", 2),
  };
}

export const FORMATOS_VALIDOS = ["pdf", "docx", "xlsx", "csv", "png"] as const;
export type FormatoArchivo = (typeof FORMATOS_VALIDOS)[number];

export const TIPOS_GRAFICO = ["barras", "lineas", "circular"] as const;
export type TipoGrafico = (typeof TIPOS_GRAFICO)[number];

// Tipos de dato de columna (para tipar celdas y unidades en cada renderer).
export const TIPOS_COLUMNA = ["texto", "entero", "decimal", "ars", "usd", "porcentaje", "horas", "minutos", "fecha"] as const;
export type TipoColumna = (typeof TIPOS_COLUMNA)[number];
