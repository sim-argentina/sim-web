// IA SIM · Bloque 4C — Modelo COMÚN del informe. Claude produce ÚNICAMENTE esta
// especificación estructurada; NUNCA binarios. El servidor la valida estrictamente
// antes de crear un borrador. El render a PDF/DOCX/XLSX/CSV/PNG es determinístico y
// local (no consume tokens).

import { getLimitesInforme, TIPOS_COLUMNA, TIPOS_GRAFICO, type TipoColumna, type TipoGrafico, type LimitesInforme } from "@/lib/ia/informes/limites";

export type CeldaValor = string | number | boolean | null;

export type ColumnaTabla = { clave: string; etiqueta: string; tipo: TipoColumna };
export type Tabla = { titulo: string; columnas: ColumnaTabla[]; filas: CeldaValor[][]; nota?: string | null };

export type SerieGrafico = { nombre: string; valores: number[]; unidad?: string | null };
export type Grafico = { tipo: TipoGrafico; titulo: string; categorias: string[]; series: SerieGrafico[]; nota?: string | null };

export type Seccion = { titulo: string; cuerpo: string };
export type Fuente = { modulo: string; periodo?: string | null; registros?: number | null; actualizado?: string | null };

// Un valor del informe que el admin alteró manualmente respecto del sistema.
export type CambioManual = {
  ubicacion: string;            // dónde está (ej: "tabla:Facturación/fila 2/col neta")
  etiqueta: string;
  valor_original: CeldaValor;   // lo que devolvió el sistema
  valor_nuevo: CeldaValor;      // lo que puso el admin
  motivo?: string | null;
};

export type InformeSpec = {
  titulo: string;
  subtitulo?: string | null;
  tipo_informe: string;                 // ej: "analitico_mensual", "comparacion", "foda"
  periodo?: string | null;              // ej: "2026-08" o "2026-08 vs 2026-07"
  fecha_corte?: string | null;          // fecha/hora de corte para meses incompletos
  resumen_ejecutivo: string;
  conclusiones: string[];
  hallazgos: string[];                  // hallazgos y anomalías (breves, con evidencia)
  secciones: Seccion[];                 // narrativa
  tablas: Tabla[];
  graficos: Grafico[];
  fuentes: Fuente[];
  metodologia?: string | null;
  modulos_consultados: string[];
  registros_utilizados?: number | null;
  anexo: Tabla[];                       // datos de respaldo (sin PII por defecto)
  advertencias: string[];
  datos_faltantes: string[];
  cambios_manuales: CambioManual[];
  incluye_pii: boolean;                 // el admin declaró explícitamente incluir PII
};

export type Validacion = { ok: true; spec: InformeSpec } | { ok: false; errores: string[] };

function esStr(v: unknown): v is string { return typeof v === "string"; }
function arr<T = unknown>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function strLimpio(v: unknown, max: number): string { return esStr(v) ? v.trim().slice(0, max) : ""; }

