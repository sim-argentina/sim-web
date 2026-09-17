// IA SIM · Bloque 4E — Motor de comparación de valores, PURO. Toda la aritmética de
// diferencia/variación vive acá: Claude nunca la hace libremente, solo narra estos resultados.

export type UnidadMetrica = "ars" | "usd" | "turnos" | "personas" | "operaciones" | "minutos" | "horas" | "porcentaje" | "cantidad";

export type ResultadoComparacionValor = {
  valorA: number;
  valorB: number;
  diferencia: number; // B - A
  variacionPct: number | null; // null = "no calculable" (base cero); nunca se inventa un %
  unidad: UnidadMetrica;
  // Bloque 4E (hotfix 2) — versiones YA FORMATEADAS (con signo, separador de miles es-AR y
  // unidad) de los cuatro valores de arriba. El modelo debe reproducir estos strings TAL CUAL
  // en la narración y en cualquier tabla: nunca debe recalcular ni reformatear el número él
  // mismo, porque ahí es donde se perdía el signo de negativos en dinero/horas.
  valorAFormateado: string;
  valorBFormateado: string;
  diferenciaFormateada: string;
  variacionFormateada: string; // "no calculable" cuando variacionPct es null
};

// Compara dos valores de la MISMA métrica/unidad. Si el valor base (A) es cero, la variación
// porcentual es "no calculable" (null) — nunca se muestra un 0%, infinito o número inventado.
export function compararValor(valorA: number, valorB: number, unidad: UnidadMetrica): ResultadoComparacionValor {
  const a = redondearSeguro(valorA);
  const b = redondearSeguro(valorB);
  const diferencia = redondearSeguro(b - a);
  const variacionPct = a === 0 ? null : redondearSeguro((diferencia / Math.abs(a)) * 100, 2);
  return {
    valorA: a, valorB: b, diferencia, variacionPct, unidad,
    valorAFormateado: formatearValorComparado(a, unidad),
    valorBFormateado: formatearValorComparado(b, unidad),
    diferenciaFormateada: formatearValorComparado(diferencia, unidad),
    variacionFormateada: variacionPct == null ? "no calculable" : formatearValorComparado(variacionPct, "porcentaje"),
  };
}

// Redondeo defensivo a `dec` decimales (evita basura de punto flotante tipo 0.1+0.2); NO fuerza
// enteros — operaciones/promedios pueden tener decimales legítimos por reparto entre empleados.
function redondearSeguro(n: number, dec = 4): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dec;
  return Math.round(n * f) / f;
}

function nAR(n: number, dec: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Bloque 4E (hotfix 2) — formatea un valor YA CALCULADO preservando el signo. "$"/"US$" van
// ANTES del número pero DESPUÉS del signo ("-$1.330.000", nunca "$-1.330.000"): el resto de
// unidades dejan que toLocaleString anteponga el signo de forma nativa.
export function formatearValorComparado(valor: number, unidad: UnidadMetrica): string {
  if (!Number.isFinite(valor)) return "—";
  const decimalesNaturales = Number.isInteger(valor) ? 0 : 1;
  switch (unidad) {
    case "ars": return `${valor < 0 ? "-" : ""}$${nAR(Math.abs(valor), Number.isInteger(valor) ? 0 : 2)}`;
    case "usd": return `${valor < 0 ? "-" : ""}US$${nAR(Math.abs(valor), 2)}`;
    case "porcentaje": return `${nAR(valor, 2)} %`;
    case "horas": return `${nAR(valor, decimalesNaturales)} h`;
    case "minutos": return `${nAR(Math.round(valor), 0)} min`;
    case "turnos": case "personas": case "operaciones": case "cantidad":
      return nAR(valor, decimalesNaturales);
    default: return nAR(valor, 2);
  }
}

export type MetricaComparada = { clave: string; etiqueta: string } & ResultadoComparacionValor;

export type DefinicionMetrica = { clave: string; etiqueta: string; unidad: UnidadMetrica; valorA: number; valorB: number };

// Compara un set de métricas nombradas de una sola vez (uso típico: armar la tabla comparativa
// completa de un módulo — equipo, finanzas, stand/reservas — a partir de sus dos snapshots).
export function compararSetMetricas(defs: DefinicionMetrica[]): MetricaComparada[] {
  return defs.map((d) => ({ clave: d.clave, etiqueta: d.etiqueta, ...compararValor(d.valorA, d.valorB, d.unidad) }));
}
