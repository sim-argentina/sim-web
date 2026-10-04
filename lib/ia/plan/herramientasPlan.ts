// IA SIM · Bloque 5C — Las dos herramientas del planificador.
//
//  1) analizar_multiherramienta: el modelo manda un PLAN cerrado; el servidor lo valida, ejecuta
//     los pasos, calcula las comparaciones y arma la respuesta determinística.
//  2) emitir_sintesis_analitica: TERMINAL y opcional. El modelo propone una conclusión citando
//     evidencias; el servidor verifica cada número contra lo que calculó y, si algo no cierra,
//     publica igual la respuesta determinística.

import type { ToolDef, ToolResultado } from "@/lib/ia/tools";
import { CAPACIDADES, CAPACIDADES_IDS, accesoDesdeRegistro } from "@/lib/ia/plan/capacidades";
import { validarPlanMulti, MAX_PASOS, MAX_PROFUNDIDAD, PRESENTACIONES } from "@/lib/ia/plan/planMulti";
import { CALCULOS_PLAN, CALCULOS_PLAN_IDS } from "@/lib/ia/plan/compatibilidad";
import { ejecutarPlanMulti, type ResultadoPlan } from "@/lib/ia/plan/ejecutorPlan";
import { renderResultadoPlan, evidenciasParaModelo } from "@/lib/ia/plan/renderPlan";
import { validarSintesis, MAX_AFIRMACIONES } from "@/lib/ia/plan/sintesis";
import { DIRECCIONES } from "@/lib/ia/plan/direccion";

export const NOMBRE_ANALISIS_MULTI = "analizar_multiherramienta";
export const NOMBRE_SINTESIS = "emitir_sintesis_analitica";

const descripcionCapacidades = CAPACIDADES_IDS
  .map((id) => `${id} (${CAPACIDADES[id].dominio}, universo ${CAPACIDADES[id].universo}, métricas: ${CAPACIDADES[id].metricas.join("/") || "sin cifras"})`)
  .join("; ");

