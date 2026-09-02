// IA SIM · Bloque 4D.1 — Cálculos DETERMINÍSTICOS sobre datos internos (no aritmética libre
// del modelo). Cada cálculo expone fórmula, operandos, unidad, criterio y fuentes. Lo que no
// tiene denominador válido NO se calcula; lo que no es derivable (máquinas desde operaciones)
// se rechaza explícitamente.

export type Calculo = {
  formula: string; numerador: number; denominador?: number;
  resultado: number; unidad: string; criterio: string; redondeo: number;
  fuentes: string[];
};
export type CalculoError = { error: string; motivo: string };

const round = (n: number, dec: number) => Math.round(n * 10 ** dec) / 10 ** dec;

// Minutos de actividad de clientes → horas de ACTIVIDAD DE CLIENTES (no horas trabajadas ni
// capacidad instalada ni horas operativas).
export function horasDeActividad(minutos: number): Calculo {
  const resultado = round(minutos / 60, 1);
  return {
    formula: `${minutos} min ÷ 60`, numerador: minutos, denominador: 60,
    resultado, unidad: "horas de actividad de clientes", criterio: "minutos-persona de uso / 60",
    redondeo: 1, fuentes: ["Métricas de Equipo / Stand+Reservas"],
  };
}

// Promedio por día. `criterio` = 'calendario' (días del mes) o 'abiertos' (del cronograma).
// Requiere un denominador VÁLIDO (> 0); si no, no calcula.
export function promedioPorDia(total: number, dias: number, criterio: "calendario" | "abiertos", unidad: string, fuentes: string[]): Calculo | CalculoError {
  if (!Number.isFinite(dias) || dias <= 0) return { error: "sin_denominador", motivo: "No hay un número de días válido para promediar." };
  const resultado = round(total / dias, 1);
  return {
    formula: `${total} ÷ ${dias} días`, numerador: total, denominador: dias,
    resultado, unidad: `${unidad} por día ${criterio === "abiertos" ? "abierto" : "calendario"}`,
    criterio: criterio === "abiertos" ? "denominador = días abiertos del cronograma" : "denominador = días del mes calendario",
    redondeo: 1, fuentes,
  };
}

// Participación de una parte sobre el total, con la MÉTRICA explícita (turnos, personas,
// operaciones o facturación). Evita "muy minoritario" sin criterio.
export function participacion(parte: number, total: number, metrica: string): Calculo | CalculoError {
  if (!Number.isFinite(total) || total <= 0) return { error: "sin_total", motivo: "No hay un total válido para calcular participación." };
  const resultado = round((parte / total) * 100, 1);
  return {
    formula: `${parte} / ${total} × 100`, numerador: parte, denominador: total,
    resultado, unidad: `% de ${metrica}`, criterio: `participación por ${metrica}`, redondeo: 1,
    fuentes: ["Métricas de Equipo / Stand+Reservas"],
  };
}

// bruto − comisión = neto (reconciliación exacta con la fuente).
export function neto(bruto: number, comision: number): Calculo {
  return {
    formula: `${bruto} − ${comision}`, numerador: bruto, resultado: round(bruto - comision, 2),
    unidad: "ARS (neto)", criterio: "bruto − comisión", redondeo: 2, fuentes: ["Finanzas / Métricas"],
  };
}

// La cantidad de MÁQUINAS/ESTACIONES NO se puede derivar de las operaciones/turnos: son
// métricas distintas (una máquina atiende muchas operaciones). Siempre rechaza.
export function maquinasDesdeOperaciones(_operaciones: number): CalculoError {
  void _operaciones;
  return { error: "no_derivable", motivo: "La cantidad de máquinas/estaciones no se deriva de las operaciones; es un dato de capacidad no disponible en las herramientas." };
}
