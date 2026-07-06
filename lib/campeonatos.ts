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

// "Turno listo" de una inscripción (piloto ya se subió, bajó, hizo su tiempo y
// el turno quedó completado). Se persiste como prefijo en el campo observaciones
// de campeonato_inscripciones (no hay columna dedicada); convive con notas de
// texto y no afecta tiempo, ranking ni categoría.
export const INSCRIPCION_LISTO_MARK = "[LISTO]";
export function inscripcionEstaLista(observaciones: string | null | undefined): boolean {
  return typeof observaciones === "string" && observaciones.trimStart().startsWith(INSCRIPCION_LISTO_MARK);
}
export function marcarInscripcionLista(
  observaciones: string | null | undefined,
  listo: boolean
): string | null {
  const base = String(observaciones ?? "").replace(/^\s*\[LISTO\]\s?/, "").trim();
  if (listo) return base ? `${INSCRIPCION_LISTO_MARK} ${base}` : INSCRIPCION_LISTO_MARK;
  return base ? base : null;
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

// Escuderías F1 2026 (11 equipos). Lista ÚNICA compartida para inscripción
// pública, admin, turnero y filtros de campeonatos (evita listas duplicadas).
export const ESCUDERIAS_2026: string[] = [
  "Mercedes",
  "Ferrari",
  "McLaren",
  "Red Bull Racing",
  "Alpine",
  "Racing Bulls",
  "Haas F1 Team",
  "Williams",
  "Audi",
  "Aston Martin",
  "Cadillac",
];

// Mapea nombres viejos de escudería a los 2026 para no fragmentar el ranking de
// constructores si quedaran registros con nombres anteriores. Sin match → tal cual.
const ESCUDERIA_ALIAS: Record<string, string> = {
  "red bull": "Red Bull Racing",
  "kick sauber": "Audi",
  "alfa romeo": "Audi",
  "haas": "Haas F1 Team",
  "rb": "Racing Bulls",
  "alphatauri": "Racing Bulls",
  "racing bulls": "Racing Bulls",
};
export function normalizeEscuderia(s: string | null | undefined): string {
  const v = String(s ?? "").trim();
  if (!v) return "";
  return ESCUDERIA_ALIAS[v.toLowerCase()] ?? v;
}

// Reparte N pilotos clasificados (con tiempo de Fecha 0) en Oro/Plata/Bronce:
// base = floor(N/3); el resto va primero a Oro, luego a Plata.
// 9→3/3/3 · 10→4/3/3 · 11→4/4/3 · 12→4/4/4 · 13→5/4/4.
export function distribucionCategorias(n: number): { oro: number; plata: number; bronce: number } {
  if (n <= 0) return { oro: 0, plata: 0, bronce: 0 };
  const base = Math.floor(n / 3);
  const rem = n % 3;
  return {
    oro: base + (rem >= 1 ? 1 : 0),
    plata: base + (rem >= 2 ? 1 : 0),
    bronce: base,
  };
}