export const analizar_multiherramienta: ToolDef = {
  nombre: NOMBRE_ANALISIS_MULTI,
  descripcion:
    "Resuelve una pregunta interna que necesita VARIOS pasos y más de una herramienta: comparar dos períodos, cruzar facturación con actividad y horas programadas, desglosar una variación por fuente, o encontrar el período más flojo y profundizarlo. " +
    "Mandá un PLAN con pasos, cada uno con su herramienta y sus argumentos, y los cálculos que querés que el servidor haga sobre los resultados. " +
    `Capacidades disponibles: ${descripcionCapacidades}. ` +
    "El servidor valida el plan, ejecuta los pasos (en paralelo cuando se puede), calcula las diferencias y variaciones, desglosa por fuente y ARMA LA RESPUESTA FINAL. " +
    "Vos no rehagas los números ni armes tablas: si querés aportar una conclusión, usá después emitir_sintesis_analitica citando las evidencias que devuelve esta herramienta. " +
    "Para una sola métrica con filtros y agrupaciones alcanza consulta_analitica_interna: no armes un plan para eso. Todo es interno: nunca requiere internet.",
  schema: {
    type: "object",
    properties: {
      objetivo: { type: "string", description: "Qué se quiere averiguar, en una línea. Va como título de la respuesta." },
      pasos: {
        type: "array",
        description: `Entre 1 y ${MAX_PASOS} pasos. Las dependencias solo pueden apuntar a pasos ANTERIORES (máximo ${MAX_PROFUNDIDAD} niveles).`,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: 'Identificador del paso: "p1", "p2", …' },
            herramienta: { type: "string", enum: [...CAPACIDADES_IDS] },
            argumentos: { type: "object", description: "Los argumentos de ESA herramienta, tal como ella los declara.", additionalProperties: true },
            dependeDe: { type: "array", items: { type: "string" }, description: "Ids de pasos anteriores que tienen que ejecutarse primero." },
          },
          required: ["id", "herramienta", "argumentos"],
          additionalProperties: false,
        },
      },
      calculos: {
        type: "array",
        description: `Cálculos que hace el SERVIDOR sobre los resultados: ${CALCULOS_PLAN_IDS.map((c) => `${c} (${CALCULOS_PLAN[c].descripcion})`).join("; ")}. Siempre sobre la MISMA métrica en dos pasos distintos.`,
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: [...CALCULOS_PLAN_IDS] },
            base: {
              type: "object",
              description: 'Referencia tipada al período más antiguo: {"paso":"p1","metrica":"facturacion_bruta"}.',
              properties: { paso: { type: "string" }, metrica: { type: "string" } },
              required: ["paso", "metrica"],
              additionalProperties: false,
            },
            comparado: {
              type: "object",
              description: "Referencia tipada al período más reciente.",
              properties: { paso: { type: "string" }, metrica: { type: "string" } },
              required: ["paso", "metrica"],
              additionalProperties: false,
            },
          },
          required: ["tipo", "base", "comparado"],
          additionalProperties: false,
        },
      },
      presentacion: {
        type: "object",
        properties: { tipo: { type: "string", enum: [...PRESENTACIONES] } },
        additionalProperties: false,
      },
    },
    required: ["objetivo", "pasos"],
    additionalProperties: false,
  },
  ejecutar: async (input): Promise<ToolResultado> => {
    // Import diferido del registro: tools.ts importa este módulo (ver capacidades.ts).
    const { HERRAMIENTAS } = await import("@/lib/ia/tools");
    const validacion = validarPlanMulti(input, accesoDesdeRegistro(HERRAMIENTAS));
    if (!validacion.ok) {
      return {
        contenido: JSON.stringify({
          error: validacion.error,
          campo: validacion.campo ?? null,
          reparable: validacion.aclaracion !== true,
          pedir_aclaracion: validacion.aclaracion === true,
          _regla:
            validacion.aclaracion === true
              ? "Falta una decisión del administrador: preguntale UNA sola cosa concreta."
              : "Corregí el plan con las capacidades y los argumentos permitidos y volvé a llamar la herramienta UNA vez. Si no hay forma de armarlo, explicá qué parte sí se puede responder.",
        }),
        resumen: { ok: false, motivo: validacion.error, campo: validacion.campo ?? null, aclaracion: validacion.aclaracion === true },
        fuente: { modulo: "Análisis multiherramienta", actualizado: new Date().toISOString() },
      };
    }

    const r = await ejecutarPlanMulti(validacion.plan);
    const respuesta = renderResultadoPlan(r);
    const payload = {
      ...r,
      respuesta_markdown: respuesta,
      evidencias_citables: evidenciasParaModelo(r.evidencias),
      _regla:
        "La respuesta ya está armada y publicada por el servidor (campo 'respuesta_markdown'): NO la repitas, NO rehagas los números, NO armes otra tabla y NO cambies signos ni formatos. " +
        `Si querés agregar una conclusión, llamá a ${NOMBRE_SINTESIS}: cada afirmación declara su 'metrica' y su 'direccion' (${DIRECCIONES.join("/")}) y cita los evidenciaId de 'evidencias_citables'. Nunca afirmes una causa que los datos no demuestren. Todo es interno: no cites fuentes externas.`,
    };
    // Al modelo le van las evidencias y las comparaciones, no los pasos internos del plan.
    const paraModelo = {
      objetivo: r.objetivo,
      respuesta_markdown: respuesta,
      evidencias_citables: payload.evidencias_citables,
      comparaciones: r.comparaciones.map((c) => ({ metrica: c.metrica, etiqueta: c.etiqueta, diferencia: c.diferencia, variacionPct: c.variacionPct, unidad: c.unidad })),
      lectura: r.lectura?.texto ?? null,
      faltantes: r.faltantes.map((f) => f.motivo),
      _regla: payload._regla,
    };
    return {
      contenido: JSON.stringify(paraModelo),
      resumen: payload,
      fuente: {
        modulo: "Análisis multiherramienta",
        periodo: r.comparaciones[0] ? `${r.comparaciones[0].base.periodo}..${r.comparaciones[0].comparado.periodo}` : undefined,
        registros: r.evidencias.length,
        actualizado: new Date().toISOString(),
      },
    };
  },
};

