// ============================================================================
// FUENTE ÚNICA de la agenda pública de SIM (Bloque M6).
// ----------------------------------------------------------------------------
// Módulo PURO: sin supabaseAdmin, sin secretos, sin red. Lo importan por igual
// el navegador y el servidor, así que la política de días, horarios, duraciones
// y bloques deja de estar duplicada entre `app/reservas/page.tsx` y el backend.
// La AUTORIDAD final sigue siendo el servidor: acá solo vive la política.
//
// LA AGENDA
// Los inicios están separados por 20 minutos (PASO_AGENDA_MIN). Ese paso NO es
// la duración de la experiencia: es la grilla operativa. Una experiencia de 15
// minutos ocupa 1 posición de agenda, una de 30 ocupa 2, y así. Los bloques
// extra representan el margen operativo (subir, ajustar butaca, bajar), no que
// el cliente maneje 20, 40, 60 u 80 minutos.
//
// LA VENTANA PÚBLICA
// Es exactamente la que ve hoy un cliente en /reservas: NO se puede reservar
// para hoy, la primera fecha es MAÑANA y la última es HOY + 15 (15 fechas en
// total). Antes esa política vivía solo en el front (MAX_BOOKING_DAYS = 15,
// bucle desde i = 1) mientras el servidor aceptaba hasta 120 días.
// ============================================================================

export const ZONA_SIM = "America/Argentina/Cordoba";

/** Separación entre inicios de agenda, en minutos. */
export const PASO_AGENDA_MIN = 20;

// Horarios habilitados. Son los mismos que ya usaba el sitio: esta es la única
// definición que queda en todo el proyecto.
export const WEEKDAY_SLOTS = [
  "10:00", "10:20", "10:40", "11:00", "11:20", "11:40",
  "12:00", "12:20", "12:40", "13:00", "13:20", "13:40",
  "14:00", "14:20", "14:40", "15:00", "15:20", "15:40",
  "16:00", "16:20", "16:40", "17:00", "17:20", "17:40",
  "18:00", "18:20", "18:40", "19:00", "19:20", "19:40",
  "20:00", "20:20", "20:40", "21:00", "21:20", "21:40",
] as const;

export const WEEKEND_SLOTS = [
  "10:00", "10:20", "10:40", "11:00", "11:20", "11:40",
  "12:00", "12:20", "12:40", "13:00", "13:20", "13:40", "14:00",
] as const;

// ── Ventana pública ─────────────────────────────────────────────────────────

/** Primera fecha reservable: mañana (nunca hoy). */
export const DIAS_MINIMO_ANTICIPACION = 1;
/** Última fecha reservable: hoy + 15. */
export const DIAS_MAXIMO_ANTICIPACION = 15;

// ── Productos y duraciones ──────────────────────────────────────────────────

export type Producto = "reserva" | "mensualidad";

/**
 * Duraciones aceptadas por producto. Reservas normales siguen siendo 15 y 30:
 * 45 y 60 son exclusivas de Mensualidades y no deben ofrecerse ni aceptarse en
 * el flujo público de Reservas.
 */
export const DURACIONES_POR_PRODUCTO: Record<Producto, readonly number[]> = {
  reserva: [15, 30],
  mensualidad: [15, 30, 45, 60],
};

/** Todas las duraciones que el sistema sabe mapear a bloques. */
export const DURACIONES_CONOCIDAS = [15, 30, 45, 60] as const;
export type DuracionConocida = (typeof DURACIONES_CONOCIDAS)[number];

export const SIMULADORES_MIN = 1;
export const SIMULADORES_MAX = 4;

/**
 * Única conversión de duración a posiciones de agenda de todo el proyecto:
 * 15 → 1 · 30 → 2 · 45 → 3 · 60 → 4.
 * Rechaza 0, negativos, fraccionarios, strings raros y cualquier valor fuera de
 * la lista. Devuelve null en vez de adivinar.
 */
export function bloquesPara(duracion: unknown): number | null {
  // Estricto a propósito: " 30 ", "0x1E" o "30abc" son entradas manipuladas.
  if (typeof duracion === "string" && !/^\d+$/.test(duracion)) return null;
  const d = Number(duracion);
  if (!Number.isInteger(d)) return null;
  if (!(DURACIONES_CONOCIDAS as readonly number[]).includes(d)) return null;
  return d / 15;
}

/** ¿Ese producto puede usar esa duración? */
export function duracionValidaPara(producto: Producto, duracion: unknown): boolean {
  if (bloquesPara(duracion) === null) return false;
  return DURACIONES_POR_PRODUCTO[producto].includes(Number(duracion));
}

