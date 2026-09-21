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
 * (M5C.1) Reglas operativas POR PRODUCTO. Un solo lugar, un solo objeto.
 *
 * El motor de agenda y disponibilidad es compartido —misma ocupación real,
 * mismos slots, mismos bloqueos— y lo que cambia por producto es el FILTRO que
 * se le aplica. Por eso esto no duplica nada: parametriza.
 *
 * Reservas normales conservan exactamente lo que tenían: todos los días
 * (semana y fin de semana), 15 y 30 minutos, de 1 a 4 simuladores.
 *
 * (M8C.1) Mensualidades ya no restringe días: opera los mismos siete, con el
 * mismo horario público. Lo único propio que le queda son sus duraciones —hasta
 * 60 minutos— y que su turno tiene que terminar dentro del horario del día, que
 * el fin de semana cierra a las 14:00.
 */
export type ReglasProducto = {
  /** Duraciones que ese producto puede pedir. */
  duraciones: readonly number[];
  /** Mínimo y máximo de simuladores por reserva. */
  simuladoresMin: number;
  simuladoresMax: number;
  /** Días de la semana habilitados (0 = domingo … 6 = sábado). */
  diasHabilitados: readonly number[];
  /**
   * Cómo se limita el FINAL del turno, por tipo de día.
   *
   * (M8C.1) Antes era un solo minuto de cierre por producto. No alcanzaba,
   * porque los dos tipos de día se limitan de maneras DISTINTAS:
   *
   *   · `cierre`: el turno tiene que terminar a esa hora o antes
   *     (`inicio + duración <= cierre`). Es lo que rige de lunes a viernes:
   *     el local cierra a las 22:00 y la experiencia tiene que caber.
   *
   *   · `ultimoInicio`: no hay hora de cierre que verificar. Lo único que se
   *     exige es que el INICIO esté en la grilla del día. El turno puede
   *     terminar después del último inicio, que es exactamente lo que pasa el
   *     fin de semana: se puede empezar a las 14:00 y manejar 60 minutos.
   *     Modelarlo como "cierre 15:00" sería inventar una hora que nadie fijó;
   *     lo que el negocio define es el último inicio, y eso ya lo dice la
   *     grilla.
   */
  limiteTurno: { semana: LimiteDelTurno; finDeSemana: LimiteDelTurno };
};

/** Ver `ReglasProducto.limiteTurno`. */
export type LimiteDelTurno =
  | { tipo: "cierre"; minuto: number }
  | { tipo: "ultimoInicio" };

const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6] as const;
/** 22:00 en minutos desde medianoche. */
const CIERRE_22: LimiteDelTurno = { tipo: "cierre", minuto: 22 * 60 };
/** El fin de semana no tiene cierre: tiene último inicio, y lo dice la grilla. */
const HASTA_EL_ULTIMO_INICIO: LimiteDelTurno = { tipo: "ultimoInicio" };

export const REGLAS_POR_PRODUCTO: Record<Producto, ReglasProducto> = {
  // Sin cambios respecto de lo que ya regía antes de M5C.1.
  //
  // (M8C.1) Reservas normales queda EXACTAMENTE como estaba: cierre a las 22:00
  // los siete días y bloques tomados de la grilla. En el fin de semana eso
  // significa que un turno de 30 no puede arrancar 14:00, porque necesitaría un
  // bloque a las 14:20 que la grilla no tiene. Es su comportamiento actual y
  // este bloque no toca Reservas.
  reserva: {
    duraciones: [15, 30],
    simuladoresMin: 1,
    simuladoresMax: 4,
    diasHabilitados: TODOS_LOS_DIAS,
    limiteTurno: { semana: CIERRE_22, finDeSemana: CIERRE_22 },
  },
  // (M8C) El mínimo de simuladores volvió a 1: el consumo es duración ×
  // cantidad, así que uno solo nunca cobró de menos.
  //
  // (M8C.1) Y el calendario vuelve a ser el del local: los SIETE días, con el
  // cierre que le corresponde a cada uno. M5C.1 había restringido Mensualidades
  // a lunes–viernes sin que nada del negocio lo pidiera. Quien compró horas
  // puede usarlas cuando el local abre, y el local abre también los fines de
  // semana.
  //
  // Los días y la grilla horaria salen de la misma fuente que Reservas. Lo
  // propio de Mensualidades son sus duraciones —hasta 60 minutos, contra 15/30
  // de Reservas— y cómo se limita el turno el fin de semana: ahí el último
  // inicio es 14:00 y el turno puede terminar después, porque con duraciones de
  // hasta una hora exigir que cierre a las 14:00 dejaría el sábado sin ninguna
  // reserva larga.
  mensualidad: {
    duraciones: [15, 30, 45, 60],
    simuladoresMin: 1,
    simuladoresMax: 4,
    diasHabilitados: TODOS_LOS_DIAS,
    limiteTurno: { semana: CIERRE_22, finDeSemana: HASTA_EL_ULTIMO_INICIO },
  },
};

/**
 * Duraciones aceptadas por producto. Reservas normales siguen siendo 15 y 30:
 * 45 y 60 son exclusivas de Mensualidades y no deben ofrecerse ni aceptarse en
 * el flujo público de Reservas.
 */
