// IA SIM · Bloque 4E — Herramientas CERRADAS de comparación/anomalías/proyección. Mismo patrón
// que lib/ia/tools.ts: el modelo NUNCA elige SQL, solo invoca estas funciones tipadas. Los
// resultados van en `resumen` de forma ESTRUCTURADA (no solo un resumen de auditoría): así, si
// el administrador pide después un informe, el snapshot completo del análisis se reutiliza
// automáticamente vía server.ts (mismo mecanismo que preparar_informe → snapshot_fuentes, sin
// tabla nueva — ver lib/ia/informes/informesServer.ts).

import type { ToolDef, ToolResultado } from "@/lib/ia/tools";
import { pedirAnioMes, schemaAnioMes } from "@/lib/ia/toolsCompartido";
import { ejecutarComparacion, type ParamsComparar } from "@/lib/ia/analisis/comparacionServer";
import { ejecutarDeteccionAnomalias } from "@/lib/ia/analisis/anomaliasServer";
import { ejecutarProyeccion } from "@/lib/ia/analisis/proyeccionServer";

const ahoraISO = () => new Date().toISOString();
const mesStr = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;

const schemaPeriodo = { type: "object", properties: { anio: { type: "integer" }, mes: { type: "integer" } }, required: ["anio", "mes"], additionalProperties: false };

// ── comparar_periodos ───────────────────────────────────────────────────────────
export const comparar_periodos: ToolDef = {
  nombre: "comparar_periodos",
  descripcion:
    "Compara DOS meses (actividad de equipo o financiero), DOS integrantes dentro del mismo mes, o Turnero Stand vs Reservas web dentro del mismo mes. " +
    "Todos los números (diferencias, variación %) los calcula el servidor: nunca hagas la aritmética vos. Si un mes está en curso, el servidor ya compara por TRAMO EQUIVALENTE (mismos días transcurridos) y te da aparte la referencia del mes completo — no mezcles ambas cosas en una sola variación. " +
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
    const periodoA = pedirAnioMes({ anio: (input.periodo_a as Record<string, unknown>)?.anio, mes: (input.periodo_a as Record<string, unknown>)?.mes });
    const periodoBRaw = input.periodo_b as Record<string, unknown> | undefined;
    const params: ParamsComparar = {
      modo: input.modo === "financiero" ? "financiero" : "equipo",
      periodoA,
      periodoB: periodoBRaw && periodoBRaw.anio != null && periodoBRaw.mes != null ? pedirAnioMes(periodoBRaw) : undefined,
      integranteA: typeof input.integrante_a === "string" ? input.integrante_a : undefined,
      integranteB: typeof input.integrante_b === "string" ? input.integrante_b : undefined,
      compararFuentes: input.comparar_fuentes === true,
      ajustarInflacion: input.ajustar_inflacion === true,
    };
    const r = await ejecutarComparacion(params);
    if (!r.ok) {
      return { contenido: JSON.stringify({ error: r.motivo }), resumen: { ok: false, motivo: r.motivo }, fuente: { modulo: "Comparación de períodos", actualizado: ahoraISO() } };
    }
    const payload = {
      ...r,
      _unidades: { ars: "Pesos argentinos (ARS), enteros.", horas: "Horas (ya convertidas; NUNCA confundir con minutos de actividad de clientes).", minutos: "Minutos de actividad comercial de clientes (turnos × 15), NO horas trabajadas del cronograma." },
      _regla: "variacionPct=null significa 'no calculable' (el valor base es cero): nunca lo reemplaces por 0% ni lo inventes.",
    };
    return {
      contenido: JSON.stringify(payload),
      resumen: payload,
      fuente: { modulo: "Comparación de períodos", periodo: `${mesStr(periodoA.anio, periodoA.mes)}`, registros: r.ladoA.registros + r.ladoB.registros, actualizado: ahoraISO() },
    };
  },
};

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
