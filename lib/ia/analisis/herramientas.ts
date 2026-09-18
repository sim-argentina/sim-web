// IA SIM · Bloque 4E — Herramientas CERRADAS de comparación/anomalías/proyección. Mismo patrón
// que lib/ia/tools.ts: el modelo NUNCA elige SQL, solo invoca estas funciones tipadas. Los
// resultados van en `resumen` de forma ESTRUCTURADA (no solo un resumen de auditoría): así, si
// el administrador pide después un informe, el snapshot completo del análisis se reutiliza
// automáticamente vía server.ts (mismo mecanismo que preparar_informe → snapshot_fuentes, sin
// tabla nueva — ver lib/ia/informes/informesServer.ts).

import { ToolParamError, type ToolDef, type ToolResultado } from "@/lib/ia/tools";
import { pedirAnioMes, schemaAnioMes } from "@/lib/ia/toolsCompartido";
import { ejecutarComparacion, type ParamsComparar } from "@/lib/ia/analisis/comparacionServer";
import { ejecutarDeteccionAnomalias } from "@/lib/ia/analisis/anomaliasServer";
import { ejecutarProyeccion } from "@/lib/ia/analisis/proyeccionServer";
import { resolverMesRelativo, TOKENS_PERIODO_MES, type TokenPeriodoMes } from "@/lib/ia/analisis/periodoRelativo";

const ahoraISO = () => new Date().toISOString();

export const NOMBRE_COMPARAR_PERIODOS = "comparar_periodos";

const schemaPeriodo = {
  type: "object",
  properties: {
    anio: { type: "integer" },
    mes: { type: "integer" },
    relativo: {
      type: "string",
      enum: [...TOKENS_PERIODO_MES],
      description:
        "Usalo en vez de anio/mes cuando el pedido use una expresión relativa inequívoca: 'este_mes', 'mes_pasado' o 'mismo_mes_anio_pasado' (el mismo mes del año anterior). " +
        "El servidor ya conoce la fecha actual de Córdoba: NUNCA le preguntes al administrador qué mes es 'este mes' ni cuál es la fecha de hoy.",
    },
  },
  additionalProperties: false,
};

// Un período viene en `anio`+`mes` (explícitos) O en `relativo` (el servidor resuelve la fecha
// actual de Córdoba). Nunca los dos vacíos: eso sí es una aclaración legítima (falta información).
function pedirPeriodo(input: Record<string, unknown> | undefined): { anio: number; mes: number } {
  const raw = input ?? {};
  if (typeof raw.relativo === "string") {
    if (!TOKENS_PERIODO_MES.includes(raw.relativo as TokenPeriodoMes)) {
      throw new ToolParamError(`relativo inválido: "${raw.relativo}". Usá uno de: ${TOKENS_PERIODO_MES.join(", ")}.`);
    }
    return resolverMesRelativo(raw.relativo as TokenPeriodoMes);
  }
  return pedirAnioMes(raw);
}

