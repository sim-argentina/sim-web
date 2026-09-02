// IA SIM · Bloque 4D.2 — Integridad estructural de Markdown. Se apoya en el parser seguro
// (parseMarkdown) para NO adivinar gramática con regex. Detecta respuestas mutiladas o
// truncadas: viñetas incompletas, oraciones cortadas, títulos vacíos, tablas con filas de
// distinto ancho, listas vacías. Nunca recorta texto; solo informa.

import { parseMarkdown, type Block, type Inline } from "@/lib/ia/markdown";

function textoInline(inls: Inline[]): string {
  return inls.map((i) => (i.t === "text" || i.t === "code" ? i.v : i.t === "link" ? i.v : textoInline(i.v))).join("");
}

export type IntegridadResultado = { ok: boolean; problemas: string[] };

// ¿Una oración/viñeta quedó cortada? Heurística conservadora: termina en conector/artículo/
// preposición o sin puntuación de cierre tras un texto largo.
const CORTE_FINAL = /\b(en|de|del|la|el|los|las|un|una|unos|unas|y|o|que|con|por|para|a|al|sin|su|sus|es|son|como|tiene|no tengo|no hay)$/i;

function pareceCortado(txt: string): boolean {
  const t = txt.trim();
  if (!t) return false;
  // Sin puntuación final Y termina en palabra "conectora" → probable corte.
  const sinCierre = !/[.!?:;)»"']$/.test(t);
  return sinCierre && CORTE_FINAL.test(t);
}

// Analiza la ESTRUCTURA (bloques) del Markdown y reporta problemas de integridad.
export function verificarIntegridadMarkdown(src: string): IntegridadResultado {
  const problemas: string[] = [];
  const blocks: Block[] = parseMarkdown(src || "");
  if (blocks.length === 0) { return { ok: false, problemas: ["respuesta_vacia"] }; }

  for (const b of blocks) {
    if (b.t === "heading" && textoInline(b.inline).trim() === "") problemas.push("encabezado_vacio");
    if (b.t === "p" && pareceCortado(textoInline(b.inline))) problemas.push("parrafo_cortado");
    if (b.t === "ul" || b.t === "ol") {
      if (b.items.length === 0) problemas.push("lista_vacia");
      for (const it of b.items) {
        const t = textoInline(it).trim();
        if (t === "") problemas.push("vineta_vacia");
        else if (pareceCortado(t)) problemas.push("vineta_cortada");
      }
    }
    if (b.t === "table") {
      const cols = b.header.length;
      if (cols === 0) problemas.push("tabla_sin_encabezado");
      if (b.rows.some((r) => r.length !== cols)) problemas.push("tabla_filas_desparejas");
    }
  }
  // El último bloque cortado es la señal típica de truncamiento del modelo.
  const ultimo = blocks[blocks.length - 1];
  if (ultimo && ultimo.t === "p" && pareceCortado(textoInline(ultimo.inline))) problemas.push("truncado_al_final");

  const unicos = [...new Set(problemas)];
  return { ok: unicos.length === 0, problemas: unicos };
}
