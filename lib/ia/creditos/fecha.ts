// IA SIM · Bloque 4B.5.1 — Helpers de fecha SIN corrimiento de zona horaria.
//  • Campos SQL `date` (YYYY-MM-DD) son fechas CALENDARIO: se parsean por componentes,
//    NUNCA con new Date("YYYY-MM-DD") (que interpreta UTC y corre el día en Argentina).
//  • Campos `timestamptz` se muestran en America/Argentina/Cordoba.

const TZ = "America/Argentina/Cordoba";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "2026-08-31" → "31/08/2026" (por componentes, sin Date).
export function formatearFechaCalendario(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return String(dateStr);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// "2026-09-01" → "1 sep 2026" (por componentes, sin Date).
export function formatearFechaLarga(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return String(dateStr);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

// timestamptz ISO → "DD/MM/YYYY HH:mm" en Córdoba.
export function formatearTimestampCordoba(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const fecha = d.toLocaleDateString("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fecha} ${hora}`;
}

// timestamptz ISO → "1 sep 2026" en Córdoba (fecha larga, sin hora).
export function formatearTimestampLargaCordoba(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  // en-CA con timeZone da "YYYY-MM-DD" ya en Córdoba → reusar el formateo por componentes.
  return formatearFechaLarga(d.toLocaleDateString("en-CA", { timeZone: TZ }));
}
