import type { ModeloClase } from "@/lib/ia/config";

// IA SIM · Bloque 4A — Router DETERMINÍSTICO de modelo. Una consulta simple NO debe
// usar el modelo caro. Elección explicable y testeable (sin llamar al proveedor).

export type DecisionRouter = { clase: ModeloClase; motivo: string };

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Señales de razonamiento complejo → modelo POTENTE.
const SENALES_POTENTES: Array<{ re: RegExp; motivo: string }> = [
  { re: /\bfoda\b/, motivo: "análisis FODA" },
  { re: /\bcompar|\bversus\b|\bvs\b|\bcontra\b|\bfrente a\b/, motivo: "comparación" },
  { re: /\bdiagnostic|\bconclus|\banaliz|\banalisis\b|\bevalua/, motivo: "diagnóstico/análisis" },
  { re: /\bproyec|\bestima|\bpronostic|\btendencia|\bescenario/, motivo: "proyección" },
  { re: /\bpor que\b|\bpor qué\b|\bporque baj|\bmotivo|\bcausa|\bexplica por/, motivo: "explicación causal" },
  { re: /\brentab|\bganancia|\bfinancier|\brendimiento del negocio|\bsalud del negocio/, motivo: "análisis financiero" },
  { re: /\bconvien|\brecomend|\bque haria|\bque harias|\bsugerenc|\bdeberia/, motivo: "recomendación" },
];

// Señales de "cruce de varias fuentes" → potente aunque no haya palabra clave directa.
function mencionaVariasFuentes(t: string): boolean {
  const fuentes = ["finanz", "cronograma", "equipo", "stand", "reserva", "colectivo", "empleado"];
  return fuentes.filter((f) => t.includes(f)).length >= 2;
}

export function elegirModelo(pregunta: string): DecisionRouter {
  const t = norm(pregunta);

  for (const s of SENALES_POTENTES) {
    if (s.re.test(t)) return { clase: "potente", motivo: `Requiere ${s.motivo}.` };
  }
  if (mencionaVariasFuentes(t)) return { clase: "potente", motivo: "Cruza varias fuentes de datos." };

  // Comparación implícita: dos nombres de integrantes en la misma pregunta.
  const nombres = ["ramiro", "rami", "francisco", "fran", "federico", "fede"].filter((n) => new RegExp(`\\b${n}\\b`).test(t));
  const distintos = new Set(nombres.map((n) => (n.startsWith("ram") ? "r" : n.startsWith("fra") || n === "fran" ? "franc" : "fede")));
  if (distintos.size >= 2) return { clase: "potente", motivo: "Compara varios integrantes." };

  // Pregunta muy larga/ambigua → potente (probable razonamiento).
  if (t.split(/\s+/).length > 40) return { clase: "potente", motivo: "Pregunta extensa/compleja." };

  return { clase: "economico", motivo: "Consulta directa de pocos datos." };
}

// Escalamiento en ejecución: si el modelo económico necesita demasiadas rondas de
// herramientas, escalar a potente para cerrar el análisis.
export function debeEscalar(claseActual: ModeloClase, rondasUsadas: number, umbral = 3): boolean {
  return claseActual === "economico" && rondasUsadas >= umbral;
}
