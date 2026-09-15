// IA SIM · Bloque 4E — Detector de anomalías, PURO y explicable. Usa un baseline robusto
// (mediana + MAD, "modified z-score" de Iglewicz & Hoaglin) en vez de reglas rígidas o
// porcentajes arbitrarios: tolera outliers en el propio baseline y funciona con series cortas.

export type PuntoSerie = { etiqueta: string; valor: number; periodo?: string };
export type Severidad = "alta" | "media" | "baja";

export type AnomaliaDetectada = {
  tipo: string;
  etiqueta: string;
  valorObservado: number;
  baseline: number; // mediana de la serie (excluyendo el propio punto)
  diferencia: number; // valorObservado - baseline
  desviacion: number; // |modified z-score|
  severidad: Severidad;
  periodo?: string;
  evidencia: string;
  hipotesis?: string;
};

export const MUESTRA_MINIMA_ANOMALIAS = 5;

function mediana(valores: number[]): number {
  const s = [...valores].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// Modified z-score (Iglewicz & Hoaglin): 0.6745 * (x - mediana) / MAD. Umbral estándar de
// outlier ≈ 3.5; acá se usa para clasificar severidad, no solo para un corte binario.
function modifiedZScore(x: number, med: number, madVal: number): number {
  if (madVal === 0) return x === med ? 0 : Number.POSITIVE_INFINITY * Math.sign(x - med);
  return (0.6745 * (x - med)) / madVal;
}

export type OpcionesDeteccion = { tipo: string; etiquetaUnidad?: string };

// Detecta anomalías dentro de UNA serie homogénea (misma métrica, mismos módulos/unidad).
// Con menos de MUESTRA_MINIMA_ANOMALIAS puntos, no evalúa (el llamador debe decidir si baja la
// confianza o directamente informa "no alcanza para detectar anomalías con estos datos").
export function detectarAnomaliasSerie(serie: PuntoSerie[], opts: OpcionesDeteccion): AnomaliaDetectada[] {
  if (serie.length < MUESTRA_MINIMA_ANOMALIAS) return [];
  const valores = serie.map((p) => p.valor);
  const med = mediana(valores);
  const desviaciones = valores.map((v) => Math.abs(v - med));
  const madVal = mediana(desviaciones);

  const out: AnomaliaDetectada[] = [];
  for (const p of serie) {
    const z = modifiedZScore(p.valor, med, madVal);
    const abs = Math.abs(z);
    if (!Number.isFinite(abs) || abs < 3.5) continue; // umbral estándar de outlier robusto
    const severidad: Severidad = abs >= 6 ? "alta" : abs >= 4.5 ? "media" : "baja";
    const direccion = p.valor > med ? "por encima" : "por debajo";
    out.push({
      tipo: opts.tipo,
      etiqueta: p.etiqueta,
      valorObservado: p.valor,
      baseline: med,
      diferencia: Math.round((p.valor - med) * 100) / 100,
      desviacion: Math.round(abs * 100) / 100,
      severidad,
      periodo: p.periodo,
      evidencia: `${p.etiqueta}: ${p.valor}${opts.etiquetaUnidad ? ` ${opts.etiquetaUnidad}` : ""} — ${direccion} de la mediana del período (${med}${opts.etiquetaUnidad ? ` ${opts.etiquetaUnidad}` : ""}), desviación robusta ${Math.round(abs * 10) / 10}× MAD.`,
    });
  }
  return out.sort((a, b) => b.desviacion - a.desviacion);
}

// Compara dos series RELACIONADAS del mismo período (ej: Stand vs Reservas por día) y marca
// diferencias relevantes entre ellas usando el mismo criterio robusto sobre la serie de
// diferencias (no un umbral fijo como "20% de diferencia").
export function detectarDivergenciaEntreSeries(serieA: PuntoSerie[], serieB: PuntoSerie[], tipo: string, etiquetaUnidad?: string): AnomaliaDetectada[] {
  const porEtiqueta = new Map(serieB.map((p) => [p.etiqueta, p.valor]));
  const diffs: PuntoSerie[] = serieA
    .filter((p) => porEtiqueta.has(p.etiqueta))
    .map((p) => ({ etiqueta: p.etiqueta, valor: p.valor - (porEtiqueta.get(p.etiqueta) as number), periodo: p.periodo }));
  return detectarAnomaliasSerie(diffs, { tipo, etiquetaUnidad });
}
