// IA SIM · Bloque 4E — Ajuste por inflación, PURO. Recibe la serie IPC ya cargada (nunca la
// consulta ni la inventa): si falta el índice de un período, no ajusta y lo declara faltante.

export type PuntoIpc = { periodo: string; indice: number }; // periodo: 'YYYY-MM'

export type ResultadoAjusteInflacion =
  | { ok: true; periodoBase: string; montoNominal: number; montoConstante: number; factor: number; indiceBase: number; indiceOrigen: number }
  | { ok: false; motivo: "indice_faltante"; periodoFaltante: string };

// Ajusta `monto` (en el período `periodoOrigen`) a pesos constantes del `periodoBase`, usando
// SOLO los índices ya presentes en `serie`. Fórmula (metodología a mostrar siempre en el
// detalle): montoConstante = montoNominal * (indice[periodoBase] / indice[periodoOrigen]).
export function ajustarPorInflacion(monto: number, periodoOrigen: string, periodoBase: string, serie: Map<string, number>): ResultadoAjusteInflacion {
  const indiceOrigen = serie.get(periodoOrigen);
  if (indiceOrigen == null) return { ok: false, motivo: "indice_faltante", periodoFaltante: periodoOrigen };
  const indiceBase = serie.get(periodoBase);
  if (indiceBase == null) return { ok: false, motivo: "indice_faltante", periodoFaltante: periodoBase };
  const factor = indiceBase / indiceOrigen;
  return { ok: true, periodoBase, montoNominal: monto, montoConstante: Math.round(monto * factor * 100) / 100, factor: Math.round(factor * 1_000_000) / 1_000_000, indiceBase, indiceOrigen };
}

// ¿Vale la pena/corresponde ofrecer el ajuste? Períodos separados por más de 1 mes calendario,
// o comparación interanual (mismo mes, distinto año) — criterio explícito, no implícito.
export function ajusteEsRelevante(periodoA: string, periodoB: string): boolean {
  const [ay, am] = periodoA.split("-").map(Number);
  const [by, bm] = periodoB.split("-").map(Number);
  if (ay === by && am === bm) return false; // mismo mes exacto: nada que ajustar
  const mesesA = ay * 12 + am, mesesB = by * 12 + bm;
  const diffMeses = Math.abs(mesesB - mesesA);
  const interanual = am === bm && ay !== by;
  return diffMeses > 1 || interanual;
}
