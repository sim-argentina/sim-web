// IA SIM · Bloque 5C — Render DETERMINÍSTICO de un análisis multiherramienta. Puro.
//
// Una sola respuesta combinada, igual que en 5B.1: el servidor arma todo y el modelo no vuelve a
// escribir cifras. No se publica la salida de cada herramienta por separado.
//
// Orden fijo: conclusión ejecutiva → tabla comparativa → factores de la variación → lectura de
// demanda/disponibilidad → criterios y limitaciones → fuentes internas.
//
// Nunca salen planes, ids de paso, ids de evidencia, JSON, nombres de tablas ni marcadores.

import type { ResultadoPlan, ComparacionCalculada, Evidencia } from "@/lib/ia/plan/ejecutorPlan";
import { UNIVERSOS_PLAN } from "@/lib/ia/plan/capacidades";
import { fraseMagnitud, etiquetaEsPlural, UMBRAL_ESTABLE_PCT, UMBRAL_CLARO_PCT } from "@/lib/ia/plan/compatibilidad";

const nAR = (n: number, dec: number) => n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function formatearPlan(valor: number, unidad: string): string {
  if (!Number.isFinite(valor)) return "—";
  switch (unidad) {
    case "ars": return `${valor < 0 ? "-" : ""}$${nAR(Math.abs(valor), Number.isInteger(valor) ? 0 : 2)}`;
    case "minutos": return `${nAR(Math.round(valor), 0)} min`;
    case "horas": return `${nAR(valor, Number.isInteger(valor) ? 0 : 2)} h`;
    case "porcentaje": return `${valor < 0 ? "-" : ""}${nAR(Math.abs(valor), 1)}%`;
    default: return nAR(valor, Number.isInteger(valor) ? 0 : 1);
  }
}

const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-08" → "agosto de 2026"; "2026-08-01..2026-08-31" → "agosto de 2026" si es el mes entero. */
export function etiquetaPeriodo(periodo: string): string {
  const mes = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (mes) return `${MESES[Number(mes[2])]} de ${mes[1]}`;
  const rango = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/.exec(periodo);
  if (rango) {
    const [, a1, m1, d1, a2, m2, d2] = rango;
    const ultimo = new Date(Date.UTC(Number(a2), Number(m2), 0)).getUTCDate();
    if (a1 === a2 && m1 === m2 && d1 === "01" && Number(d2) === ultimo) return `${MESES[Number(m1)]} de ${a1}`;
    return `${Number(d1)}/${m1} al ${Number(d2)}/${m2}`;
  }
  return periodo;
}

const pct = (v: number | null) => (v == null ? "no calculable" : formatearPlan(v, "porcentaje"));

function conclusionEjecutiva(r: ResultadoPlan): string {
  const principal = r.comparaciones.find((c) => c.metrica.startsWith("facturacion")) ?? r.comparaciones[0];
  if (!principal) return "No hubo resultados comparables para este análisis.";
  const partes: string[] = [];
  for (const c of r.comparaciones.filter((x) => x.tipo !== "delta_por_fuente" || x === principal)) {
    partes.push(`${c.etiqueta.toLowerCase()} ${fraseMagnitud(c.variacionPct, etiquetaEsPlural(c.etiqueta))} ${pct(c.variacionPct)} (${formatearPlan(c.diferencia, c.unidad)})`);
  }
  const unicos = [...new Set(partes)];
  return `Entre ${etiquetaPeriodo(principal.base.periodo)} y ${etiquetaPeriodo(principal.comparado.periodo)}: ${unicos.join("; ")}.`;
}

function tablaComparativa(r: ResultadoPlan): string[] {
  if (r.comparaciones.length === 0) return [];
  const vistas = new Map<string, ComparacionCalculada>();
  for (const c of r.comparaciones) if (!vistas.has(c.metrica)) vistas.set(c.metrica, c);
  const lista = [...vistas.values()];
  const base = etiquetaPeriodo(lista[0].base.periodo);
  const comparado = etiquetaPeriodo(lista[0].comparado.periodo);

  const lineas = ["", `| Métrica | ${base} | ${comparado} | Diferencia | Variación |`, "| --- | ---: | ---: | ---: | ---: |"];
  for (const c of lista) {
    lineas.push(`| ${c.etiqueta} | ${formatearPlan(c.base.valor, c.unidad)} | ${formatearPlan(c.comparado.valor, c.unidad)} | ${formatearPlan(c.diferencia, c.unidad)} | ${pct(c.variacionPct)} |`);
  }
  return lineas;
}

