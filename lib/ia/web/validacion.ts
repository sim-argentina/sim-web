// IA SIM · Bloque 4D.2 — Validación DETERMINÍSTICA de una respuesta mixta (interna + externa)
// ANTES de publicar. NO destructiva: nunca recorta la prosa del modelo; solo, si quedan
// salvedades REALES, anexa una nota bien formada (una vez, sin repetir lo ya aclarado). Tiene
// conciencia de POLARIDAD: una afirmación correcta o una negación explícita NO genera
// advertencia. No dispara nuevas búsquedas ni reintentos.

import { SIM_IDENTIDAD } from "@/lib/ia/entidad";
import { verificarIntegridadMarkdown } from "@/lib/ia/web/markdownIntegridad";

export const VALIDADOR_VERSION = "4D.2";

export type Advertencia = { codigo: string; texto: string };
export type CtxValidacion = { periodoFinalizado?: boolean; hayBenchmarkCompetidores?: boolean };
export type ResultadoValidacion = { advertencias: Advertencia[]; notas: string; integridad: { ok: boolean; problemas: string[] } };

const HIST = SIM_IDENTIDAD.denominaciones_historicas.map((h) => h.toLowerCase());

// Divide en "unidades semánticas" (oraciones/viñetas) para analizar polaridad por unidad.
function unidades(texto: string): string[] {
  return (texto || "").split(/(?:\r?\n|(?<=[.!?;:])\s)/).map((s) => s.trim()).filter(Boolean);
}
// Negación / incertidumbre / aclaración que INVALIDA que la afirmación sea un error.
const NEG = /\b(no|sin|nunca|tampoco|no puede|no se puede|no hay|no tengo|no cuento|no la cuento|no es|no son|denominaci[óo]n hist[óo]rica|nombre hist[óo]rico|misma (empresa|entidad)|no un competidor|no es un competidor|no corresponde|no permite|no permiten|ambigu|incierto|no puede determinarse|no puede estimarse|no se puede determinar|difícil|imposible|pendiente|finaliz)\b/i;

function afirmadoSinNegar(texto: string, patron: RegExp): boolean {
  return unidades(texto).some((u) => patron.test(u) && !NEG.test(u));
}

const CHK: Array<{ codigo: string; test: (t: string, c: CtxValidacion) => boolean; texto: string }> = [
  {
    // Solo si SIM Café Racer se AFIRMA como competidor (no si ya se aclara que es histórico).
    codigo: "entidad_historica_como_competidor",
    test: (t) => {
      const tl = t.toLowerCase();
      if (!HIST.some((h) => tl.includes(h))) return false;
      return unidades(t).some((u) => {
        const ul = u.toLowerCase();
        if (!HIST.some((h) => ul.includes(h))) return false;
        const afirmaCompetidor = /\b(competidor|competencia|rival)\b/i.test(u);
        return afirmaCompetidor && !NEG.test(u);
      });
    },
    texto: "«SIM Café Racer» es una denominación HISTÓRICA de SIM Argentina, no un competidor independiente (hoy la marca es SIM / SIM Argentina).",
  },
  {
    codigo: "periodo_incompleto_erroneo",
    test: (t, c) => Boolean(c.periodoFinalizado) && afirmadoSinNegar(t, /\b(mes )?incompleto|corte actual\b/i),
    texto: "El período consultado ya está finalizado (calendario). No corresponde «incompleto»; si el cierre financiero sigue abierto, es «cierre financiero pendiente».",
  },
  {
    codigo: "superlativo_sin_benchmark",
    test: (t, c) => !c.hayBenchmarkCompetidores && afirmadoSinNegar(t, /\b(l[íi]der|mayor volumen|el de mayor|m[áa]s competitiv|presencia mayor|el m[áa]s grande|dominante)\b|muy minoritari|muy poco significativ|\bvolumen\b[^.]{0,12}\balto\b|\bocupaci[óo]n\b[^.]{0,12}\b(alta|sostenida)\b|\b(alta|sostenida)\b[^.]{0,12}\bocupaci[óo]n\b/i),
    texto: "Hay afirmaciones comparativas/superlativas (p. ej. «mayor volumen», «ocupación sostenida», «muy minoritario») sin un benchmark comparable ni la métrica explícita: expresá la participación con números (turnos o facturación) o indicá que no puede determinarse.",
  },
  {
    codigo: "maquinas_derivadas_de_operaciones",
    // Máquinas/estaciones y operaciones/turnos cerca (≤70 chars, cualquier orden) y sin negación
    // en el entorno = derivación indebida. Proximidad por caracteres (tolera "aprox.", saltos).
    test: (t) => {
      const re = /\b(m[áa]quinas|estaciones)\b/gi;
      for (const m of t.matchAll(re)) {
        const i = m.index ?? 0;
        const ventana = t.slice(Math.max(0, i - 70), i + 70);
        if (/\b(operaciones|turnos)\b/i.test(ventana) && !NEG.test(ventana)) return true;
      }
      return false;
    },
    texto: "No se puede derivar la cantidad de máquinas/estaciones a partir de las operaciones o turnos: es un dato de capacidad no disponible en las herramientas internas.",
  },
  {
    codigo: "precio_externo_sin_moneda",
    test: (t) => {
      const m = t.match(/\$\s?\d[\d.,]*\s*(?:[kK]|mil)?\s*(?:[-–a/]\s*\$?\s?\d[\d.,]*\s*(?:[kK]|mil)?)?(?:\s*\/\s*(?:sesi|min|hora|persona))?/g) || [];
      return m.some((frag) => !/(ars|usd|pesos|d[óo]lares?)/i.test(frag) && /[-–a/]|[kK]|mil/.test(frag));
    },
    texto: "Hay precios externos sin moneda, fecha ni vigencia explícitas (el símbolo «$» no basta): indicá ARS o USD, la fecha de publicación y si la vigencia fue confirmada; si no, no son comparables.",
  },
];

// Valida (polaridad + integridad) y devuelve advertencias + notas para anexar (si corresponde).
export function validarRespuestaMixta(texto: string, ctx: CtxValidacion): ResultadoValidacion {
  const t = texto || "";
  const advertencias: Advertencia[] = [];
  for (const c of CHK) { if (c.test(t, ctx)) advertencias.push({ codigo: c.codigo, texto: c.texto }); }
  const integridad = verificarIntegridadMarkdown(t);
  const notas = advertencias.length === 0 ? "" : `\n\n---\n**Verificación automática de IA SIM** (revisá estas salvedades):\n${advertencias.map((a) => `- ${a.texto}`).join("\n")}`;
  return { advertencias, notas, integridad };
}
