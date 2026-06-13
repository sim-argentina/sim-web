// Fuente única de horarios, precios y ocupación de reservas.
// La usan tanto la página pública de reservas como las rutas de API
// (/api/reservas y /api/mercadopago/preference) para validar disponibilidad
// de turnos de 15 y 30 minutos sin duplicar lógica.

export const WEEKDAY_SLOTS = [
  "10:00", "10:20", "10:40", "11:00", "11:20", "11:40",
  "12:00", "12:20", "12:40", "13:00", "13:20", "13:40",
  "14:00", "14:20", "14:40", "15:00", "15:20", "15:40",
  "16:00", "16:20", "16:40", "17:00", "17:20", "17:40",
  "18:00", "18:20", "18:40", "19:00", "19:20", "19:40",
  "20:00", "20:20", "20:40", "21:00", "21:20", "21:40",
];

export const WEEKEND_SLOTS = [
  "10:00", "10:20", "10:40", "11:00", "11:20", "11:40",
  "12:00", "12:20", "12:40", "13:00", "13:20", "13:40", "14:00",
];

// Precios por simulador/persona
export const PRECIO_15 = 12000;
export const PRECIO_30_SEMANA = 18000;
export const PRECIO_30_FINDE = 20000;

export const DURACIONES_VALIDAS = [15, 30] as const;
export type Duracion = (typeof DURACIONES_VALIDAS)[number];

export function isWeekendDateKey(dateKey: string): boolean {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

export function getSlotsForDate(dateKey: string): string[] {
  if (!dateKey) return [];
  return isWeekendDateKey(dateKey) ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
}

// Devuelve el turno siguiente (20 min después) dentro del mismo día, o null si no existe.
export function getNextSlot(dateKey: string, hora: string): string | null {
  const slots = getSlotsForDate(dateKey);
  const idx = slots.indexOf(hora);
  if (idx === -1) return null;
  return slots[idx + 1] ?? null;
}

// Slots de 20 min que ocupa una reserva según su duración.
// 15 min → 1 slot; 30 min → 2 slots consecutivos.
export function getOccupiedSlots(
  dateKey: string,
  hora: string,
  duracion: number
): string[] {
  if (Number(duracion) >= 30) {
    const next = getNextSlot(dateKey, hora);
    return next ? [hora, next] : [hora];
  }
  return [hora];
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
};

// Construye un mapa slot -> set de simuladores ocupados, expandiendo
// las reservas de 30 min a sus dos slots consecutivos.
export function construirOcupacion(
  dateKey: string,
  reservas: ReservaOcupacion[]
): Record<string, Set<string>> {
  const mapa: Record<string, Set<string>> = {};

  for (const r of reservas) {
    const sims = Array.isArray(r.simuladores) ? r.simuladores : [];
    const duracion = Number(r.duracion_minutos) || 15;
    const slots = getOccupiedSlots(dateKey, r.hora, duracion);

    for (const slot of slots) {
      if (!mapa[slot]) mapa[slot] = new Set<string>();
      for (const sim of sims) mapa[slot].add(String(sim));
    }
  }

  return mapa;
}
