// ============================================================================
// Minutos y turnos COMERCIALES por fila (Bloque B8). Módulo PURO: sin base,
// sin reloj; lo pueden importar el navegador y el servidor.
// ----------------------------------------------------------------------------
// Separa lo VENDIDO de la OCUPACIÓN:
//   · minutos comerciales: los que pagó el cliente y corre el temporizador
//     (Métricas, Métricas Equipo, IA, ticket, facturación por minuto);
//   · ocupación: agenda y capacidad (con buffer en v2). No vive acá.
//
// Cada fila se interpreta con SU modalidad persistida (NULL = legacy), nunca
// con la vigente ni por la fecha:
//   · legacy: EXACTAMENTE la fórmula histórica de cada vista, para que julio,
//     agosto y septiembre no cambien (filas incoherentes incluidas, sin
//     normalizar). Por ejemplo, en Reservas `cantidad_turnos` es la cantidad
//     de simuladores y Métricas Equipo/IA lo multiplican por 15: una reserva
//     de 30 minutos y un simulador cuenta 15. Se conserva tal cual.
//   · v2_10: lo realmente vendido. Minutos = duración × personas/simuladores;
//     turnos = bloques comerciales de 10 minutos por persona. Nunca el buffer.
//
// El Stand (turnos_stand) vive en lib/metricasStand.ts, que usa este módulo.
// ============================================================================

import { turnosComerciales, type Modalidad } from "@/lib/catalogoComercial";

/** La unidad histórica de un turno legacy (solo para filas legacy). */
export const MINUTOS_TURNO_LEGACY = 15;

/**
 * Las modalidades que puede tener una fila PERSISTIDA. Se reexportan desde acá —la puerta de
 * solo lectura de modalidad— para que quien únicamente interpreta lo guardado (métricas, IA)
 * no tenga que importar el núcleo comercial. Sigue siendo una sola lista: la de catalogoComercial.
 */
export { MODALIDADES } from "@/lib/catalogoComercial";
export type { Modalidad } from "@/lib/catalogoComercial";

/** Modalidad PERSISTIDA de una fila: 'v2_10' → v2_10; NULL, 'legacy' o cualquier otra cosa → legacy. */
export function modalidadDeFila(valor: unknown): Modalidad {
  return valor === "v2_10" ? "v2_10" : "legacy";
}

// ── Reservas (web, Mensualidades, Empresas) ─────────────────────────────────
// En todas las vías, `cantidad_turnos` persistido = cantidad de simuladores.

export type FilaReservaComercial = {
  cantidad_turnos?: unknown;
  duracion_minutos?: unknown;
  simuladores?: unknown;
  modalidad?: unknown;
};

export function simuladoresDeReserva(r: FilaReservaComercial): number {
  return Array.isArray(r.simuladores) ? r.simuladores.length : 0;
}

/**
 * Qué hace una vista legacy cuando una reserva no trae `cantidad_turnos`:
 *   · "calcular": personas × duración / 15 (Métricas Equipo y el ejecutor de la IA);
 *   · "cero": 0 (herramienta operativa, serie diaria y anomalías de la IA).
 * Hoy ninguna reserva viene sin ese dato; se conserva igual cada vista.
 */
export type FallbackTurnosLegacy = "calcular" | "cero";

/**
 * Turnos comerciales de una reserva.
 *   · legacy: los persistidos (cantidad de simuladores) o el fallback de la vista;
 *   · v2_10: bloques de 10 por simulador (20 minutos × 2 simuladores = 4).
 */
export function turnosComercialesReserva(r: FilaReservaComercial, fallback: FallbackTurnosLegacy): number {
  const sims = simuladoresDeReserva(r);
  if (modalidadDeFila(r.modalidad) === "v2_10") {
    return turnosComerciales("v2_10", Number(r.duracion_minutos), Math.max(1, sims)) ?? 0;
  }
  const persistidos = Number(r.cantidad_turnos) || 0;
  if (persistidos !== 0 || fallback === "cero") return persistidos; // mismo `||` de antes
  const durMin = Number(r.duracion_minutos) || MINUTOS_TURNO_LEGACY;
  return (Math.max(1, sims) * durMin) / MINUTOS_TURNO_LEGACY;
}

/**
 * Minutos comerciales de una reserva.
 *   · legacy: turnos × 15 (la fórmula histórica de Métricas Equipo e IA);
 *   · v2_10: duración × simuladores (20 minutos × 2 = 40). Sin buffer.
 */
export function minutosComercialesReserva(r: FilaReservaComercial, fallback: FallbackTurnosLegacy): number {
  if (modalidadDeFila(r.modalidad) === "v2_10") {
    const dur = Number(r.duracion_minutos) || 0;
    return dur > 0 ? dur * Math.max(1, simuladoresDeReserva(r)) : 0;
  }
  return turnosComercialesReserva(r, fallback) * MINUTOS_TURNO_LEGACY;
}

// ── Clasificación por duración (comparativos de Métricas) ───────────────────

export type ItemDuracion = { label: string; value: number };

/**
 * Etiqueta de duración de una venta.
 *   · legacy: la regla histórica de la página de Métricas (30 → "30 min";
 *     cualquier otra → "15 min"), para que los meses legacy den lo mismo;
 *   · v2_10: la duración real ("10 min", "20 min", "30 min"). Nunca 10/20 → 15.
 */
export function etiquetaDuracion(modalidad: Modalidad, minutos: unknown): string {
  const m = Number(minutos) || 0;
  if (modalidad === "v2_10" && m > 0) return `${m} min`;
  return m === 30 ? "30 min" : "15 min";
}

/**
 * Lista ordenada para los gráficos: "15 min" y "30 min" siempre (como antes,
 * aunque estén en 0); cualquier otra duración (10, 20, …) solo si aparece.
 */
export function itemsPorDuracion(conteos: Map<string, number>): ItemDuracion[] {
  const claves = new Set(["15 min", "30 min", ...[...conteos.keys()].filter((k) => (conteos.get(k) ?? 0) !== 0)]);
  return [...claves]
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((label) => ({ label, value: conteos.get(label) ?? 0 }));
}

/** "Reservas por duración": cantidad de reservas, con la etiqueta de su modalidad. */
export function comparativoReservasPorDuracion(reservas: readonly FilaReservaComercial[]): ItemDuracion[] {
  const conteos = new Map<string, number>();
  for (const r of reservas) {
    const etiqueta = etiquetaDuracion(modalidadDeFila(r.modalidad), r.duracion_minutos);
    conteos.set(etiqueta, (conteos.get(etiqueta) ?? 0) + 1);
  }
  return itemsPorDuracion(conteos);
}
