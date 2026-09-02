// IA SIM · Bloque 4C.2 — Requisitos SOLICITADOS por el administrador, reconocidos
// determinísticamente desde el texto del pedido (no dependen de que Claude los declare).
// Cuando un componente/formato se pide EXPRESAMENTE, pasa a ser REQUISITO del borrador.

import { FORMATOS_VALIDOS, type FormatoArchivo } from "@/lib/ia/informes/limites";

export const COMPONENTES = ["resumen_ejecutivo", "conclusiones", "tablas", "graficos", "fuentes", "periodo", "metodologia", "anexo"] as const;
export type Componente = (typeof COMPONENTES)[number];

export const COMPONENTE_LABEL: Record<Componente, string> = {
  resumen_ejecutivo: "Resumen ejecutivo", conclusiones: "Conclusiones", tablas: "Tablas", graficos: "Gráficos",
  fuentes: "Fuentes", periodo: "Período", metodologia: "Metodología", anexo: "Anexo de datos",
};
export const FORMATO_LABEL: Record<FormatoArchivo, string> = { pdf: "PDF", xlsx: "Excel", docx: "Word", csv: "CSV", png: "Imagen/PNG" };

export type Requisitos = { componentes: Componente[]; formatos: FormatoArchivo[] };

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
}

const MESES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

// Detección por componente (sobre el texto normalizado, sin acentos).
const COMPONENTE_RE: Record<Componente, RegExp> = {
  resumen_ejecutivo: /resumen ejecutiv/,
  conclusiones: /conclusion|conclui/,
  tablas: /\btabla/,
  graficos: /\bgrafic/,
  fuentes: /\bfuente/,
  periodo: new RegExp(`\\bperiodo|\\bmensual\\b|\\bde (?:${MESES})\\b|\\bdel mes\\b`),
  metodologia: /metodolog/,
  anexo: /\banexo/,
};

// Detección por formato.
const FORMATO_RE: Record<FormatoArchivo, RegExp> = {
  pdf: /\bpdf\b/,
  xlsx: /\bexcel\b|\bxlsx\b|planilla|hoja de calculo/,
  docx: /\bword\b|\bdocx\b/,
  csv: /\bcsv\b/,
  png: /\bpng\b|\bimagen\b|grafico descargable/,
};

export function parsearRequisitos(pregunta: string): Requisitos {
  const t = norm(pregunta);
  const componentes = COMPONENTES.filter((c) => COMPONENTE_RE[c].test(t));
  const formatos = FORMATOS_VALIDOS.filter((f) => FORMATO_RE[f].test(t)) as FormatoArchivo[];
  return { componentes, formatos };
}

// ¿El pedido es un informe/archivo? (para decidir si aplicar requisitos)
export function pidioInforme(pregunta: string): boolean {
  const t = norm(pregunta);
  return /\binforme\b|\breporte\b|\bdescarg|\bgenera(?:me|r)?\b.*\b(pdf|excel|word|csv|informe|reporte)|\bpdf\b|\bexcel\b/.test(t);
}
