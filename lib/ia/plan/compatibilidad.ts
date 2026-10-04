// IA SIM · Bloque 5C — Qué se puede comparar, qué se puede calcular y hasta dónde se puede
// concluir. Puro: sin base y sin reloj.
//
// La IA puede poner lado a lado resultados de dominios distintos, pero no puede inventar una
// relación matemática entre ellos. Acá viven, explícitas y testeables, las tres categorías:
// comparación permitida, relación SOLO descriptiva y relación prohibida.

import { UNIVERSOS_PLAN, type UniversoPlan } from "@/lib/ia/plan/capacidades";

// ── Cálculos permitidos ─────────────────────────────────────────────────────────
export const CALCULOS_PLAN = {
  diferencia: { etiqueta: "Diferencia", descripcion: "Comparado − base, con la misma métrica y el mismo universo." },
  variacion_pct: { etiqueta: "Variación porcentual", descripcion: "Diferencia dividida por el valor absoluto de la base. Base cero: no calculable." },
  delta_por_fuente: { etiqueta: "Delta por fuente", descripcion: "Diferencia de cada fuente entre los dos períodos, ordenada por impacto absoluto." },
} as const;
// La dirección del cambio (si dos métricas se movieron para el mismo lado) NO es un cálculo que
// el modelo pida: la deriva el servidor de las variaciones ya calculadas.
export type CalculoPlan = keyof typeof CALCULOS_PLAN;
export const CALCULOS_PLAN_IDS = Object.keys(CALCULOS_PLAN) as CalculoPlan[];

// ── Comparaciones ───────────────────────────────────────────────────────────────
export type VeredictoRelacion =
  | { tipo: "permitida" }
  | { tipo: "solo_descriptiva"; nota: string }
  | { tipo: "prohibida"; motivo: string };

/**
 * ¿Se puede restar/dividir una métrica de un universo contra otra de otro universo?
 * La respuesta corta es NO: solo se comparan contra SÍ MISMAS en otro período. Entre
 * universos distintos lo único válido es mirar si se movieron en la misma dirección.
 */
export function relacionEntreUniversos(a: UniversoPlan, b: UniversoPlan): VeredictoRelacion {
  if (a === b) return { tipo: "permitida" };
  return {
    tipo: "solo_descriptiva",
    nota: `${UNIVERSOS_PLAN[a].etiqueta} y ${UNIVERSOS_PLAN[b].etiqueta} se imputan con reglas distintas (${UNIVERSOS_PLAN[a].regla} / ${UNIVERSOS_PLAN[b].regla}). Se pueden mirar lado a lado y ver si se movieron para el mismo lado, pero no dividir ni restar una de otra.`,
  };
}

/** Relaciones que están prohibidas aunque alguien las pida con todas las letras. */
export const RELACIONES_PROHIBIDAS: Array<{ id: string; motivo: string }> = [
  {
    id: "ratio_entre_universos",
    motivo:
      "Dividir una métrica de facturación por una de actividad (por ejemplo facturación total sobre operaciones del Turnero y llamarlo ticket promedio) mezcla universos: la facturación incluye campeonatos, mensualidades e ingresos manuales que no pasan por esas operaciones.",
  },
  {
    id: "atribucion_por_cronograma",
    motivo:
      "Atribuirle ventas o turnos a una persona porque figuraba en el cronograma. Estar programado no demuestra haber tomado la operación. Se puede informar sus horas programadas y, por separado, la actividad del local.",
  },
  {
    id: "causa_sin_datos",
    motivo:
      "Atribuir un cambio a una campaña, al clima, a la competencia o a cualquier causa de la que no haya datos en el sistema.",
  },
  {
    id: "union_por_texto",
    motivo: "Unir registros de dos tablas por parecido de nombre o de texto. Sin una relación explícita en los datos, esa unión no existe.",
  },
  {
    id: "fechas_distintas_sin_declarar",
    motivo:
      "Comparar una métrica imputada por fecha de pago contra otra imputada por fecha de servicio sin decirlo. Se puede hacer, pero la respuesta tiene que declarar la diferencia.",
  },
  {
    id: "manual_como_demanda",
    motivo:
      "Usar ingresos manuales, campeonatos, gift cards o mensualidades como medida de la demanda del Turnero. No pasan por el mostrador: para demanda operativa van turnos, personas, minutos y operaciones.",
  },
];

