// IA SIM · Bloque 5B — Herramienta CERRADA de consulta analítica interna.
//
// El modelo traduce la pregunta a un PLAN con identificadores de listas cerradas (nunca SQL,
// nunca nombres de tablas ni columnas, nunca una fórmula propia). El servidor lo valida contra
// el catálogo semántico, lo ejecuta contra los datos internos y RENDERIZA la respuesta él mismo:
// la respuesta correcta no depende de que el modelo la redacte bien.

import type { ToolDef, ToolResultado } from "@/lib/ia/tools";
import { validarPlan } from "@/lib/ia/analisis/planAnalitico";
import {
  METRICAS_SEMANTICAS, METRICAS_IDS, DIMENSIONES, DIMENSIONES_VALIDAS, MAX_DIMENSIONES,
  CALCULOS, CALCULOS_VALIDOS, ORDENES, SENTIDOS_RANKING, TIPOS_SEGMENTACION,
  CLASES_FACTURACION, LIMITE_MAX, MAX_METRICAS,
} from "@/lib/ia/analisis/catalogoSemantico";
import { ejecutarPlanAnalitico } from "@/lib/ia/analisis/ejecutorAnalitico";
import { renderResultadoAnalitico } from "@/lib/ia/analisis/renderAnalitico";

export const NOMBRE_CONSULTA_ANALITICA = "consulta_analitica_interna";

const schemaPeriodo = {
  type: "object",
  description: 'Elegí UNA forma: {"mes":"YYYY-MM"} · {"desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD"} · {"relativo":"este_mes"}.',
  properties: {
    mes: { type: "string", description: 'Mes completo, "YYYY-MM".' },
    desde: { type: "string", description: 'Inicio del rango, "YYYY-MM-DD".' },
    hasta: { type: "string", description: 'Fin del rango (inclusive), "YYYY-MM-DD".' },
    relativo: { type: "string", enum: ["hoy", "ayer", "esta_semana", "semana_pasada", "este_mes", "mes_pasado", "mismo_mes_anio_pasado", "este_anio", "anio_pasado"] },
  },
  additionalProperties: false,
};

// El catálogo se le describe al modelo desde las MISMAS declaraciones que valida el servidor:
// si mañana se agrega una métrica, la descripción la toma sola.
const descripcionMetricas = METRICAS_IDS.map((id) => `${id} (${METRICAS_SEMANTICAS[id].etiqueta}, ${METRICAS_SEMANTICAS[id].unidad})`).join("; ");
const descripcionDimensiones = DIMENSIONES_VALIDAS.map((d) => `${d} (${DIMENSIONES[d].etiqueta})`).join("; ");
const descripcionCalculos = CALCULOS_VALIDOS.map((c) => `${c} (${CALCULOS[c].etiqueta})`).join("; ");

