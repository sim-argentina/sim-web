// Índice del punto/día más cercano a una posición X normalizada (0..1) del gráfico,
// para el hover/tooltip de "Evolución del tráfico". Puro y testeable.
export function nearestIndex(count: number, ratio: number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return Math.round(clamped * (count - 1));
}
