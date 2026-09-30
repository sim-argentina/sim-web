// ============================================================================
// Cómo se MUESTRA una reserva existente (Bloque B3). Puro: sirve en el panel.
// ----------------------------------------------------------------------------
// Cada reserva se muestra por SU modalidad guardada (NULL = legacy):
//   · legacy: exactamente lo de siempre (bloques de 20);
//   · v2_10: inicio – fin COMERCIAL. El buffer no es tiempo vendido: se informa
//     aparte como "ocupa hasta".
// No calcula disponibilidad: solo presenta una reserva que ya existe.
// ============================================================================

import { ocupacionMinutos, turnosComerciales } from "@/lib/catalogoComercial";

const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

const aMinutos = (hora: string): number | null => {
  const m = HHMM.exec(hora);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const aHora = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export type ReservaVisible = {
  hora: string;
  duracion_minutos?: number | null;
  modalidad?: string | null;
};

export const esReservaV2 = (r: { modalidad?: string | null }): boolean => r.modalidad === "v2_10";

/** v2: inicio, fin comercial y fin de ocupación (buffer incluido). null si no es v2 o no se puede ubicar. */
export function rangoV2(r: ReservaVisible): { inicio: string; finComercial: string; finOcupacion: string } | null {
  if (!esReservaV2(r)) return null;
  const inicio = aMinutos(r.hora);
  const duracion = Number(r.duracion_minutos);
  const ocupacion = ocupacionMinutos("v2_10", duracion);
  if (inicio === null || !Number.isFinite(duracion) || ocupacion === null) return null;
  return { inicio: aHora(inicio), finComercial: aHora(inicio + duracion), finOcupacion: aHora(inicio + ocupacion) };
}

/**
 * Turnos que representa una reserva en el Turnero. legacy: la regla de siempre
 * (15 min = 1 turno). v2: bloques comerciales de 10 minutos (10→1, 20→2, 30→3).
 * El buffer nunca suma turnos.
 */
export function turnosDeReserva(r: { duracion_minutos?: number | null; modalidad?: string | null }): number {
  const minutos = Number(r.duracion_minutos) || 0;
  if (esReservaV2(r)) {
    const turnos = turnosComerciales("v2_10", minutos, 1);
    if (turnos !== null) return Math.max(1, Math.round(turnos));
  }
  return Math.max(1, Math.round((minutos || 15) / 15));
}