// Valida y NORMALIZA la especificación. Recorta a límites de longitud, pero
// RECHAZA (no trunca) cuando se superan límites estructurales (cantidad de
// secciones/tablas/columnas/filas/gráficos): el llamador debe explicar y proponer dividir.
export function validarInforme(entrada: unknown, lim: LimitesInforme = getLimitesInforme()): Validacion {
  const errores: string[] = [];
  const o = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;

  const titulo = strLimpio(o.titulo, lim.tituloLen);
  if (!titulo) errores.push("El informe necesita un título.");
  const tipo_informe = strLimpio(o.tipo_informe, 60) || "analitico";
  const resumen_ejecutivo = strLimpio(o.resumen_ejecutivo, lim.textoLargoLen);
  if (!resumen_ejecutivo) errores.push("Falta el resumen ejecutivo.");

  const listaBreve = (v: unknown, nombre: string): string[] => {
    const items = arr(v).map((x) => strLimpio(x, lim.itemBreveLen)).filter(Boolean);
    if (items.length > 100) errores.push(`Demasiados ítems en ${nombre} (máx 100).`);
    return items.slice(0, 100);
  };

  const conclusiones = listaBreve(o.conclusiones, "conclusiones");
  const hallazgos = listaBreve(o.hallazgos, "hallazgos");
  const advertencias = listaBreve(o.advertencias, "advertencias");
  const datos_faltantes = listaBreve(o.datos_faltantes, "datos_faltantes");
  const modulos_consultados = listaBreve(o.modulos_consultados, "modulos_consultados");

  // Secciones narrativas
  const secRaw = arr(o.secciones);
  if (secRaw.length > lim.secciones) errores.push(`Demasiadas secciones (${secRaw.length} > ${lim.secciones}). Dividí el informe.`);
  const secciones: Seccion[] = secRaw.slice(0, lim.secciones).map((s) => {
    const ss = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return { titulo: strLimpio(ss.titulo, lim.tituloLen), cuerpo: strLimpio(ss.cuerpo, lim.textoLargoLen) };
  }).filter((s) => s.titulo || s.cuerpo);

  // Tablas (cuerpo) y anexo comparten validador
  const validarTablas = (v: unknown, nombre: string, filasMax: number): Tabla[] => {
    const raw = arr(v);
    if (raw.length > lim.tablas) errores.push(`Demasiadas ${nombre} (${raw.length} > ${lim.tablas}).`);
    return raw.slice(0, lim.tablas).map((t, ti) => {
      const tt = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      const colsRaw = arr(tt.columnas);
      if (colsRaw.length > lim.columnasTabla) errores.push(`${nombre}[${ti}] tiene demasiadas columnas (${colsRaw.length} > ${lim.columnasTabla}).`);
      const columnas: ColumnaTabla[] = colsRaw.slice(0, lim.columnasTabla).map((c, ci) => {
        const cc = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        const tipo = (TIPOS_COLUMNA as readonly string[]).includes(String(cc.tipo)) ? (cc.tipo as TipoColumna) : "texto";
        return { clave: strLimpio(cc.clave, 60) || `c${ci}`, etiqueta: strLimpio(cc.etiqueta, 120) || `Columna ${ci + 1}`, tipo };
      });
      const filasRaw = arr<unknown[]>(tt.filas);
      if (filasRaw.length > filasMax) errores.push(`${nombre}[${ti}] tiene demasiadas filas (${filasRaw.length} > ${filasMax}). Generá un CSV/Excel complementario.`);
      const ncols = Math.max(columnas.length, 1);
      const filas: CeldaValor[][] = filasRaw.slice(0, filasMax).map((f) => {
        const fila = arr<CeldaValor>(f).slice(0, ncols);
        while (fila.length < columnas.length) fila.push(null);
        return fila.map((cel) => (cel == null ? null : typeof cel === "number" || typeof cel === "boolean" ? cel : String(cel).slice(0, 500)));
      });
      return { titulo: strLimpio(tt.titulo, lim.tituloLen), columnas, filas, nota: strLimpio(tt.nota, lim.itemBreveLen) || null };
    }).filter((t) => t.columnas.length > 0);
  };
  const tablas = validarTablas(o.tablas, "tablas", lim.filasTabla);
  const anexo = validarTablas(o.anexo, "anexo", lim.filasAnexo);

  // Gráficos
  const grafRaw = arr(o.graficos);
  if (grafRaw.length > lim.graficos) errores.push(`Demasiados gráficos (${grafRaw.length} > ${lim.graficos}).`);
  const graficos: Grafico[] = grafRaw.slice(0, lim.graficos).map((g, gi) => {
    const gg = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
    const tipo = (TIPOS_GRAFICO as readonly string[]).includes(String(gg.tipo)) ? (gg.tipo as TipoGrafico) : "barras";
    const categorias = arr(gg.categorias).map((c) => strLimpio(c, 80)).slice(0, lim.categoriasGrafico);
    const seriesRaw = arr(gg.series);
    if (seriesRaw.length > lim.seriesGrafico) errores.push(`gráfico[${gi}] tiene demasiadas series (${seriesRaw.length} > ${lim.seriesGrafico}).`);
    const series: SerieGrafico[] = seriesRaw.slice(0, lim.seriesGrafico).map((s) => {
      const ss = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const valores = arr(ss.valores).map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0)).slice(0, lim.categoriasGrafico);
      return { nombre: strLimpio(ss.nombre, 80) || "Serie", valores, unidad: strLimpio(ss.unidad, 16) || null };
    });
    // Un circular necesita exactamente una serie con valores no negativos.
    if (tipo === "circular") {
      if (series.length !== 1) errores.push(`gráfico[${gi}] circular debe tener exactamente 1 serie.`);
      if (series[0]?.valores.some((v) => v < 0)) errores.push(`gráfico[${gi}] circular no admite valores negativos.`);
    }
    // Longitud de valores debe coincidir con categorías.
    for (const s of series) {
      if (categorias.length > 0 && s.valores.length !== categorias.length) errores.push(`gráfico[${gi}] serie "${s.nombre}": ${s.valores.length} valores ≠ ${categorias.length} categorías.`);
    }
    if (categorias.length === 0) errores.push(`gráfico[${gi}] no tiene categorías.`);
    if (series.length === 0) errores.push(`gráfico[${gi}] no tiene series.`);
    return { tipo, titulo: strLimpio(gg.titulo, lim.tituloLen) || "Gráfico", categorias, series, nota: strLimpio(gg.nota, lim.itemBreveLen) || null };
  });

  // Fuentes
  const fuentes: Fuente[] = arr(o.fuentes).slice(0, 100).map((f) => {
    const ff = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    return {
      modulo: strLimpio(ff.modulo, 200) || "fuente",
      periodo: strLimpio(ff.periodo, 60) || null,
      registros: typeof ff.registros === "number" && Number.isFinite(ff.registros) ? ff.registros : null,
      actualizado: strLimpio(ff.actualizado, 40) || null,
    };
  });

  // Cambios manuales
  const cambios_manuales: CambioManual[] = arr(o.cambios_manuales).slice(0, 500).map((c) => {
    const cc = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const cel = (v: unknown): CeldaValor => (v == null ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 500));
    return { ubicacion: strLimpio(cc.ubicacion, 200), etiqueta: strLimpio(cc.etiqueta, 120), valor_original: cel(cc.valor_original), valor_nuevo: cel(cc.valor_nuevo), motivo: strLimpio(cc.motivo, lim.itemBreveLen) || null };
  }).filter((c) => c.ubicacion || c.etiqueta);

  if (errores.length > 0) return { ok: false, errores };

  const spec: InformeSpec = {
    titulo, subtitulo: strLimpio(o.subtitulo, lim.tituloLen) || null, tipo_informe,
    periodo: strLimpio(o.periodo, 60) || null, fecha_corte: strLimpio(o.fecha_corte, 40) || null,
    resumen_ejecutivo, conclusiones, hallazgos, secciones, tablas, graficos, fuentes,
    metodologia: strLimpio(o.metodologia, lim.textoLargoLen) || null, modulos_consultados,
    registros_utilizados: typeof o.registros_utilizados === "number" && Number.isFinite(o.registros_utilizados) ? o.registros_utilizados : null,
    anexo, advertencias, datos_faltantes, cambios_manuales,
    incluye_pii: o.incluye_pii === true,
  };
  return { ok: true, spec };
}