// ── comparar_periodos ───────────────────────────────────────────────────────────
export const comparar_periodos: ToolDef = {
  nombre: NOMBRE_COMPARAR_PERIODOS,
  descripcion:
    "Compara DOS meses (actividad de equipo o financiero), DOS integrantes dentro del mismo mes, o Turnero Stand vs Reservas web dentro del mismo mes. " +
    "Todos los números (diferencias, variación %) los calcula el servidor: nunca hagas la aritmética vos. Si un mes está en curso, el servidor ya compara por TRAMO EQUIVALENTE (mismos días transcurridos) y te da aparte la referencia del mes completo — no mezcles ambas cosas en una sola variación. " +
    "PERÍODOS RELATIVOS: si el administrador dice 'este mes', 'mes pasado' o 'el mismo mes del año pasado', usá periodo_a.relativo / periodo_b.relativo (NO calcules vos el año/mes ni preguntes la fecha de hoy: el servidor ya sabe qué día es en Córdoba). Preguntá SOLO si el período es realmente ambiguo (por ejemplo, un mes suelto sin año y sin ningún otro período de referencia). " +
    "Para comparar con datos EXTERNOS/mercado, no uses esta herramienta: pedí un FODA mixto.",
  schema: {
    type: "object",
    properties: {
      modo: { type: "string", enum: ["equipo", "financiero"], description: "'equipo': turnos/personas/facturación/horas. 'financiero': ingresos/costos/ganancia (excluye Colectivo)." },
      periodo_a: schemaPeriodo,
      periodo_b: { ...schemaPeriodo, description: "Omitilo SOLO si comparás integrante_a vs integrante_b o comparar_fuentes dentro de periodo_a." },
      integrante_a: { type: "string", description: "Nombre de un integrante (para comparar dos integrantes DENTRO de periodo_a; requiere integrante_b y omitir periodo_b)." },
      integrante_b: { type: "string" },
      comparar_fuentes: { type: "boolean", description: "true = comparar Turnero Stand vs Reservas web DENTRO de periodo_a (omitir periodo_b)." },
      ajustar_inflacion: { type: "boolean", description: "Solo con modo='financiero' y periodo_b presente: agrega la comparación en pesos constantes (además de la nominal), si hay índice IPC cargado para ambos períodos." },
    },
    required: ["modo", "periodo_a"],
    additionalProperties: false,
  },
  ejecutar: async (input): Promise<ToolResultado> => {
    const periodoA = pedirPeriodo(input.periodo_a as Record<string, unknown>);
    const periodoBRaw = input.periodo_b as Record<string, unknown> | undefined;
    const periodoBPresente = !!periodoBRaw && (periodoBRaw.relativo != null || (periodoBRaw.anio != null && periodoBRaw.mes != null));
    const params: ParamsComparar = {
      modo: input.modo === "financiero" ? "financiero" : "equipo",
      periodoA,
      periodoB: periodoBPresente ? pedirPeriodo(periodoBRaw) : undefined,
      integranteA: typeof input.integrante_a === "string" ? input.integrante_a : undefined,
      integranteB: typeof input.integrante_b === "string" ? input.integrante_b : undefined,
      compararFuentes: input.comparar_fuentes === true,
      ajustarInflacion: input.ajustar_inflacion === true,
    };
    const r = await ejecutarComparacion(params);
    if (!r.ok) {
      return { contenido: JSON.stringify({ error: r.motivo }), resumen: { ok: false, motivo: r.motivo }, fuente: { modulo: "Comparación de períodos", actualizado: ahoraISO() } };
    }
    const reglaBase =
      "variacionPct=null significa 'no calculable' (el valor base es cero): nunca lo reemplaces por 0% ni lo inventes. " +
      "En cada métrica, 'ladoA' es SIEMPRE el período más antiguo/base y 'ladoB' el más reciente/comparado (el servidor los ordena así aunque el pedido los haya mencionado al revés): la variación es (B-A)/|A|, no al revés. " +
      "USÁ TAL CUAL los campos 'valorAFormateado', 'valorBFormateado', 'diferenciaFormateada' y 'variacionFormateada' (ya traen signo, separador de miles y unidad correctos) en la tabla y en el texto: NO recalcules la diferencia ni el porcentaje, NO reformatees los números vos mismo, y NO les cambies el signo. El mismo número debe aparecer igual en el resumen, en la tabla y en el análisis.";
    // Bloque 4E (hotfix 3) — 'resumen' (auditoría/persistencia/snapshot de informes) conserva
    // 'referenciaCompleta' completa. 'contenido' (lo único que LEE el modelo) la excluye: el
    // servidor la agrega como bloque aparte, DETERMINÍSTICAMENTE, después de la respuesta del
    // modelo (ver construirBloqueReferenciaCompleta + lib/ia/server.ts). Así el modelo no tiene
    // las cifras para narrarla ni omitirla por su cuenta: nunca dependió de que decidiera
    // mencionarla, que era exactamente el bug (el payload ya la traía; el modelo simplemente no
    // siempre la incluía en su texto final).
    const { referenciaCompleta, ...resultadoSinReferencia } = r;
    const contenidoPayload = {
      ...resultadoSinReferencia,
      _unidades: { ars: "Pesos argentinos (ARS), enteros.", horas: "Horas (ya convertidas; NUNCA confundir con minutos de actividad de clientes).", minutos: "Minutos de actividad comercial de clientes (turnos × 15), NO horas trabajadas del cronograma." },
      _regla: reglaBase + (referenciaCompleta ? " Existe una referencia del mes completo de " + referenciaCompleta.etiqueta + ": NO la menciones, no repitas sus cifras ni armes una sección para ella — el sistema la agrega automáticamente aparte, después de tu respuesta." : ""),
    };
    const resumenPayload = { ...r, _unidades: contenidoPayload._unidades, _regla: reglaBase };
    return {
      contenido: JSON.stringify(contenidoPayload),
      resumen: resumenPayload,
      fuente: { modulo: "Comparación de períodos", periodo: r.ladoA.periodo, registros: r.ladoA.registros + r.ladoB.registros, actualizado: ahoraISO() },
    };
  },
};

// ── Bloque 4E (hotfix 3) — bloque DETERMINÍSTICO de "referencia del mes completo" ──────────
// El servidor (server.ts) llama a esto con el 'resumen' de la última ejecución OK de
// comparar_periodos y, si corresponde, obtiene el texto a anexar. Nunca depende de que el
// modelo narre la referencia: los valores salen del resultado ESTRUCTURADO de la herramienta.
const ETIQUETAS_REFERENCIA: Record<string, string> = { turnos: "Turnos", personas: "Personas", facturacion_bruta: "Facturación bruta" };
// Marcador propio del ensamblador (no una palabra genérica como "agosto"): si el modelo ya
// escribió este encabezado por su cuenta, no se duplica. Es un mecanismo del ensamblador, no
// una búsqueda frágil de una palabra que podría aparecer por cualquier otro motivo.
export const MARCADOR_REFERENCIA_COMPLETA = "referencia del mes completo";