export const consulta_analitica_interna: ToolDef = {
  nombre: NOMBRE_CONSULTA_ANALITICA,
  descripcion:
    "Consulta FLEXIBLE de datos internos de SIM. Combiná métricas, período, filtros, hasta dos agrupaciones, cálculos, ranking y una segmentación en dos grupos. " +
    "Sirve para preguntas como 'qué días de agosto facturamos más', 'separame semana y fin de semana', 'facturación por fuente y por semana', 'el método de pago más usado', " +
    "'qué porcentaje vino de cada fuente', 'los cinco mejores días', 'compará lunes contra viernes', 'turnos, personas y minutos por día', 'promedio diario de este mes', " +
    "'desglosame automático y manual'. " +
    "El servidor calcula los números y ARMA LA RESPUESTA FINAL: vos no la rehagas, no recalcules totales ni cambies formatos; agregá a lo sumo una observación apoyada en esas mismas cifras. " +
    "Todo sale de datos internos: nunca requiere internet. Para comparar DOS PERÍODOS entre sí usá comparar_periodos; para el neto, la ganancia o el cierre mensual usá consultar_finanzas; " +
    "para horas de cronograma por empleado usá consultar_metricas_equipo. " +
    "Si el pedido es imposible o ambiguo, el servidor devuelve qué falta: preguntale UNA sola cosa concreta al administrador en vez de aproximar.",
  schema: {
    type: "object",
    properties: {
      metricas: {
        type: "array",
        items: { type: "string", enum: [...METRICAS_IDS] },
        description:
          `Entre 1 y ${MAX_METRICAS} métricas, todas del mismo universo (no se pueden mezclar facturación con actividad). Disponibles: ${descripcionMetricas}. ` +
          "facturacion_bruta es la facturación TOTAL OPERATIVA BRUTA de Finanzas (automáticos + manuales, cada fuente por su fecha contable); no incluye transferencias, préstamos, ajustes de saldo ni el Colectivo.",
      },
      periodo: schemaPeriodo,
      filtros: {
        type: "object",
        properties: {
          dias_semana: { type: "array", items: { type: "string" }, description: 'Días ISO como texto ("1".."7", 1=lunes) o los atajos "habiles" y "fin_de_semana".' },
          fuente: { type: "array", items: { type: "string" }, description: "Facturación: turnero, reservas_online, gift_cards, campeonatos, mensualidades, manuales. Actividad: stand, reservas." },
          clase: { type: "array", items: { type: "string", enum: [...CLASES_FACTURACION] }, description: "Solo facturación: automático o manual." },
          metodo_pago: { type: "array", items: { type: "string" }, description: "Solo facturación (ej. efectivo, mercadopago, posnet)." },
          modalidad: { type: "array", items: { type: "string", enum: ["legacy", "v2_10"] }, description: "Solo actividad: modalidad comercial persistida de la operación." },
          duracion: { type: "array", items: { type: "integer" }, description: "Solo actividad: duraciones vendidas en minutos (10, 20, 30, 15…). No se asume 15 ni 30." },
          simuladores: { type: "array", items: { type: "integer" }, description: "Solo actividad: cantidad de simuladores de la operación. Los simuladores son equivalentes: no se los distingue por identidad." },
        },
        additionalProperties: false,
      },
      dimensiones: {
        type: "array",
        items: { type: "string", enum: [...DIMENSIONES_VALIDAS] },
        description: `Hasta ${MAX_DIMENSIONES} agrupaciones compatibles: ${descripcionDimensiones}. 'semana' es lunes a domingo, recortada al período (las semanas parciales se conservan). No se pueden combinar dos agrupaciones temporales.`,
      },
      calculos: {
        type: "array",
        items: { type: "string", enum: [...CALCULOS_VALIDOS] },
        description: `Cálculos determinísticos del servidor: ${descripcionCalculos}. 'promedio_dia_calendario' divide por TODOS los días del período, incluidos los que no tuvieron movimientos. 'diferencia' y 'variacion_pct' requieren segmentación.`,
      },
      segmentacion: {
        type: "object",
        description: 'Parte el MISMO período en dos grupos y los compara. Ej.: {"tipo":"dias_semana","grupo_a":["habiles"],"grupo_b":["fin_de_semana"]} o {"tipo":"clase","grupo_a":["automatico"],"grupo_b":["manual"]}.',
        properties: {
          tipo: { type: "string", enum: [...TIPOS_SEGMENTACION] },
          grupo_a: { type: "array", items: { type: "string" }, description: "Primer grupo (es la BASE de la diferencia y la variación)." },
          grupo_b: { type: "array", items: { type: "string" }, description: "Segundo grupo (el comparado)." },
        },
        additionalProperties: false,
      },
      ranking: {
        type: "object",
        description: 'Para "los cinco mejores días" o "el peor". Necesita al menos una agrupación.',
        properties: {
          sentido: { type: "string", enum: [...SENTIDOS_RANKING] },
          n: { type: "integer", description: "Cuántos (por defecto 5)." },
        },
        additionalProperties: false,
      },
      orden: { type: "string", enum: [...ORDENES] },
      limite: { type: "integer", description: `Máximo de filas (tope ${LIMITE_MAX}).` },
    },
    required: ["metricas", "periodo"],
    additionalProperties: false,
  },
  ejecutar: async (input): Promise<ToolResultado> => {
    const validacion = validarPlan(input);
    if (!validacion.ok) {
      // Rechazo ESTRUCTURADO. `aclaracion` distingue "corregí el plan y reintentá" de
      // "preguntale al administrador": nunca se ejecuta un plan a medias ni se cae a una
      // búsqueda web para tapar el problema.
      const esAclaracion = validacion.aclaracion === true;
      return {
        contenido: JSON.stringify({
          error: validacion.error,
          campo: validacion.campo ?? null,
          reparable: !esAclaracion,
          pedir_aclaracion: esAclaracion,
          _regla: esAclaracion
            ? "Falta una decisión del administrador: preguntale EXACTAMENTE esto, en una sola pregunta corta, y no ejecutes nada parecido mientras no responda."
            : "Corregí el plan con los valores permitidos y volvé a llamar la herramienta. Si no hay forma de armarlo, explicá qué parte sí se puede responder.",
        }),
        resumen: { ok: false, motivo: validacion.error, campo: validacion.campo ?? null, aclaracion: esAclaracion },
        fuente: { modulo: "Consulta analítica interna", actualizado: new Date().toISOString() },
      };
    }

    const r = await ejecutarPlanAnalitico(validacion.plan);
    if (!r.ok) {
      return {
        contenido: JSON.stringify({ error: r.motivo, reparable: false }),
        resumen: { ok: false, motivo: r.motivo },
        fuente: { modulo: "Consulta analítica interna", actualizado: new Date().toISOString() },
      };
    }

    const tabla = renderResultadoAnalitico(r);
    const payload = {
      ...r,
      tabla_markdown: tabla,
      _regla:
        "La respuesta ya está armada y publicada por el servidor (campo 'tabla_markdown'): NO la repitas, NO rehagas los números, NO cambies signos ni formatos y NO recalcules totales. " +
        "Podés agregar una observación breve apoyada en estas mismas cifras, sin afirmar causas que los datos no demuestren. Todos los datos son internos: no cites ni busques fuentes externas.",
    };
    // Al modelo le va la respuesta y las filas SIN el detalle de fechas: ya está en la tabla y
    // duplicarlo solo agranda el contexto facturable. El resumen completo queda para el servidor
    // (render, informes y auditoría).
    const paraModelo = {
      ...payload,
      filas: r.filas.map((f) => ({ etiquetas: f.etiquetas, detalle: f.detalle, dias: f.dias, valores: f.valores, participacion: f.participacion })),
    };
    return {
      contenido: JSON.stringify(paraModelo),
      resumen: payload,
      fuente: {
        modulo: "Consulta analítica interna",
        periodo: `${r.ventana.desde}..${r.ventana.hasta}`,
        registros: r.resumen.diasConDatos,
        actualizado: new Date().toISOString(),
      },
    };
  },
};

// Bloque 5A/5B — el servidor publica la respuesta determinística aunque el modelo no la narre.
export function construirTablaAnalitica(resumen: Record<string, unknown> | null | undefined): string | null {
  if (!resumen || resumen.ok !== true) return null;
  const tabla = resumen.tabla_markdown;
  return typeof tabla === "string" && tabla.trim() ? tabla : null;
}