function factoresDeLaVariacion(r: ResultadoPlan): string[] {
  const conFuente = r.comparaciones.find((c) => c.porFuente && c.porFuente.length > 0);
  if (!conFuente || !conFuente.porFuente) return [];
  const lineas = ["", `**Qué fuentes explican el cambio de ${conFuente.etiqueta.toLowerCase()}**`];
  lineas.push(`| Fuente | ${etiquetaPeriodo(conFuente.base.periodo)} | ${etiquetaPeriodo(conFuente.comparado.periodo)} | Delta |`);
  lineas.push("| --- | ---: | ---: | ---: |");
  for (const f of conFuente.porFuente) {
    lineas.push(`| ${f.etiqueta} | ${formatearPlan(f.base, conFuente.unidad)} | ${formatearPlan(f.comparado, conFuente.unidad)} | ${formatearPlan(f.delta, conFuente.unidad)} |`);
  }
  lineas.push(`| **Total** | **${formatearPlan(conFuente.base.valor, conFuente.unidad)}** | **${formatearPlan(conFuente.comparado.valor, conFuente.unidad)}** | **${formatearPlan(conFuente.diferencia, conFuente.unidad)}** |`);

  const mayor = conFuente.porFuente[0];
  lineas.push("", `La fuente que más movió el resultado fue ${mayor.etiqueta}, con ${formatearPlan(mayor.delta, conFuente.unidad)}.`);
  if (conFuente.huboCompensacion) {
    const suben = conFuente.porFuente.filter((f) => f.delta > 0);
    const bajan = conFuente.porFuente.filter((f) => f.delta < 0);
    lineas.push(
      `Hubo compensación entre fuentes: ${suben.map((f) => f.etiqueta).join(", ")} ${suben.length === 1 ? "subió" : "subieron"} y ${bajan.map((f) => f.etiqueta).join(", ")} ${bajan.length === 1 ? "bajó" : "bajaron"}. Por eso se muestran los deltas en pesos y no porcentajes de contribución: con signos opuestos, un porcentaje del total daría una idea equivocada del peso de cada fuente.`,
    );
  }
  return lineas;
}

function lecturaDemanda(r: ResultadoPlan): string[] {
  if (!r.lectura) return [];
  const l = r.lectura;
  const lineas = ["", "**Demanda o disponibilidad**", l.texto];
  const detalle: string[] = [];
  if (l.base.actividadPct != null) detalle.push(`actividad ${pct(l.base.actividadPct)}`);
  if (l.base.disponibilidadPct != null) detalle.push(`horas programadas ${pct(l.base.disponibilidadPct)}`);
  if (detalle.length > 0) {
    lineas.push(`Se llegó a esa lectura con ${detalle.join(" y ")}; se considera estable por debajo de ${UMBRAL_ESTABLE_PCT}% y un cambio claro a partir de ${UMBRAL_CLARO_PCT}%.`);
  }
  return lineas;
}

function criteriosYLimitaciones(r: ResultadoPlan): string[] {
  const lineas: string[] = ["", "**Criterios y limitaciones**"];
  const universos = [...new Set(r.evidencias.map((e) => e.universo))];
  for (const u of universos) lineas.push(`- ${UNIVERSOS_PLAN[u].etiqueta}: ${UNIVERSOS_PLAN[u].regla}`);
  for (const a of r.advertencias) lineas.push(`- ${a}`);
  if (r.faltantes.length > 0) {
    for (const f of r.faltantes) lineas.push(`- No se pudo verificar ${f.motivo}. Esa parte queda sin responder: no se completó con una estimación.`);
  }
  lineas.push("- Los datos muestran qué cambió y en qué medida; no prueban por qué. Cualquier lectura sobre demanda o disponibilidad es compatible con las cifras, no una causa demostrada.");
  return lineas;
}

function fuentesInternas(r: ResultadoPlan): string[] {
  const dominios = [...new Set(r.evidencias.map((e) => e.fuenteInterna))].sort();
  if (dominios.length === 0) return [];
  return ["", `_Fuentes internas consultadas: ${dominios.join(", ")}._`];
}

/**
 * Síntesis del modelo YA VALIDADA, si la hubo. Se publica como conclusión adicional, sin cifras
 * nuevas: las que trae fueron verificadas contra la evidencia.
 */
export function renderResultadoPlan(r: ResultadoPlan, sintesisValidada?: string | null): string {
  const lineas: string[] = [`### ${r.objetivo}`, "", `**${conclusionEjecutiva(r)}**`];
  lineas.push(...tablaComparativa(r));
  lineas.push(...factoresDeLaVariacion(r));
  lineas.push(...lecturaDemanda(r));
  if (sintesisValidada && sintesisValidada.trim()) {
    lineas.push("", sintesisValidada.trim());
  }
  lineas.push(...criteriosYLimitaciones(r));
  lineas.push(...fuentesInternas(r));
  return lineas.join("\n");
}

/** Las evidencias que el modelo puede citar, en la forma mínima que necesita para la síntesis. */
export function evidenciasParaModelo(evidencias: Evidencia[]) {
  return evidencias.map((e) => ({
    evidenciaId: e.evidenciaId,
    metrica: e.metrica,
    etiqueta: e.etiqueta,
    periodo: e.periodo,
    valor: e.valor,
    valorFormateado: e.valorFormateado,
    unidad: e.unidad,
    universo: e.universo,
  }));
}