export function construirBloqueReferenciaCompleta(resumen: Record<string, unknown> | null | undefined): string | null {
  if (!resumen || resumen.modoPeriodo !== "equivalente") return null;
  const referenciaCompleta = resumen.referenciaCompleta as { etiqueta: string; metricas: Array<{ clave: string; valorBFormateado: string }> } | null | undefined;
  if (!referenciaCompleta) {
    // El motor debía traer una referencia (modo equivalente) pero no llegó: se avisa
    // explícitamente en vez de omitirla en silencio o inventar un valor.
    return "**Referencia del mes completo:** no se pudo obtener en este momento (no afecta el análisis del tramo equivalente de arriba).";
  }
  const metricas = referenciaCompleta.metricas ?? [];
  const turnos = metricas.find((m) => m.clave === "turnos");
  const facturacion = metricas.find((m) => m.clave === "facturacion_bruta");
  if (!turnos || !facturacion) {
    return "**Referencia del mes completo:** no se pudo obtener en este momento (no afecta el análisis del tramo equivalente de arriba).";
  }
  const nombreMes = referenciaCompleta.etiqueta.replace(/\s*\(mes completo.*\)\s*$/i, "").trim();
  const personas = metricas.find((m) => m.clave === "personas");
  const aMostrar = [turnos, ...(personas ? [personas] : []), facturacion];
  const lineas = aMostrar.map((m) => `- ${ETIQUETAS_REFERENCIA[m.clave] ?? m.clave}: ${m.valorBFormateado}`);
  return [
    `**Referencia del mes completo de ${nombreMes}**`,
    `${nombreMes} completo cerró con:`,
    ...lineas,
    "",
    "_Esta referencia corresponde al mes completo y no interviene en la diferencia ni en la variación del tramo equivalente._",
  ].join("\n");
}

// ── detectar_anomalias ──────────────────────────────────────────────────────────
export const detectar_anomalias: ToolDef = {
  nombre: "detectar_anomalias",
  descripcion:
    "Detecta anomalías MATERIALES (picos/caídas atípicas de turnos o facturación por día, divergencias inusuales entre Stand y Reservas, problemas de reconciliación o cronograma) en un mes, con evidencia y severidad. " +
    "Usa un baseline estadístico robusto (mediana + MAD), no reglas inventadas. Si la lista viene vacía, decí explícitamente que no se detectaron anomalías importantes con los datos disponibles — no inventes una.",
  schema: schemaAnioMes,
  ejecutar: async (input): Promise<ToolResultado> => {
    const { anio, mes } = pedirAnioMes(input);
    const r = await ejecutarDeteccionAnomalias({ anio, mes });
    const payload = { ...r, _regla: "Si 'anomalias' está vacío, no hay anomalías importantes que reportar: decilo así, no inventes una para completar la respuesta." };
    return {
      contenido: JSON.stringify(payload),
      resumen: payload,
      fuente: { modulo: "Detección de anomalías", periodo: r.periodo, registros: r.diasAnalizados, actualizado: ahoraISO() },
    };
  },
};

// ── proyectar_periodo ────────────────────────────────────────────────────────────
export const proyectar_periodo: ToolDef = {
  nombre: "proyectar_periodo",
  descripcion:
    "Proyecta el CIERRE de un mes EN CURSO (facturación y turnos) con tres escenarios (conservador/base/optimista), calculados con percentiles de la distribución histórica real por día de semana — nunca porcentajes arbitrarios. " +
    "Respeta días cerrados según el cronograma real; si el cronograma está en borrador, la proyección se marca como supuesto NO oficial. Nunca presentes un valor proyectado como si fuera un dato confirmado: siempre aclará que es una estimación con su nivel de confianza.",
  schema: schemaAnioMes,
  ejecutar: async (input): Promise<ToolResultado> => {
    const { anio, mes } = pedirAnioMes(input);
    const r = await ejecutarProyeccion({ anio, mes });
    if (!r.ok) return { contenido: JSON.stringify({ error: r.motivo }), resumen: { ok: false, motivo: r.motivo }, fuente: { modulo: "Proyección de cierre", actualizado: ahoraISO() } };
    const payload = { ...r, _regla: "Los valores de 'escenarios' son ESTIMACIONES, no datos confirmados. Siempre indicá el nivel de confianza y distinguí lo real (acumulado) de lo proyectado (futuro)." };
    return {
      contenido: JSON.stringify(payload),
      resumen: payload,
      fuente: { modulo: "Proyección de cierre", periodo: r.periodo, registros: r.facturacion.ok ? r.facturacion.datosHistoricosUtilizados : 0, actualizado: ahoraISO() },
    };
  },
};

export const HERRAMIENTAS_ANALISIS: Record<string, ToolDef> = {
  comparar_periodos, detectar_anomalias, proyectar_periodo,
};