export const DURACIONES_POR_PRODUCTO: Record<Producto, readonly number[]> = {
  reserva: REGLAS_POR_PRODUCTO.reserva.duraciones,
  mensualidad: REGLAS_POR_PRODUCTO.mensualidad.duraciones,
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

// ── (M5C.1) La MISMA agenda, filtrada por producto ──────────────────────────
// Todo lo de arriba queda intacto: es lo que usan Reservas normales y su
// comportamiento no cambia ni un minuto. Lo de acá abajo aplica, encima, las
// restricciones propias del producto.

/** Día de la semana de una fecha (0 = domingo … 6 = sábado), sin zona horaria. */
function diaDeLaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ¿Ese producto opera ese día? Hoy los dos operan los siete. */
export function diaHabilitadoPara(producto: Producto, fecha: string): boolean {
  if (!fechaValida(fecha)) return false;
  return REGLAS_POR_PRODUCTO[producto].diasHabilitados.includes(diaDeLaSemana(fecha));
}

/** Cantidad de simuladores admitida por el producto. Hoy los dos: de 1 a 4. */
export function cantidadSimuladoresValidaPara(producto: Producto, n: unknown): boolean {
  if (typeof n === "string" && !/^\d+$/.test(n)) return false;
  const v = Number(n);
  const r = REGLAS_POR_PRODUCTO[producto];
  return Number.isInteger(v) && v >= r.simuladoresMin && v <= r.simuladoresMax;
}

/** Cómo se limita el turno de ESE producto en ESA fecha. */
export function limiteDeTurno(producto: Producto, fecha: string): LimiteDelTurno {
  const l = REGLAS_POR_PRODUCTO[producto].limiteTurno;
  return esFinDeSemana(fecha) ? l.finDeSemana : l.semana;
}

/**
 * ¿La EXPERIENCIA termina dentro del horario del día? Se mide sobre la duración
 * real pedida, no sobre los bloques de agenda: `inicio + duración <= cierre`.
 *
 * Cuando el día se limita por ÚLTIMO INICIO no hay nada que verificar acá: el
 * turno puede terminar después, y lo único que importa —que el inicio esté en
 * la grilla— lo comprueba `bloquesDeAgendaPara`.
 *
 * De lunes a viernes la grilla ya es más estricta que este filtro (un turno de
 * 60 no puede empezar después de las 20:40 porque no le entran los cuatro
 * bloques). Se conserva igual, explícito y probado, para que el cierre a las
 * 22:00 se cumpla por decisión y no por casualidad.
 */
export function terminaAntesDelCierre(
  producto: Producto, fecha: string, hora: string, duracion: unknown,
): boolean {
  if (!fechaValida(fecha)) return false;
  if (!/^\d{2}:\d{2}$/.test(hora)) return false;
  const d = Number(duracion);
  if (!Number.isInteger(d) || d <= 0) return false;
  const [h, m] = hora.split(":").map(Number);
  if (h > 23 || m > 59) return false;

  const limite = limiteDeTurno(producto, fecha);
  if (limite.tipo === "ultimoInicio") return true;
  return h * 60 + m + d <= limite.minuto;
}

/**
 * Bloques CORRIDOS desde una hora: inicio, +20, +40, … Es la posición real que
 * ocupa la experiencia, calculada por aritmética y no por la posición dentro de
 * la grilla del día.
 *
 * Se usa donde el turno puede terminar después del último inicio: el sábado a
 * las 14:00 una experiencia de 60 minutos ocupa 14:00, 14:20, 14:40 y 15:00,
 * aunque esos tres últimos no sean horarios en los que alguien pueda EMPEZAR.
 * Ocupar y poder empezar son dos cosas distintas.
 */
function bloquesCorridos(hora: string, duracion: unknown): string[] | null {
  const cantidad = bloquesPara(duracion);
  if (cantidad === null) return null;
  const inicio = aMinutos(hora);
  if (inicio === null) return null;
  const out: string[] = [];
  for (let i = 0; i < cantidad; i++) {
    const m = inicio + i * PASO_AGENDA_MIN;
    // Un turno no puede cruzar la medianoche: con la grilla actual es
    // imposible, pero si alguien la corriera esto no devuelve basura.
    if (m >= 24 * 60) return null;
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Bloques que ocupa una experiencia DE ESE PRODUCTO, o null si no corresponde.
 * Suma al chequeo de agenda (M6) el día habilitado y el cierre.
 */
export function bloquesDeAgendaPara(
  producto: Producto, fecha: string, hora: string, duracion: unknown,
): string[] | null {
  if (!duracionValidaPara(producto, duracion)) return null;
  if (!diaHabilitadoPara(producto, fecha)) return null;

  // El INICIO tiene que estar en la grilla del día, siempre y para los dos
  // modos. Es lo que rechaza un 14:20 un sábado: no existe como inicio.
  if (!horariosDe(fecha).includes(hora)) return null;

  if (limiteDeTurno(producto, fecha).tipo === "ultimoInicio") {
    // (M8C.1) Acá el turno puede terminar después del último inicio, así que
    // los bloques se calculan corridos en vez de leerse de la grilla. Si se
    // leyeran de la grilla, un sábado a las 14:00 solo entraría una duración de
    // 15 minutos, porque no hay posiciones siguientes que ocupar.
    return bloquesCorridos(hora, duracion);
  }

  if (!terminaAntesDelCierre(producto, fecha, hora, duracion)) return null;
  return bloquesDeAgenda(fecha, hora, duracion);
}

/** Horarios de inicio que ese producto puede ofrecer ese día. */
export function horariosPosiblesPara(
  producto: Producto, fecha: string, duracion: unknown,
): string[] {
  if (!diaHabilitadoPara(producto, fecha)) return [];
  return horariosDe(fecha).filter(
    (h) => bloquesDeAgendaPara(producto, fecha, h, duracion) !== null,
  );
}

/** Las fechas de la ventana pública en las que ESE producto opera. */
export function fechasPublicasPara(producto: Producto, hoy: string = hoyEnSim()): string[] {
  return fechasPublicas(hoy).filter((f) => diaHabilitadoPara(producto, f));
}
