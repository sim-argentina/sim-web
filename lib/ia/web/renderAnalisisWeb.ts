// IA SIM · Corrección 4D.5.2 — Renderizado LOCAL y DETERMINÍSTICO del análisis estructurado a
// Markdown seguro (mismo parser/SafeMarkdown ya usado en todo el chat). El modelo NUNCA genera
// la presentación final: solo completa la estructura validada (analisisWebSchema.ts); este
// módulo arma el texto. Nunca usa dangerouslySetInnerHTML (no genera HTML en absoluto).

import type { AnalisisWebValidado, FuenteInternaDisponible, FuenteExternaDisponible } from "@/lib/ia/web/analisisWebSchema";
import type { ClaseEntidad } from "@/lib/ia/entidad";

const ETIQUETA_CLASE: Record<ClaseEntidad, string> = {
  misma_entidad: "Es la propia empresa (SIM)",
  competidor_directo_confirmado: "Competidor directo confirmado",
  competidor_potencial_o_ambiguo: "Competidor potencial o ambiguo",
  sustituto: "Sustituto (cubre una necesidad parecida, no el mismo servicio)",
  proveedor_o_fabricante: "Proveedor / fabricante (no compite por el mismo servicio)",
  red_o_plataforma: "Red o plataforma nacional (sin sede local confirmada)",
  evento: "Evento / sustituto ocasional (no un operador permanente)",
  irrelevante: "Sin actividad comparable",
};

// Escapa `|` (rompería una fila de tabla) y colapsa saltos de línea dentro de una celda.
function celda(s: string): string {
  return (s || "").replace(/\|/g, "/").replace(/\s*\r?\n\s*/g, " ").trim();
}

export function renderAnalisisWeb(
  spec: AnalisisWebValidado,
  ctx: { internas: FuenteInternaDisponible[]; externas: FuenteExternaDisponible[] }
): string {
  const internasPorId = new Map(ctx.internas.map((f) => [f.id, f]));
  const externasPorId = new Map(ctx.externas.map((f) => [f.id, f]));
  const partes: string[] = [];

  partes.push(spec.respuestaDirecta);

  // ── Datos internos ──────────────────────────────────────────────────────────────────
  const internasUsadas = spec.datosInternosIds.map((id) => internasPorId.get(id)).filter((f): f is FuenteInternaDisponible => Boolean(f));
  if (internasUsadas.length > 0) {
    partes.push(`## Datos internos de SIM\n${internasUsadas.map((f) => `- ${f.texto}`).join("\n")}`);
  }

  // ── Actores externos ────────────────────────────────────────────────────────────────
  if (spec.actoresExternos.length > 0) {
    const bloques = spec.actoresExternos.map((a) => {
      const fuentesTxt = a.fuenteIds
        .map((id) => externasPorId.get(id))
        .filter((f): f is FuenteExternaDisponible => Boolean(f))
        .map((f) => `[${f.titulo || f.dominio || f.url}](${f.url})`)
        .join(", ");
      return `### ${a.nombre} — ${ETIQUETA_CLASE[a.clase]}\n${a.evidencia}${fuentesTxt ? `\n\nFuentes: ${fuentesTxt}` : ""}`;
    });
    partes.push(`## Actores externos\n${bloques.join("\n\n")}`);
  }

  // ── Comparación ─────────────────────────────────────────────────────────────────────
  if (spec.comparacion.length > 0) {
    const filas = spec.comparacion.map((f) => `| ${celda(f.aspecto)} | ${celda(f.sim)} | ${celda(f.mercado)} |`).join("\n");
    partes.push(`## Comparación\n| Aspecto | SIM | Mercado |\n| --- | --- | --- |\n${filas}`);
  }

  // ── No determinable ─────────────────────────────────────────────────────────────────
  if (spec.noDeterminable.length > 0) {
    partes.push(`## No se puede determinar con lo disponible\n${spec.noDeterminable.map((n) => `- ${n}`).join("\n")}`);
  }

  // ── Conclusión ──────────────────────────────────────────────────────────────────────
  partes.push(`## Conclusión\n${spec.conclusion}`);

  // ── Fuentes ─────────────────────────────────────────────────────────────────────────
  if (ctx.internas.length > 0) {
    partes.push(`## Fuentes internas\n${ctx.internas.map((f) => `- ${f.modulo}${f.periodo ? ` · ${f.periodo}` : ""}`).join("\n")}`);
  }
  if (ctx.externas.length > 0) {
    partes.push(`## Fuentes externas\n${ctx.externas.map((f) => `- [${f.titulo || f.dominio || f.url}](${f.url})${f.dominio ? ` — ${f.dominio}` : ""}`).join("\n")}`);
  }

  return partes.join("\n\n");
}
