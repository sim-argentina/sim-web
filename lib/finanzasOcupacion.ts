// ============================================================================
// Ocupación teórica de Finanzas (Bloque B8). Módulo PURO: sin base.
// ----------------------------------------------------------------------------
// Qué mide hoy (y se conserva): los turnos del Turnero del mes contra una
// capacidad en "slots" de (15 + demora promedio de subida) minutos por
// simulador y día (capacidadYDiasOperativos). Es una ocupación del STAND: las
// reservas online no entran (nunca entraron).
//
// Por qué no alcanza con eso desde v2: un turno v2 es un bloque de 10 minutos
// y un slot asume uno de 15. Sumar turnos de las dos modalidades contra los
// mismos slots mezcla unidades. Tampoco sirve "octubre = v2": con el override
// en legacy, en octubre se vende legacy hasta la activación, y un rollback
// futuro puede volver a mezclar.
//
// Cómo se resuelve, fila por fila y con SU modalidad persistida:
//   · filas legacy: la fórmula de siempre, turnos / slots. Si el mes no tiene
//     filas v2 el resultado es EXACTAMENTE el anterior (julio–septiembre);
//   · filas v2: minutos vendidos / minutos disponibles del mes (simuladores ×
//     horas operativas, con las mismas excepciones). Sin unidad fija de 15 y
//     sin buffer: el Stand no ocupa la agenda online.
//   · la ocupación es la suma de las dos fracciones de la misma capacidad.
// ============================================================================

export type OcupacionStandV2 = {
  /** Σ coalesce(cantidad_turnos, 1) de las filas v2 del mes (ya incluidas en turnosDelMes). */
  turnos: number;
  /** Minutos comerciales vendidos por esas filas (minutos por persona × personas). */
  minutos: number;
};

export type DatosOcupacion = {
  /** Turnos del Turnero del mes (fin_ingresos_por_mes): legacy y v2 juntos. */
  turnosDelMes: number;
  /** Slots de capacidad del mes (capacidadYDiasOperativos.capacidad). */
  capacidad: number;
  /** Minutos-simulador disponibles del mes (capacidadYDiasOperativos.minutosDisponibles). */
  minutosDisponibles: number;
  standV2: OcupacionStandV2;
};

const redondear = (x: number) => Math.round(x * 10000) / 10000;

/** Misma regla que el `ratio` de la ruta de métricas: null si no hay denominador. */
function ratio(num: number, den: number): number | null {
  if (!den) return null;
  return redondear(num / den);
}

export function ocupacionTeorica(d: DatosOcupacion): number | null {
  // Sin filas v2: exactamente la fórmula anterior.
  if (d.standV2.turnos === 0 && d.standV2.minutos === 0) return ratio(d.turnosDelMes, d.capacidad);
  const turnosLegacy = Math.max(0, d.turnosDelMes - d.standV2.turnos);
  if (!d.capacidad && !d.minutosDisponibles) return null;
  const parteLegacy = d.capacidad ? turnosLegacy / d.capacidad : 0;
  const parteV2 = d.minutosDisponibles ? d.standV2.minutos / d.minutosDisponibles : 0;
  return redondear(parteLegacy + parteV2);
}
