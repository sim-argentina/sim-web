// IA SIM · Bloque 5C — Clasificación de COMPLEJIDAD de una consulta interna. Puro.
//
// Decide qué nivel de modelo hace falta, de forma explicable y testeable. La regla que manda:
// no se escala si una herramienta determinística puede responder sola. Una métrica con filtros y
// agrupaciones es trabajo de 5B y sigue con el modelo económico; recién cuando hay que cruzar
// dominios, varios pasos y una síntesis comparativa se justifica el modelo más capaz.
//
// Los nombres de los modelos NO viven acá: salen de la configuración central (getModelos).

import type { ModeloClase } from "@/lib/ia/config";

export const COMPLEJIDADES = ["simple", "analitica", "multiherramienta"] as const;
export type Complejidad = (typeof COMPLEJIDADES)[number];

export type DecisionComplejidad = {
  complejidad: Complejidad;
  clase: ModeloClase;
  /** Códigos cortos auditables, no razonamiento. */
  senales: string[];
  motivo: string;
};

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Dominios que la pregunta toca. Cruzar dos o más es lo que vuelve el pedido multiherramienta.
const DOMINIOS: Array<{ id: string; re: RegExp }> = [
  { id: "facturacion", re: /\bfactur|\bingres|\bvent(a|as)\b|\bvendi/ },
  { id: "actividad", re: /\bturno|\bpersona|\bminuto|\boperacion|\bactividad\b/ },
  { id: "disponibilidad", re: /\bhoras? programad|\bcronograma|\bdisponibilidad|\bjornada/ },
  { id: "financiero", re: /\bganancia|\bneto|\bcomision|\brentab|\bcierre\b/ },
  { id: "diagnostico", re: /\banomal|\bproyec|\bat[ií]pic|\binusual/ },
];

// Señales de que hay que encadenar pasos, no solo leer un número.
const SENALES_MULTI: Array<{ id: string; re: RegExp }> = [
  { id: "explicar_variacion", re: /\bqu[eé] (fuentes?|explica|explican)\b|\bexplic(a|an|ar) (la|el) (variaci|diferenc|caida|baja|subida)|\bde d[oó]nde (vino|sali[oó])\b/ },
  { id: "demanda_disponibilidad", re: /\bdemanda\b|\bdisponibilidad\b|\bocupaci[oó]n\b/ },
  { id: "dos_periodos", re: /\b(agosto|septiembre|setiembre|octubre|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio)\b[\s\S]*\b(agosto|septiembre|setiembre|octubre|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio)\b|\beste mes\b[\s\S]*\b(mes pasado|anterior)\b|\bmes pasado\b[\s\S]*\beste mes\b/ },
  { id: "profundizar", re: /\bprofundiz|\bdespu[eé]s desglos|\by despu[eé]s\b|\bprimero.*despu[eé]s\b|\bluego desglos/ },
  { id: "porque_interno", re: /\bpor qu[eé]\b|\bqu[eé] cambi[oó]\b|\bqu[eé] pas[oó] con\b/ },
  { id: "relacion", re: /\btambi[eé]n tuvieron\b|\bcoincidi[oó]\b|\bse relaciona\b|\btiene que ver con\b/ },
];

// Señales de que alcanza una sola consulta analítica (5B): no se escala por esto.
const SENALES_ANALITICA: Array<{ id: string; re: RegExp }> = [
  { id: "agrupacion", re: /\bpor (d[ií]a|semana|mes|fuente|m[eé]todo|modalidad|duraci[oó]n)\b|\bsemanalmente\b/ },
  { id: "ranking", re: /\bmejor(es)?\b|\bpeor(es)?\b|\btop\s*\d|\bcinco mejores\b/ },
  { id: "segmento", re: /\bfin(es)? de semana\b|\bh[aá]biles\b|\bentre semana\b|\bseparame\b|\bdesglos/ },
  { id: "promedio", re: /\bpromedio\b|\bporcentaje\b|\bparticipaci[oó]n\b/ },
];

export function clasificarComplejidad(pregunta: string): DecisionComplejidad {
  const t = norm(pregunta);
  const dominios = DOMINIOS.filter((d) => d.re.test(t)).map((d) => d.id);
  const multi = SENALES_MULTI.filter((s) => s.re.test(t)).map((s) => s.id);
  const analitica = SENALES_ANALITICA.filter((s) => s.re.test(t)).map((s) => s.id);

  const senales = [
    ...dominios.map((d) => `dom:${d}`),
    ...multi.map((m) => `multi:${m}`),
    ...analitica.map((a) => `analitica:${a}`),
  ];

  // Multiherramienta: cruza dos dominios Y hay que encadenar pasos; o pide explícitamente
  // explicar una variación o separar demanda de disponibilidad.
  const cruzaDominios = dominios.length >= 2;
  const pideCadena = multi.length > 0;
  // Explicar un cambio o separar demanda de disponibilidad SIEMPRE es multiherramienta: hay que
  // traer los dos períodos y descomponer. También lo es un "¿por qué?" o un "profundizá" sobre
  // dos períodos, aunque la pregunta no nombre dos dominios: la descomposición los trae igual.
  const pideExplicacion =
    multi.includes("explicar_variacion") ||
    multi.includes("demanda_disponibilidad") ||
    (multi.includes("dos_periodos") && (multi.includes("porque_interno") || multi.includes("profundizar") || multi.includes("relacion")));

  if ((cruzaDominios && pideCadena) || pideExplicacion) {
    return {
      complejidad: "multiherramienta",
      clase: "potente",
      senales,
      motivo: pideExplicacion
        ? "Hay que descomponer una variación o separar demanda de disponibilidad: son varios pasos y una síntesis comparativa."
        : `Cruza ${dominios.length} dominios internos y necesita encadenar pasos.`,
    };
  }

  if (analitica.length > 0 || dominios.length >= 1) {
    return {
      complejidad: "analitica",
      clase: "economico",
      senales,
      motivo: "Una sola consulta analítica con filtros o agrupaciones: la resuelve la herramienta determinística sin escalar de modelo.",
    };
  }

  return { complejidad: "simple", clase: "economico", senales, motivo: "Consulta directa de pocos datos." };
}

/**
 * Clase de modelo efectiva. Si la clase pedida no está configurada se cae a la que sí lo está:
 * un plan complejo con el modelo económico es peor que nada, pero mucho mejor que no responder.
 */
export function claseEfectiva(pedida: ModeloClase, modelos: Record<ModeloClase, string>): { clase: ModeloClase; degradado: boolean } {
  const disponible = (c: ModeloClase) => Boolean(modelos[c] && modelos[c].trim());
  if (disponible(pedida)) return { clase: pedida, degradado: false };
  const alternativa: ModeloClase = pedida === "potente" ? "economico" : "potente";
  if (disponible(alternativa)) return { clase: alternativa, degradado: true };
  return { clase: pedida, degradado: false }; // no hay nada configurado: que falle donde corresponde
}
