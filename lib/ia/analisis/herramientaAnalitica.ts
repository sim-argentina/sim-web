// IA SIM · Bloque 5A — Herramienta CERRADA de consulta analítica interna.
//
// El modelo propone un PLAN con valores de listas cerradas (nunca SQL, nunca nombres de tablas
// ni columnas). El servidor lo valida, lo ejecuta contra los datos internos y RENDERIZA la tabla
// él mismo: la respuesta correcta no depende de que el modelo la redacte bien.

import type { ToolDef, ToolResultado } from "@/lib/ia/tools";
import { validarPlan, METRICAS_VALIDAS, AGRUPACIONES, ORDENES, FUENTES_CONTABLES, FUENTES_ACTIVIDAD, LIMITE_MAX } from "@/lib/ia/analisis/planAnalitico";
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

export const consulta_analitica_interna: ToolDef = {
  nombre: NOMBRE_CONSULTA_ANALITICA,
  descripcion:
    "Consulta FLEXIBLE de datos internos de SIM: una métrica, un período, filtros y una agrupación. " +
    "Usala para preguntas del tipo 'la facturación de agosto de lunes a viernes por semana', 'turnos por semana', 'facturación por método de pago', 'personas por día de la semana'. " +
    "El servidor calcula los números y ARMA LA TABLA FINAL: vos no la rehagas ni recalcules totales; narrá el contexto y lo que se observa. " +
    "Todo sale de datos internos: nunca requiere internet. Para comparar DOS períodos entre sí usá comparar_periodos; para el neto/ganancia mensual usá consultar_finanzas.",
  schema: {
    type: "object",
    properties: {
      metrica: { type: "string", enum: [...METRICAS_VALIDAS], description: "facturacion_bruta usa la composición contable de Finanzas (Turnero por fecha de servicio; Reservas, Gift cards y Campeonatos por fecha de pago)." },
      periodo: schemaPeriodo,
      filtros: {
        type: "object",
        properties: {
          dias_semana: { type: "array", items: { type: "integer" }, description: "Días ISO a incluir: 1=lunes … 7=domingo. Para 'lunes a viernes' usá [1,2,3,4,5]." },
          fuente: { type: "array", items: { type: "string" }, description: `Para facturación: ${FUENTES_CONTABLES.join(", ")}. Para actividad: ${FUENTES_ACTIVIDAD.join(", ")}.` },
          metodo_pago: { type: "array", items: { type: "string" }, description: "Solo para facturación (ej. efectivo, mercadopago, posnet)." },
        },
        additionalProperties: false,
      },
      agrupar_por: { type: "string", enum: [...AGRUPACIONES], description: "'semana' agrupa por semana calendario (lunes a domingo), recortada al período pedido." },
      orden: { type: "string", enum: [...ORDENES] },
      limite: { type: "integer", description: `Máximo de filas (tope ${LIMITE_MAX}).` },
    },
    required: ["metrica", "periodo"],
    additionalProperties: false,
  },
  ejecutar: async (input): Promise<ToolResultado> => {
    const validacion = validarPlan(input);
    if (!validacion.ok) {
      // Error ESTRUCTURADO y reparable: el modelo puede corregir el plan y reintentar. Nunca se
      // ejecuta un plan a medias ni se cae a una búsqueda web para tapar el problema.
      return {
        contenido: JSON.stringify({ error: validacion.error, campo: validacion.campo ?? null, reparable: true }),
        resumen: { ok: false, motivo: validacion.error, campo: validacion.campo ?? null },
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
        "La tabla ya está armada y publicada por el servidor (campo 'tabla_markdown'): NO la repitas, NO rehagas los números y NO recalcules el total. " +
        "Podés agregar una observación breve apoyada en estas mismas cifras. Todos los datos son internos: no cites ni busques fuentes externas.",
    };
    // Al modelo le va la tabla y las filas SIN el detalle de fechas: ya está en la tabla y
    // duplicarlo solo agranda el contexto facturable. El resumen completo queda para el
    // servidor (render, informes y auditoría).
    const paraModelo = { ...payload, filas: r.filas.map((f) => ({ clave: f.clave, etiqueta: f.etiqueta, detalle: f.detalle, dias: f.dias, valor: f.valor })) };
    return {
      contenido: JSON.stringify(paraModelo),
      resumen: payload,
      fuente: {
        modulo: "Consulta analítica interna",
        periodo: `${r.ventana.desde}..${r.ventana.hasta}`,
        registros: r.totalDias,
        actualizado: new Date().toISOString(),
      },
    };
  },
};

// Bloque 5A — el servidor publica la tabla determinística aunque el modelo no la narre.
export function construirTablaAnalitica(resumen: Record<string, unknown> | null | undefined): string | null {
  if (!resumen || resumen.ok !== true) return null;
  const tabla = resumen.tabla_markdown;
  return typeof tabla === "string" && tabla.trim() ? tabla : null;
}
