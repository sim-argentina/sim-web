// Resolución PURA de rangos de fecha para la Analítica Web (timezone Argentina).
// Devuelve el rango actual + el período anterior EQUIVALENTE (misma longitud, justo
// antes), para comparaciones vs período anterior. Sin dependencias.

export type RangeKey = "today" | "7d" | "30d" | "this_month" | "prev_month" | "custom";
export type DateRange = { start: string; end: string }; // YYYY-MM-DD inclusive

const TZ = "America/Argentina/Buenos_Aires";
export const RANGE_KEYS: readonly RangeKey[] = ["today", "7d", "30d", "this_month", "prev_month", "custom"];

export function esRangeKey(v: unknown): v is RangeKey {
  return typeof v === "string" && (RANGE_KEYS as readonly string[]).includes(v);
}
export function validDate(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// "Hoy" en Argentina (YYYY-MM-DD), independiente del timezone del servidor.
export function hoyAR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function firstOfMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${y}-${m}-01`;
}
function daysInclusive(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000) + 1;
}

export function resolveRange(
  key: RangeKey,
  custom?: { start?: string | null; end?: string | null },
  now: Date = new Date(),
): { current: DateRange; previous: DateRange } {
  const today = hoyAR(now);
  let current: DateRange;
  switch (key) {
    case "today":
      current = { start: today, end: today };
      break;
    case "7d":
      current = { start: addDays(today, -6), end: today };
      break;
    case "30d":
      current = { start: addDays(today, -29), end: today };
      break;
    case "this_month":
      current = { start: firstOfMonth(today), end: today };
      break;
    case "prev_month": {
      const lastPrev = addDays(firstOfMonth(today), -1);
      current = { start: firstOfMonth(lastPrev), end: lastPrev };
      break;
    }
    case "custom": {
      const s = validDate(custom?.start) ? custom!.start! : addDays(today, -6);
      const e = validDate(custom?.end) ? custom!.end! : today;
      current = s <= e ? { start: s, end: e } : { start: e, end: s };
      break;
    }
    default:
      current = { start: addDays(today, -6), end: today };
  }
  // Período anterior equivalente: misma cantidad de días, inmediatamente antes.
  const len = daysInclusive(current.start, current.end);
  const prevEnd = addDays(current.start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));
  return { current, previous: { start: prevStart, end: prevEnd } };
}