export function motivoProhibicion(id: string): string | null {
  return RELACIONES_PROHIBIDAS.find((r) => r.id === id)?.motivo ?? null;
}

// ── Umbrales de lectura ─────────────────────────────────────────────────────────
// "Se mantuvo estable", "cayó claramente" y "cambio similar" no se dejan al criterio del
// modelo: son estos números, y la respuesta los puede mostrar.
export const UMBRAL_ESTABLE_PCT = 5;   // |variación| < 5%  → se mantuvo estable
export const UMBRAL_CLARO_PCT = 10;    // |variación| >= 10% → cambió claramente
export const RATIO_SIMILAR_MIN = 0.7;  // dos variaciones del mismo signo cuyo cociente
export const RATIO_SIMILAR_MAX = 1.43; // cae en [0,7 ; 1,43] cambiaron en proporción similar

export type Magnitud = "estable" | "leve" | "clara" | "no_calculable";

export function magnitud(variacionPct: number | null): Magnitud {
  if (variacionPct == null || !Number.isFinite(variacionPct)) return "no_calculable";
  const abs = Math.abs(variacionPct);
  if (abs < UMBRAL_ESTABLE_PCT) return "estable";
  if (abs < UMBRAL_CLARO_PCT) return "leve";
  return "clara";
}

/** ¿La etiqueta de una métrica es plural? Decide la concordancia de la frase que se publica. */
export function etiquetaEsPlural(etiqueta: string): boolean {
  const primera = sinAcentos(etiqueta).toLowerCase().split(/[^a-z]+/)[0] ?? "";
  return primera.endsWith("s");
}

export function fraseMagnitud(variacionPct: number | null, plural = false): string {
  const m = magnitud(variacionPct);
  if (m === "no_calculable") return plural ? "no son calculables" : "no es calculable";
  if (m === "estable") return plural ? "se mantuvieron estables" : "se mantuvo estable";
  const baja = (variacionPct as number) < 0;
  const direccion = baja ? (plural ? "bajaron" : "bajó") : plural ? "subieron" : "subió";
  return m === "leve" ? `${direccion} levemente` : `${direccion} claramente`;
}

/** ¿Dos variaciones del mismo signo se movieron en proporción parecida? */
export function cambioSimilar(a: number | null, b: number | null): boolean {
  if (a == null || b == null || a === 0 || b === 0) return false;
  if (Math.sign(a) !== Math.sign(b)) return false;
  const ratio = Math.abs(a) / Math.abs(b);
  return ratio >= RATIO_SIMILAR_MIN && ratio <= RATIO_SIMILAR_MAX;
}

// ── Lectura de demanda / disponibilidad ─────────────────────────────────────────
// La pregunta "¿fue por demanda o por disponibilidad?" se responde con una regla escrita,
// nunca con una corazonada del modelo. Y el resultado SIEMPRE se enuncia como evidencia
// compatible, no como causa probada.
export type LecturaDemanda = {
  veredicto: "compatible_menor_demanda" | "compatible_menor_disponibilidad" | "ambas_contribuyen" | "sin_cambio_relevante" | "inconcluso";
  texto: string;
  /** Los números con los que se llegó a esa lectura, para que se pueda auditar. */
  base: { actividadPct: number | null; disponibilidadPct: number | null; umbralEstable: number; umbralClaro: number };
};

