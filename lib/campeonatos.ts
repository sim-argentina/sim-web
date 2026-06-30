// Helpers de campeonatos: conversión de tiempos de vuelta y penalizaciones.
// Funciones puras (sin secretos) → se pueden usar tanto en APIs como en UI.

// Penalización (en ms) que recibe en la fecha siguiente el 1°/2°/3° de la
// fecha que se cierra. 1°: +0.600s, 2°: +0.400s, 3°: +0.200s.
export const PENALIZACION_MS: Record<number, number> = { 1: 600, 2: 400, 3: 200 };

// Parsea un tiempo de vuelta a milisegundos. Acepta "M:SS.mmm", "MM:SS.mmm" o
// "SS.mmm" (sin minutos). Devuelve null si no es un tiempo válido (no rompe).
export function tiempoToMs(tiempo: string | null | undefined): number | null {
  if (tiempo == null) return null;
  const t = String(tiempo).trim();
  if (!t) return null;

  // Con minutos: "1:26.358"
  const conMin = t.match(/^(\d{1,3}):([0-5]?\d(?:\.\d{1,3})?)$/);
  if (conMin) {
    const min = parseInt(conMin[1], 10);
    const seg = parseFloat(conMin[2]);
    if (!Number.isFinite(min) || !Number.isFinite(seg)) return null;
    return Math.round((min * 60 + seg) * 1000);
  }

  // Solo segundos: "86.358"
  const soloSeg = t.match(/^(\d{1,4}(?:\.\d{1,3})?)$/);
  if (soloSeg) {
    const seg = parseFloat(soloSeg[1]);
    if (!Number.isFinite(seg)) return null;
    return Math.round(seg * 1000);
  }

  return null;
}

// Formatea ms a "M:SS.mmm". "" si el valor no es válido.
export function msToTiempo(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms);
  const min = Math.floor(total / 60000);
  const seg = Math.floor((total % 60000) / 1000);
  const milis = total % 1000;
  return `${min}:${String(seg).padStart(2, "0")}.${String(milis).padStart(3, "0")}`;
}

// Formatea una penalización en ms como "+0.600". "" si es 0/inválida.
export function formatPenalizacion(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const sign = ms >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

// Clave estable de piloto para penalizaciones/ranking.
// Preferir inscripcion_id (estable); si no, nombre normalizado (NFKC + lower +
// espacios colapsados). Prefijos para no confundir un id con un nombre.
export function pilotoKey(
  inscripcionId: string | null | undefined,
  nombreCompleto: string | null | undefined
): string {
  if (inscripcionId) return `insc:${inscripcionId}`;
  const n = String(nombreCompleto ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `nom:${n}`;
}
