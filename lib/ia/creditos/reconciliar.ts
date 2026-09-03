// IA SIM · Bloque 4D.3 — Reconciliación PURA del consumo. Suma tokens y costo de un conjunto
// de ejecuciones/OCR reales: excluye el proveedor fake, cuenta la caché UNA vez (ya viene dentro
// de tokens_in), no duplica y no cuenta renders locales (no generan filas). Determinística.

export type FilaConsumo = { tokens_in: number; tokens_out: number; costo_estimado?: number | string | null; proveedor?: string | null };

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function reconciliarConsumo(filas: FilaConsumo[]): { tokens: number; tokensIn: number; tokensOut: number; costoUsd: number; incluidas: number } {
  let tokensIn = 0, tokensOut = 0, costo = 0, incluidas = 0;
  for (const f of filas) {
    if ((f.proveedor ?? "") === "fake") continue; // fake no consume
    tokensIn += num(f.tokens_in); tokensOut += num(f.tokens_out); costo += num(f.costo_estimado); incluidas++;
  }
  return { tokens: tokensIn + tokensOut, tokensIn, tokensOut, costoUsd: Math.round(costo * 1e6) / 1e6, incluidas };
}
