// IA SIM · Bloque 4E — Motor de comparación de valores, PURO. Toda la aritmética de
// diferencia/variación vive acá: Claude nunca la hace libremente, solo narra estos resultados.

export type UnidadMetrica = "ars" | "usd" | "turnos" | "personas" | "operaciones" | "minutos" | "horas" | "porcentaje" | "cantidad";

export type ResultadoComparacionValor = {
  valorA: number;
  valorB: number;
  diferencia: number; // B - A
  variacionPct: number | null; // null = "no calculable" (base cero); nunca se inventa un %
  unidad: UnidadMetrica;
};

// Compara dos valores de la MISMA métrica/unidad. Si el valor base (A) es cero, la variación
// porcentual es "no calculable" (null) — nunca se muestra un 0%, infinito o número inventado.
export function compararValor(valorA: number, valorB: number, unidad: UnidadMetrica): ResultadoComparacionValor {
  const diferencia = redondearSeguro(valorB - valorA);
  const variacionPct = valorA === 0 ? null : redondearSeguro((diferencia / Math.abs(valorA)) * 100, 2);
  return { valorA: redondearSeguro(valorA), valorB: redondearSeguro(valorB), diferencia, variacionPct, unidad };
}

// Redondeo defensivo a `dec` decimales (evita basura de punto flotante tipo 0.1+0.2); NO fuerza
// enteros — operaciones/promedios pueden tener decimales legítimos por reparto entre empleados.
function redondearSeguro(n: number, dec = 4): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dec;
  return Math.round(n * f) / f;
}

export type MetricaComparada = { clave: string; etiqueta: string } & ResultadoComparacionValor;

export type DefinicionMetrica = { clave: string; etiqueta: string; unidad: UnidadMetrica; valorA: number; valorB: number };

// Compara un set de métricas nombradas de una sola vez (uso típico: armar la tabla comparativa
// completa de un módulo — equipo, finanzas, stand/reservas — a partir de sus dos snapshots).
export function compararSetMetricas(defs: DefinicionMetrica[]): MetricaComparada[] {
  return defs.map((d) => ({ clave: d.clave, etiqueta: d.etiqueta, ...compararValor(d.valorA, d.valorB, d.unidad) }));
}
