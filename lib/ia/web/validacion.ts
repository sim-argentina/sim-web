// IA SIM · Bloque 4D.1 — Validación DETERMINÍSTICA de una respuesta mixta (interna + externa)
// ANTES de publicar. No reescribe la prosa del modelo: detecta afirmaciones no respaldadas y
// agrega correcciones/limitaciones claras (o, en el peor caso, marca la afirmación). No depende
// del comportamiento del modelo. No dispara nuevas búsquedas ni reintentos facturables.

import { SIM_IDENTIDAD } from "@/lib/ia/entidad";

export type Advertencia = { codigo: string; texto: string };
export type CtxValidacion = { periodoFinalizado?: boolean; hayBenchmarkCompetidores?: boolean };

// Denominaciones históricas de SIM (para no confundirlas con competidores).
const HIST = SIM_IDENTIDAD.denominaciones_historicas.map((h) => h.toLowerCase());

const CHK: Array<{ codigo: string; test: (t: string, c: CtxValidacion) => boolean; texto: string }> = [
  {
    codigo: "entidad_historica_como_competidor",
    test: (t) => { const tl = t.toLowerCase(); return HIST.some((h) => tl.includes(h)) && /\b(competidor|competencia|compet|vs\.?|players?|rival)\b/i.test(t); },
    texto: "«SIM Café Racer» es una denominación HISTÓRICA de SIM Argentina, no un competidor independiente: la marca actual es SIM / SIM Argentina y no existe el modelo de bar.",
  },
  {
    codigo: "periodo_incompleto_erroneo",
    test: (t, c) => Boolean(c.periodoFinalizado) && /\b(incompleto|mes incompleto|corte actual)\b/i.test(t),
    texto: "El período consultado ya está finalizado (calendario). No debe describirse como «incompleto»; si el cierre financiero sigue abierto, corresponde «cierre financiero pendiente».",
  },
  {
    codigo: "superlativo_sin_benchmark",
    // Solo marca superlativos AFIRMADOS: si la oración los NIEGA o dice que "no puede
    // determinarse", no es un error (el modelo actuó bien).
    test: (t, c) => {
      if (c.hayBenchmarkCompetidores) return false;
      const sup = /\b(l[íi]der|mayor volumen|el de mayor|m[áa]s competitiv|presencia mayor|volumen (operativo )?alto|ocupaci[óo]n (alta|sostenida)|el m[áa]s grande|dominante)\b/i;
      const negacion = /\b(no|sin|nunca|tampoco|no puede|no hay|no se puede|determinar|difícil|imposible)\b/i;
      return t.split(/[.\n;]/).some((frase) => sup.test(frase) && !negacion.test(frase));
    },
    texto: "Hay afirmaciones comparativas/superlativas (p. ej. «volumen alto», «ocupación sostenida», «mayor volumen») sin un benchmark comparable ni capacidad máxima conocida: se presentan como no determinables.",
  },
  {
    codigo: "maquinas_derivadas_de_operaciones",
    test: (t) => /(operaciones|turnos)[^.]{0,40}(m[áa]quinas|estaciones)/i.test(t) || /\b\d+\s*[-–a]\s*\d+\s*(m[áa]quinas|estaciones)/i.test(t),
    texto: "No se puede derivar la cantidad de máquinas/estaciones a partir de las operaciones o turnos: es un dato de capacidad no disponible en las herramientas internas.",
  },
  {
    codigo: "precio_externo_sin_moneda",
    test: (t) => {
      // Rango o precio por sesión/minuto con "$" pero sin ARS/USD/pesos cerca.
      const m = t.match(/\$\s?\d[\d.,]*\s*(?:[kK]|mil)?\s*(?:[-–a/]\s*\$?\s?\d[\d.,]*\s*(?:[kK]|mil)?)?(?:\s*\/\s*(?:sesi|min|hora|persona))?/g) || [];
      return m.some((frag) => !/(ars|usd|pesos|d[óo]lares?)/i.test(frag) && /[-–a/]|[kK]|mil/.test(frag));
    },
    texto: "Hay precios externos sin moneda, fecha ni vigencia explícitas (el símbolo «$» no basta en una comparación): deben indicarse ARS o USD, la fecha de publicación y si la vigencia fue confirmada; si no, no son comparables.",
  },
];

// Valida y devuelve advertencias + un bloque de notas para anexar a la respuesta (si hay).
export function validarRespuestaMixta(texto: string, ctx: CtxValidacion): { advertencias: Advertencia[]; notas: string } {
  const t = texto || "";
  const advertencias: Advertencia[] = [];
  for (const c of CHK) { if (c.test(t, ctx)) advertencias.push({ codigo: c.codigo, texto: c.texto }); }
  const notas = advertencias.length === 0 ? "" : `\n\n---\n**Verificación automática de IA SIM** (revisá estas salvedades antes de tomar decisiones):\n${advertencias.map((a) => `- ${a.texto}`).join("\n")}`;
  return { advertencias, notas };
}
