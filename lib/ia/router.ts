import type { ModeloClase } from "@/lib/ia/config";
import { decidirWeb } from "@/lib/ia/web/decision";

// IA SIM · Bloque 4A — Router DETERMINÍSTICO de modelo. Una consulta simple NO debe
// usar el modelo caro. Elección explicable y testeable (sin llamar al proveedor).

export type DecisionRouter = { clase: ModeloClase; motivo: string };

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Señales de razonamiento complejo → modelo POTENTE.
const SENALES_POTENTES: Array<{ id: string; re: RegExp; motivo: string }> = [
  { id: "foda", re: /\bfoda\b/, motivo: "análisis FODA" },
  { id: "comparacion", re: /\bcompar|\bversus\b|\bvs\b|\bcontra\b|\bfrente a\b|\bdiferencias?\b/, motivo: "comparación" },
  // 4D.1 — análisis competitivo / mercado externo → potente desde el inicio (no económico
  // con escalado tardío). Un dato externo PUNTUAL sigue siendo económico (sin estas señales).
  { id: "competitivo", re: /\bcompetidor|\bcompetencia\b|\bcompetidores\b|\bcompetitiv|\bde mercado\b|\bbenchmark\b/, motivo: "análisis competitivo" },
  { id: "diagnostico", re: /\bdiagnostic|\bconclus|\banaliz|\banalisis\b|\bevalua/, motivo: "diagnóstico/análisis" },
  { id: "proyeccion", re: /\bproyec|\bestima|\bpronostic|\btendencia|\bescenario/, motivo: "proyección" },
  { id: "causal", re: /\bpor que\b|\bpor qué\b|\bporque baj|\bmotivo|\bcausa|\bexplica por/, motivo: "explicación causal" },
  { id: "financiero", re: /\brentab|\bganancia|\bfinancier|\brendimiento del negocio|\bsalud del negocio/, motivo: "análisis financiero" },
  { id: "recomendacion", re: /\bconvien|\brecomend|\bque haria|\bque harias|\bsugerenc|\bdeberia/, motivo: "recomendación" },
  // 4E — anomalías: siempre potente (evaluación de evidencia/severidad, no aritmética simple).
  { id: "anomalia", re: /\banomal[ií]a|\bat[ií]pic|\binusual/, motivo: "detección de anomalías" },
];

// Señales de "cruce de varias fuentes" → potente aunque no haya palabra clave directa.
function mencionaVariasFuentes(t: string): boolean {
  const fuentes = ["finanz", "cronograma", "equipo", "stand", "reserva", "colectivo", "empleado"];
  return fuentes.filter((f) => t.includes(f)).length >= 2;
}

export function elegirModelo(pregunta: string): DecisionRouter {
  const t = norm(pregunta);

  // Comparación implícita: dos nombres de integrantes en la misma pregunta (se calcula antes:
  // una "comparación numérica simple" NO puede ser esto — comparar dos personas sí es potente).
  const nombres = ["ramiro", "rami", "francisco", "fran", "federico", "fede"].filter((n) => new RegExp(`\\b${n}\\b`).test(t));
  const distintosIntegrantes = new Set(nombres.map((n) => (n.startsWith("ram") ? "r" : n.startsWith("fra") || n === "fran" ? "franc" : "fede"))).size >= 2;

  // 4E — "comparación numérica simple" (dos meses/valores INTERNOS, sin ninguna OTRA señal de
  // complejidad, sin comparar integrantes, sin cruzar varias fuentes, sin necesitar datos
  // externos, pregunta corta) → económico. El resto de comparaciones (FODA, competencia,
  // mercado/externo, causales, financiero, proyección, multi-fuente, multi-integrante, o
  // simplemente una pregunta larga) sigue yendo a potente, sin cambios. Reusa decidirWeb (no
  // duplica su criterio de qué es "externo"): si la consulta necesitaría buscar en internet,
  // por definición no es una comparación simple.
  const señalComparacion = SENALES_POTENTES.find((s) => s.id === "comparacion")!;
  const otrasSeñales = SENALES_POTENTES.filter((s) => s.id !== "comparacion");
  const necesitaWeb = decidirWeb(pregunta).habilitar;
  const esComparacionSimple = señalComparacion.re.test(t) && !otrasSeñales.some((s) => s.re.test(t)) && !distintosIntegrantes && !mencionaVariasFuentes(t) && !necesitaWeb && t.split(/\s+/).length <= 25;
  if (esComparacionSimple) return { clase: "economico", motivo: "Comparación numérica simple (dos valores, sin otras señales de análisis complejo)." };

  for (const s of SENALES_POTENTES) {
    if (s.re.test(t)) return { clase: "potente", motivo: `Requiere ${s.motivo}.` };
  }
  if (mencionaVariasFuentes(t)) return { clase: "potente", motivo: "Cruza varias fuentes de datos." };
  if (distintosIntegrantes) return { clase: "potente", motivo: "Compara varios integrantes." };

  // Pregunta muy larga/ambigua → potente (probable razonamiento).
  if (t.split(/\s+/).length > 40) return { clase: "potente", motivo: "Pregunta extensa/compleja." };

  return { clase: "economico", motivo: "Consulta directa de pocos datos." };
}

// Escalamiento en ejecución: si el modelo económico necesita demasiadas rondas de
// herramientas, escalar a potente para cerrar el análisis.
export function debeEscalar(claseActual: ModeloClase, rondasUsadas: number, umbral = 3): boolean {
  return claseActual === "economico" && rondasUsadas >= umbral;
}