export function cantidadSimuladoresValida(n: unknown): boolean {
  if (typeof n === "string" && !/^\d+$/.test(n)) return false;
  const v = Number(n);
  return Number.isInteger(v) && v >= SIMULADORES_MIN && v <= SIMULADORES_MAX;
}

// ── Fechas (siempre en la zona de SIM, nunca la del servidor) ───────────────

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "Hoy" en Córdoba como YYYY-MM-DD. Igual en el navegador y en el servidor. */
export function hoyEnSim(ahora: Date = new Date()): string {
  // en-CA da directamente YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_SIM, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ahora);
}

/**
 * Suma días a un YYYY-MM-DD sin pasar por la zona horaria local. Nunca se usa
 * `new Date("YYYY-MM-DD")` a secas, que se interpreta como UTC y puede correr
 * el día.
 */
export function sumarDias(fecha: string, dias: number): string {
  if (!FECHA_RE.test(fecha)) return fecha;
  const [y, m, d] = fecha.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + dias * 86_400_000;
  const r = new Date(t);
  const mm = String(r.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(r.getUTCDate()).padStart(2, "0");
  return `${r.getUTCFullYear()}-${mm}-${dd}`;
}

/** Diferencia en días entre dos YYYY-MM-DD (b − a), sin zona horaria. */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function fechaValida(fecha: unknown): fecha is string {
  if (typeof fecha !== "string" || !FECHA_RE.test(fecha)) return false;
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  // Rechaza cosas como 2026-02-31, que Date "corrige" en silencio.
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** ¿La fecha está dentro de mañana … hoy + 15? */
export function fechaDentroDeVentana(fecha: string, hoy: string = hoyEnSim()): boolean {
  if (!fechaValida(fecha)) return false;
  const dif = diasEntre(hoy, fecha);
  return dif >= DIAS_MINIMO_ANTICIPACION && dif <= DIAS_MAXIMO_ANTICIPACION;
}

/** Las 15 fechas reservables, de mañana a hoy + 15. */
export function fechasPublicas(hoy: string = hoyEnSim()): string[] {
  const out: string[] = [];
  for (let i = DIAS_MINIMO_ANTICIPACION; i <= DIAS_MAXIMO_ANTICIPACION; i++) {
    out.push(sumarDias(hoy, i));
  }
  return out;
}

/** Fin de semana según la fecha calendario, sin depender de la zona del server. */
export function esFinDeSemana(fecha: string): boolean {
  if (!fechaValida(fecha)) return false;
  const [y, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Horarios habilitados de esa fecha. */
export function horariosDe(fecha: string): string[] {
  if (!fechaValida(fecha)) return [];
  return [...(esFinDeSemana(fecha) ? WEEKEND_SLOTS : WEEKDAY_SLOTS)];
}

// ── Bloques de agenda ───────────────────────────────────────────────────────

function aMinutos(hhmm: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Posiciones de agenda que ocupa una experiencia. Devuelve null si:
 *  · la fecha, la hora o la duración no son válidas;
 *  · la hora no pertenece al calendario de ese día;
 *  · no entran todos los bloques antes del cierre;
 *  · hay una DISCONTINUIDAD horaria entre bloques.
 *
 * Lo último es clave: no alcanza con que existan posiciones siguientes en el
 * array. Si el calendario tuviera un corte (cierre del mediodía, franja no
 * habilitada), esas posiciones no son contiguas en el tiempo y la experiencia
 * larga no se puede dar. Por eso se compara la diferencia real en minutos.
 */
export function bloquesDeAgenda(
  fecha: string, hora: string, duracion: unknown,
): string[] | null {
  const cantidad = bloquesPara(duracion);
  if (cantidad === null) return null;

  const horarios = horariosDe(fecha);
  const inicio = horarios.indexOf(hora);
  if (inicio < 0) return null;
  if (inicio + cantidad > horarios.length) return null;

  const bloques = horarios.slice(inicio, inicio + cantidad);
  for (let i = 1; i < bloques.length; i++) {
    const a = aMinutos(bloques[i - 1]);
    const b = aMinutos(bloques[i]);
    if (a === null || b === null || b - a !== PASO_AGENDA_MIN) return null;
  }
  return bloques;
}

/** Horarios de inicio en los que la duración entra completa (sin mirar ocupación). */
export function horariosPosibles(fecha: string, duracion: unknown): string[] {
  return horariosDe(fecha).filter((h) => bloquesDeAgenda(fecha, h, duracion) !== null);
}
