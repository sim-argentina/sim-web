// Horarios, precios y ocupación de reservas.
//
// (M6) Los horarios, la ventana pública y el mapeo duración → bloques YA NO se
// definen acá: la fuente única es `lib/agenda.ts`, que también consume el
// navegador. Este módulo queda como la cara histórica de esa política —lo
// importan /api/reservas, /api/mercadopago/*, Empresas, el Calendario del admin
// y los bloqueos— para no cambiar en un solo paso a nueve consumidores.
//
// Todo lo que se re-exporta apunta a `lib/agenda.ts`: no hay una segunda copia
// de los horarios ni una segunda función de bloques en ningún lado.

import {
  WEEKDAY_SLOTS as SLOTS_SEMANA,
  WEEKEND_SLOTS as SLOTS_FINDE,
  DURACIONES_POR_PRODUCTO,
  PASO_AGENDA_MIN,
  bloquesDeAgenda,
  esFinDeSemana,
  horariosDe,
} from "@/lib/agenda";
import { ocupacionMinutos } from "@/lib/catalogoComercial";

export const WEEKDAY_SLOTS: readonly string[] = SLOTS_SEMANA;
export const WEEKEND_SLOTS: readonly string[] = SLOTS_FINDE;

// Precios por simulador/persona. Los precios especiales por fecha se resuelven
// en lib/reservasPricing.ts; esto es el precio normal vigente.
export const PRECIO_15 = 12000;
export const PRECIO_30_SEMANA = 18000;
export const PRECIO_30_FINDE = 20000;

// Duraciones de una RESERVA NORMAL. 45 y 60 existen solo para Mensualidades y
// viven en DURACIONES_POR_PRODUCTO.
export const DURACIONES_VALIDAS = DURACIONES_POR_PRODUCTO.reserva as readonly (15 | 30)[];
export type Duracion = 15 | 30;

export function isWeekendDateKey(dateKey: string): boolean {
  return esFinDeSemana(dateKey);
}

export function getSlotsForDate(dateKey: string): string[] {
  if (!dateKey) return [];
  return horariosDe(dateKey);
}

// Turno siguiente (20 min después) dentro del mismo día, o null.
export function getNextSlot(dateKey: string, hora: string): string | null {
  const slots = getSlotsForDate(dateKey);
  const idx = slots.indexOf(hora);
  if (idx === -1) return null;
  return slots[idx + 1] ?? null;
}

// Posiciones de agenda que ocupa una reserva según su duración.
//
// Contrato IDÉNTICO al histórico para no alterar a ningún consumidor: siempre
// devuelve al menos [hora]. La versión estricta —que devuelve null cuando la
// duración no entra o hay una discontinuidad— es `bloquesDeAgenda` de
// lib/agenda.ts, y es la que usa toda la validación nueva.
export function getOccupiedSlots(
  dateKey: string,
  hora: string,
  duracion: number
): string[] {
  return bloquesDeAgenda(dateKey, hora, duracion) ?? [hora];
}

// Precio por simulador según día y duración.
export function precioPorSimulador(dateKey: string, duracion: number): number {
  if (Number(duracion) >= 30) {
    return isWeekendDateKey(dateKey) ? PRECIO_30_FINDE : PRECIO_30_SEMANA;
  }
  return PRECIO_15;
}

type ReservaOcupacion = {
  hora: string;
  duracion_minutos?: number | null;
  simuladores: unknown;
  /** (B3) NULL o 'legacy': bloques de 20 como siempre. 'v2_10': duración + buffer. */
  modalidad?: string | null;
};

const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
function aMinutos(hora: string): number | null {
  const m = HHMM.exec(hora);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * (B3) Bloques de la grilla legacy del día que toca una reserva v2: su
 * ocupación [hora, hora + duración + buffer) no cae alineada a los bloques de
 * 20, así que ocupa TODO bloque con el que comparte algún minuto. Así lo que
 * todavía calcula por bloques (Mensualidades, Empresas) ve a las reservas v2.
 */
function bloquesTocadosPorV2(dateKey: string, hora: string, duracion: unknown): string[] {
  const inicio = aMinutos(hora);
  const ocupacion = ocupacionMinutos("v2_10", duracion);
  if (inicio === null || ocupacion === null) return [];
  const fin = inicio + ocupacion;
  return getSlotsForDate(dateKey).filter((slot) => {
    const m = aMinutos(slot);
    return m !== null && m < fin && inicio < m + PASO_AGENDA_MIN;
  });
}

// Mapa slot -> set de simuladores ocupados, expandiendo cada reserva a todos
// los bloques que ocupa.
export function construirOcupacion(
  dateKey: string,
  reservas: ReservaOcupacion[]
): Record<string, Set<string>> {
  const mapa: Record<string, Set<string>> = {};

  for (const r of reservas) {
    const sims = Array.isArray(r.simuladores) ? r.simuladores : [];
    const slots = r.modalidad === "v2_10"
      ? bloquesTocadosPorV2(dateKey, r.hora, r.duracion_minutos)
      : getOccupiedSlots(dateKey, r.hora, Number(r.duracion_minutos) || 15);

    for (const slot of slots) {
      if (!mapa[slot]) mapa[slot] = new Set<string>();
      for (const sim of sims) mapa[slot].add(String(sim));
    }
  }

  return mapa;
}

export type FilaSlotNueva = {
  reserva_id: number;
  fecha: string;
  hora: string;
  simulador: string;
  estado: "activa";
  ocupacion_min?: number;
};

/**
 * (B3) Las filas de reserva_slots de una reserva según SU modalidad guardada,
 * nunca la vigente:
 *   · legacy (NULL o 'legacy'): exactamente lo de siempre, un bloque de 20 por
 *     fila y por simulador, sin ocupacion_min;
 *   · v2_10: UNA fila por simulador en la hora de inicio, con ocupacion_min =
 *     duración + buffer. El buffer vive dentro de esa fila.
 */
export function filasSlotsReserva(r: {
  id: number | string;
  fecha: string;
  hora: string;
  duracion_minutos: unknown;
  simuladores: unknown;
  modalidad?: string | null;
}): FilaSlotNueva[] {
  const reserva_id = Number(r.id);
  const sims = Array.isArray(r.simuladores) ? r.simuladores.map((s) => String(s)) : [];
  if (r.modalidad === "v2_10") {
    const ocupacion = ocupacionMinutos("v2_10", r.duracion_minutos);
    if (ocupacion === null) throw new Error("Reserva v2 con una duración que no se puede ocupar");
    return sims.map((simulador) => ({
      reserva_id, fecha: r.fecha, hora: r.hora, simulador, estado: "activa", ocupacion_min: ocupacion,
    }));
  }
  const duracion = Number(r.duracion_minutos) || 15;
  return getOccupiedSlots(r.fecha, r.hora, duracion).flatMap((hora) =>
    sims.map((simulador) => ({ reserva_id, fecha: r.fecha, hora, simulador, estado: "activa" as const })),
  );
}