export function leerDemandaDisponibilidad(actividadPct: number | null, disponibilidadPct: number | null): LecturaDemanda {
  const base = { actividadPct, disponibilidadPct, umbralEstable: UMBRAL_ESTABLE_PCT, umbralClaro: UMBRAL_CLARO_PCT };
  const mAct = magnitud(actividadPct);
  const mDisp = magnitud(disponibilidadPct);

  if (mAct === "no_calculable" || mDisp === "no_calculable") {
    return { veredicto: "inconcluso", texto: "No hay suficiente evidencia para separar demanda de disponibilidad: falta una de las dos mediciones.", base };
  }
  if (mAct === "estable" && mDisp === "estable") {
    return { veredicto: "sin_cambio_relevante", texto: "Ni la actividad ni las horas programadas cambiaron de forma relevante entre los dos períodos.", base };
  }
  if (cambioSimilar(actividadPct, disponibilidadPct)) {
    return {
      veredicto: "ambas_contribuyen",
      texto: "La actividad y las horas programadas se movieron en proporción parecida, así que la menor disponibilidad pudo contribuir al cambio. Los datos no alcanzan para separar cuánto aportó cada cosa.",
      base,
    };
  }
  if (mAct !== "estable" && mDisp === "estable") {
    const direccion = (actividadPct as number) < 0 ? "cayó" : "subió";
    return {
      veredicto: "compatible_menor_demanda",
      texto: `La actividad ${direccion} mientras las horas programadas se mantuvieron estables: es compatible con un cambio de utilización o de demanda, aunque los datos por sí solos no prueban la causa.`,
      base,
    };
  }
  if (mAct === "estable" && mDisp !== "estable") {
    return {
      veredicto: "compatible_menor_disponibilidad",
      texto: "Las horas programadas cambiaron mientras la actividad se mantuvo estable: es compatible con un cambio de disponibilidad que no se trasladó a la operación.",
      base,
    };
  }
  if (Math.sign(actividadPct as number) !== Math.sign(disponibilidadPct as number)) {
    return {
      veredicto: "inconcluso",
      texto: "La actividad y las horas programadas se movieron en direcciones opuestas: con estos datos no se puede atribuir el cambio a la demanda ni a la disponibilidad.",
      base,
    };
  }
  // Mismo signo pero proporciones distintas: la que se movió mucho más manda, sin afirmar causa.
  const actMayor = Math.abs(actividadPct as number) > Math.abs(disponibilidadPct as number);
  return {
    veredicto: actMayor ? "compatible_menor_demanda" : "compatible_menor_disponibilidad",
    texto: actMayor
      ? "La actividad se movió bastante más que las horas programadas: es compatible con un cambio de utilización o de demanda más que de disponibilidad, sin que los datos prueben la causa."
      : "Las horas programadas se movieron bastante más que la actividad: es compatible con un cambio de disponibilidad, sin que los datos prueben la causa.",
    base,
  };
}

// ── Utilidad de texto compartida ─────────────────────────────────────────────────
export function sinAcentos(texto: string): string {
  return texto
    .replace(/[áàäâã]/g, "a").replace(/[éèëê]/g, "e").replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o").replace(/[úùüû]/g, "u").replace(/ñ/g, "n")
    .replace(/[ÁÀÄÂÃ]/g, "A").replace(/[ÉÈËÊ]/g, "E").replace(/[ÍÌÏÎ]/g, "I")
    .replace(/[ÓÒÖÔ]/g, "O").replace(/[ÚÙÜÛ]/g, "U").replace(/Ñ/g, "N");
}


// ── Vocabulario causal prohibido en la síntesis ─────────────────────────────────
// Si la síntesis del modelo trae una de estas construcciones afirmando una causa, se rechaza.
export const RE_CAUSAL = /\b(porque|debido a|a causa de|gracias a|producto de|se explica por|fue consecuencia de|provoc[óo]|caus[óo]|generado por)\b/i;
// "es compatible con", "podría", "sugiere" sí están permitidos: son lecturas, no causas.
export const RE_HEDGE = /\b(compatible con|podr[íi]a|sugiere|es consistente con|no prueba|no alcanza para)\b/i;


export function afirmaCausa(texto: string): boolean {
  if (!RE_CAUSAL.test(texto)) return false;
  // Una frase que menciona una causa pero la relativiza en la misma oración no es una afirmación.
  return !RE_HEDGE.test(texto);
}