export const emitir_sintesis_analitica: ToolDef = {
  nombre: NOMBRE_SINTESIS,
  // Terminal: después de la síntesis no hay más vueltas de herramientas.
  terminal: true,
  descripcion:
    "Cierra un análisis multiherramienta con una conclusión propia. Cada afirmación tiene que DECLARAR de qué métrica habla y en qué dirección se movió, además de citar los evidenciaId que devolvió analizar_multiherramienta. " +
    "El servidor compara esa dirección declarada contra el signo que calculó, y verifica número por número que lo que escribís salga de esa evidencia: si inventás una cifra, declarás una dirección que no es, escribís un verbo que contradice los datos o afirmás una causa, se descarta tu síntesis y se publica igual la respuesta calculada. " +
    "No repitas la tabla ni los totales: ya están publicados. Escribí la lectura, no los datos.",
  schema: {
    type: "object",
    properties: {
      conclusion: { type: "string", description: "Una o dos oraciones con la lectura principal. Sin afirmar causas." },
      afirmaciones: {
        type: "array",
        description: `Hasta ${MAX_AFIRMACIONES} observaciones, cada una citando sus evidencias.`,
        items: {
          type: "object",
          properties: {
            texto: { type: "string" },
            metrica: {
              type: "string",
              description:
                "De qué habla la afirmación: el nombre de la métrica tal como aparece en 'comparaciones', o \"fuente:<id>\" para una fuente del desglose. Obligatorio salvo que la dirección sea sin_direccion.",
            },
            direccion: {
              type: "string",
              enum: [...DIRECCIONES],
              description:
                "Cómo se movió esa métrica según vos: subio, bajo, estable, o sin_direccion si la afirmación no habla de un cambio. El servidor lo compara con el signo que calculó.",
            },
            evidencias: { type: "array", items: { type: "string" }, description: "evidenciaId de 'evidencias_citables'." },
          },
          required: ["texto", "direccion", "evidencias"],
          additionalProperties: false,
        },
      },
    },
    required: ["conclusion"],
    additionalProperties: false,
  },
  ejecutar: async (input): Promise<ToolResultado> => {
    // La síntesis necesita la evidencia del paso anterior; el servidor la inyecta al ensamblar.
    // Acá solo se guarda la propuesta para que el ensamblador la valide contra el resultado real.
    return {
      contenido: JSON.stringify({ recibido: true, _regla: "El servidor va a validar esta síntesis contra la evidencia y publicar la respuesta final. No escribas nada más." }),
      resumen: { es_sintesis: true, propuesta: { conclusion: input.conclusion, afirmaciones: input.afirmaciones ?? [] } },
      fuente: { modulo: "Síntesis analítica", actualizado: new Date().toISOString() },
    };
  },
};

/**
 * Respuesta canónica de un análisis multiherramienta: el render determinístico, más la síntesis
 * del modelo SOLO si validó contra la evidencia. Decide por estado, nunca buscando texto
 * (misma regla que 5B.1).
 */
export function respuestaCanonicaMulti(
  resumenAnalisis: Record<string, unknown> | null | undefined,
  resumenSintesis: Record<string, unknown> | null | undefined,
): { texto: string; sintesisAceptada: boolean; motivoRechazo: string | null } | null {
  if (!resumenAnalisis || resumenAnalisis.ok !== true) return null;
  const r = resumenAnalisis as unknown as ResultadoPlan;
  const propuesta = resumenSintesis && resumenSintesis.es_sintesis === true ? (resumenSintesis.propuesta as Record<string, unknown>) : null;
  if (!propuesta) {
    return { texto: renderResultadoPlan(r), sintesisAceptada: false, motivoRechazo: null };
  }
  const v = validarSintesis(propuesta, r.evidencias, r.comparaciones);
  if (!v.ok) {
    return { texto: renderResultadoPlan(r), sintesisAceptada: false, motivoRechazo: v.motivo };
  }
  return { texto: renderResultadoPlan(r, v.texto), sintesisAceptada: true, motivoRechazo: null };
}

