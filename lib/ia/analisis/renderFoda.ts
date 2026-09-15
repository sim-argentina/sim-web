// IA SIM · Bloque 4E — Render LOCAL y determinístico del FODA validado a Markdown seguro. El
// modelo nunca genera la presentación final (mismo patrón que renderAnalisisWeb.ts).

import type { FodaValidado, PuntoFodaValidado, FuenteInternaDisponible, FuenteExternaDisponible } from "@/lib/ia/analisis/fodaSchema";

function celdaFuentes(ids: string[], internasPorId: Map<string, FuenteInternaDisponible>, externasPorId: Map<string, FuenteExternaDisponible>): string {
  return ids.map((id) => {
    const ext = externasPorId.get(id);
    if (ext) return `[${ext.titulo || ext.dominio || ext.url}](${ext.url})`;
    const int = internasPorId.get(id);
    if (int) return int.modulo;
    return null;
  }).filter((s): s is string => Boolean(s)).join(", ");
}

function renderCuadrante(titulo: string, puntos: PuntoFodaValidado[], internasPorId: Map<string, FuenteInternaDisponible>, externasPorId: Map<string, FuenteExternaDisponible>): string {
  if (puntos.length === 0) return `### ${titulo}\n_Sin puntos respaldados con la evidencia disponible._`;
  const items = puntos.map((p) => {
    const fuentesTxt = celdaFuentes(p.fuenteIds, internasPorId, externasPorId);
    return `- ${p.texto} _(confianza: ${p.confianza}${fuentesTxt ? ` · fuente: ${fuentesTxt}` : ""})_`;
  });
  return `### ${titulo}\n${items.join("\n")}`;
}

export function renderFoda(spec: FodaValidado, ctx: { internas: FuenteInternaDisponible[]; externas: FuenteExternaDisponible[] }): string {
  const internasPorId = new Map(ctx.internas.map((f) => [f.id, f]));
  const externasPorId = new Map(ctx.externas.map((f) => [f.id, f]));
  const partes = [
    renderCuadrante("Fortalezas", spec.fortalezas, internasPorId, externasPorId),
    renderCuadrante("Debilidades", spec.debilidades, internasPorId, externasPorId),
    renderCuadrante("Oportunidades", spec.oportunidades, internasPorId, externasPorId),
    renderCuadrante("Amenazas", spec.amenazas, internasPorId, externasPorId),
    `## Conclusión\n${spec.conclusion}`,
  ];
  if (ctx.internas.length > 0) partes.push(`## Fuentes internas\n${ctx.internas.map((f) => `- ${f.modulo}${f.periodo ? ` · ${f.periodo}` : ""}`).join("\n")}`);
  if (ctx.externas.length > 0) partes.push(`## Fuentes externas\n${ctx.externas.map((f) => `- [${f.titulo || f.dominio || f.url}](${f.url})${f.dominio ? ` — ${f.dominio}` : ""}`).join("\n")}`);
  return partes.join("\n\n");
}