// Schema JSON para el modelo (herramienta preparar_informe). Deliberadamente
// permisivo en tipos (el servidor valida/normaliza), estricto en forma.
export const SCHEMA_PREPARAR_INFORME: Record<string, unknown> = {
  type: "object",
  properties: {
    titulo: { type: "string", description: "Título del informe." },
    subtitulo: { type: "string" },
    tipo_informe: { type: "string", description: "analitico_mensual | comparacion | foda | otro" },
    periodo: { type: "string", description: "Período analizado, ej '2026-08' o '2026-08 vs 2026-07'." },
    fecha_corte: { type: "string", description: "Fecha/hora de corte si el mes está incompleto." },
    resumen_ejecutivo: { type: "string" },
    conclusiones: { type: "array", items: { type: "string" } },
    hallazgos: { type: "array", items: { type: "string" }, description: "Hallazgos y anomalías breves con evidencia." },
    secciones: { type: "array", items: { type: "object", properties: { titulo: { type: "string" }, cuerpo: { type: "string" } } } },
    tablas: { type: "array", items: { type: "object" }, description: "Tablas del cuerpo. Cada una: {titulo, columnas:[{clave,etiqueta,tipo}], filas:[[...]]}. tipo ∈ texto|entero|decimal|ars|usd|porcentaje|horas|minutos|fecha." },
    graficos: { type: "array", items: { type: "object" }, description: "Especificaciones de gráficos: {tipo: barras|lineas|circular, titulo, categorias:[...], series:[{nombre, valores:[...], unidad}]}." },
    fuentes: { type: "array", items: { type: "object", properties: { modulo: { type: "string" }, periodo: { type: "string" }, registros: { type: "number" }, actualizado: { type: "string" } } } },
    metodologia: { type: "string" },
    modulos_consultados: { type: "array", items: { type: "string" } },
    registros_utilizados: { type: "number" },
    anexo: { type: "array", items: { type: "object" }, description: "Tablas de respaldo (sin PII por defecto)." },
    advertencias: { type: "array", items: { type: "string" } },
    datos_faltantes: { type: "array", items: { type: "string" } },
    cambios_manuales: { type: "array", items: { type: "object" } },
    incluye_pii: { type: "boolean", description: "true SOLO si el administrador pidió explícitamente incluir datos personales." },
  },
  required: ["titulo", "tipo_informe", "resumen_ejecutivo", "modulos_consultados"],
  additionalProperties: false,
};
