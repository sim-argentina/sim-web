// ============================================================================
// Agenda por INTERVALOS (Bloque B2). Módulo PURO: sin base, sin reloj, sin red.
// ----------------------------------------------------------------------------
// Separa lo que se VENDE de lo que se OCUPA:
//   · duración comercial: lo que maneja el cliente;
//   · ocupación: lo que el simulador queda tomado, buffer incluido.
// Las dos salen de lib/catalogoComercial.ts según la modalidad, que SIEMPRE
// llega explícita. Este módulo nunca decide la modalidad ni mira el reloj: eso
// es de lib/modalidadComercial.ts y se conecta en los bloques siguientes.
//
// Todos los intervalos son SEMIABIERTOS, en minutos desde medianoche:
// [desde, hasta). 12:00–12:30 y 12:30–13:00 no se tocan; 12:20–12:50 sí.
//
// LA GRILLA
//   · legacy: la agenda de HOY, sin reinterpretar nada. Qué inicios valen y
//     hasta dónde llega el turno lo decide lib/agenda.ts (bloquesDeAgendaPara),
//     la misma función que usa el motor actual.
//   · v2_10: el paso del catálogo desde la apertura del día. De lunes a viernes
//     el TIEMPO COMERCIAL termina como máximo al cierre (22:00) y el buffer
//     puede seguir; sábado y domingo el último INICIO es el de la grilla del
//     día (14:00) para cualquier duración. Ocupar no es poder empezar.
//   Las horas (apertura, cierre, último inicio de fin de semana) salen de
//   lib/agenda.ts, que sigue siendo la única definición del horario del local.
// ============================================================================

import {
  duracionPermitida, ocupacionMinutos, pasoAgendaMin,
  type Modalidad, type ProductoComercial,
} from "@/lib/catalogoComercial";
import {
  REGLAS_POR_PRODUCTO, bloquesDeAgenda, bloquesDeAgendaPara, esFinDeSemana,
  fechaValida, horariosDe, terminaAntesDelCierre, type LimiteDelTurno,
} from "@/lib/agenda";

/** Unidad de conversión, no una duración. */
const MINUTOS_POR_HORA = 60;
export const MINUTOS_DIA = 24 * MINUTOS_POR_HORA;

/** Intervalo semiabierto [desde, hasta), en minutos desde medianoche. */
export type Intervalo = { readonly desde: number; readonly hasta: number };

// ── Horas ───────────────────────────────────────────────────────────────────

const HORA_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/**
 * "HH:MM" estricto a minutos desde medianoche. "9:00", "24:00" o "12:5"
 * devuelven null: es el mismo criterio que reserva_hhmm_a_minutos (B1).
 */
export function minutosDeHora(hora: unknown): number | null {
  if (typeof hora !== "string") return null;
  const m = HORA_RE.exec(hora);
  if (!m) return null;
  return Number(m[1]) * MINUTOS_POR_HORA + Number(m[2]);
}

/** Minutos a "HH:MM". Un fin de ocupación después de medianoche sale "24:10". */
export function horaDeMinutos(minutos: number): string {
  const h = Math.floor(minutos / MINUTOS_POR_HORA);
  const m = minutos % MINUTOS_POR_HORA;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── Solapamiento ────────────────────────────────────────────────────────────

/**
 * ¿Dos intervalos semiabiertos comparten al menos un minuto? El fin de uno
 * igual al inicio del otro NO es solapamiento. Un intervalo vacío no pisa nada.
 * Es la misma regla que aplica el trigger de B1 para las filas v2.
 */
export function seSuperponen(a: Intervalo, b: Intervalo): boolean {
  if (a.desde >= a.hasta || b.desde >= b.hasta) return false;
  return a.desde < b.hasta && b.desde < a.hasta;
}

// ── Turnos ──────────────────────────────────────────────────────────────────

/** Productos que piden agenda. Empresa usa la duración de su campaña. */
export const PRODUCTOS_AGENDA = ["reserva", "mensualidad", "gift_card", "empresa"] as const;
export type ProductoAgenda = ProductoComercial | "empresa";

export function esProductoAgenda(valor: unknown): valor is ProductoAgenda {
  return typeof valor === "string" && (PRODUCTOS_AGENDA as readonly string[]).includes(valor);
}

/** Un turno ubicado en el día: dónde empieza, dónde termina lo vendido y lo ocupado. */
export type TurnoIntervalo = {
  modalidad: Modalidad;
  /** Inicio "HH:MM". */
  hora: string;
  inicio: number;
  /** Duración comercial. */
  duracion: number;
  finComercial: number;
  /** Minutos de ocupación, buffer incluido. */
  ocupacion: number;
  finOcupacion: number;
  buffer: number;
  /** [inicio, finOcupacion). */
  intervalo: Intervalo;
};

/**
 * La ocupación que produce un turno de esa modalidad, SIN mirar la grilla. Es
 * la que se usa para reservas que ya existen: su intervalo depende de SU
 * modalidad persistida, no de la que rija hoy. null si la hora no es "HH:MM" o
 * la modalidad no sabe ocupar esa duración.
 */
export function turnoOcupacion(
  modalidad: Modalidad, hora: unknown, duracion: unknown,
): TurnoIntervalo | null {
  const inicio = minutosDeHora(hora);
  const ocupacion = ocupacionMinutos(modalidad, duracion);
  if (inicio === null || ocupacion === null) return null;
  const d = Number(duracion);
  const finOcupacion = inicio + ocupacion;
  return {
    modalidad,
    hora: horaDeMinutos(inicio),
    inicio,
    duracion: d,
    finComercial: inicio + d,
    ocupacion,
    finOcupacion,
    buffer: ocupacion - d,
    intervalo: { desde: inicio, hasta: finOcupacion },
  };
}

/**
 * Inicios de los bloques de la grilla legacy que cubre un turno legacy: 13:40
 * de 60 → 13:40, 14:00, 14:20, 14:40. Es lo que miran los bloqueos legacy
 * (lib/bloqueos.ts) y la rama legacy del trigger, fila por fila.
 */
export function bloquesLegacy(turno: TurnoIntervalo): string[] {
  const paso = pasoAgendaMin("legacy");
  const out: string[] = [];
  for (let m = turno.inicio; m < turno.finOcupacion; m += paso) out.push(horaDeMinutos(m));
  return out;
}

// ── Reglas del día ──────────────────────────────────────────────────────────

/** Límite de un día v2: hasta dónde llega el tiempo comercial o el último inicio. */
export type LimiteV2 =
  | { tipo: "cierre"; minuto: number }
  | { tipo: "ultimoInicio"; minuto: number };

export type ReglasDiaV2 = {
  apertura: number;
  paso: number;
  limite: LimiteV2;
};

/**
 * (B2, decisión aprobada) De lunes a viernes rige el mismo cierre que la agenda
 * actual (22:00), aplicado al tiempo COMERCIAL. Sábado y domingo rige el último
 * inicio de la grilla del día, para cualquier duración.
 */
const LIMITES_V2: { semana: LimiteDelTurno; finDeSemana: LimiteDelTurno } = {
  semana: REGLAS_POR_PRODUCTO.reserva.limiteTurno.semana,
  finDeSemana: { tipo: "ultimoInicio" },
};

/** Reglas v2 de una fecha, o null si la fecha no es válida. */
export function reglasDiaV2(fecha: string): ReglasDiaV2 | null {
  if (!fechaValida(fecha)) return null;
  const horarios = horariosDe(fecha);
  const apertura = minutosDeHora(horarios[0]);
  const ultimo = minutosDeHora(horarios[horarios.length - 1]);
  if (apertura === null || ultimo === null) return null;
  const l = esFinDeSemana(fecha) ? LIMITES_V2.finDeSemana : LIMITES_V2.semana;
  return {
    apertura,
    paso: pasoAgendaMin("v2_10"),
    limite: l.tipo === "cierre"
      ? { tipo: "cierre", minuto: l.minuto }
      : { tipo: "ultimoInicio", minuto: ultimo },
  };
}

/** ¿El producto puede pedir esa duración en esa modalidad? */
export function duracionValida(modalidad: Modalidad, producto: ProductoAgenda, duracion: unknown): boolean {
  // Empresa no tiene lista propia: vale la duración de la campaña, siempre que
  // la modalidad sepa cuánto ocupa (una campaña legacy de 15 en v2 ocupa 25).
  if (producto === "empresa") return ocupacionMinutos(modalidad, duracion) !== null;
  return duracionPermitida(modalidad, producto, duracion);
}

function turnoLegacy(
  producto: ProductoAgenda, fecha: string, hora: string, duracion: unknown,
): TurnoIntervalo | null {
  if (!duracionValida("legacy", producto, duracion)) return null;
  let bloques: string[] | null;
  if (producto === "empresa") {
    // La grilla y el cierre de Reservas, con la duración de la campaña.
    bloques = terminaAntesDelCierre("reserva", fecha, hora, duracion)
      ? bloquesDeAgenda(fecha, hora, duracion)
      : null;
  } else {
    // El canje de una Gift Card es una reserva normal.
    bloques = bloquesDeAgendaPara(producto === "mensualidad" ? "mensualidad" : "reserva", fecha, hora, duracion);
  }
  if (!bloques) return null;
  const turno = turnoOcupacion("legacy", hora, duracion);
  // La ocupación del catálogo es exactamente la de los bloques de la agenda.
  if (!turno || turno.ocupacion !== bloques.length * pasoAgendaMin("legacy")) return null;
  return turno;
}

function turnoV2(
  producto: ProductoAgenda, fecha: string, hora: string, duracion: unknown,
): TurnoIntervalo | null {
  const reglas = reglasDiaV2(fecha);
  if (!reglas || !duracionValida("v2_10", producto, duracion)) return null;
  const turno = turnoOcupacion("v2_10", hora, duracion);
  if (!turno) return null;
  if (turno.inicio < reglas.apertura || (turno.inicio - reglas.apertura) % reglas.paso !== 0) return null;
  const { limite } = reglas;
  if (limite.tipo === "cierre" ? turno.finComercial > limite.minuto : turno.inicio > limite.minuto) return null;
  return turno;
}

/**
 * ¿Se puede EMPEZAR un turno así? Devuelve el turno con sus intervalos, o null
 * si la fecha, la hora o la duración no valen para ese producto y esa modalidad.
 * No mira la ocupación: eso es de lib/disponibilidadIntervalos.ts.
 */
export function turnoPara(args: {
  modalidad: Modalidad;
  producto: ProductoAgenda;
  fecha: string;
  hora: unknown;
  duracion: unknown;
}): TurnoIntervalo | null {
  const { modalidad, producto, fecha, hora, duracion } = args;
  if (typeof hora !== "string" || !esProductoAgenda(producto) || !fechaValida(fecha)) return null;
  if (modalidad === "legacy") return turnoLegacy(producto, fecha, hora, duracion);
  if (modalidad === "v2_10") return turnoV2(producto, fecha, hora, duracion);
  return null;
}

/** Todos los inicios válidos del día, en orden, con sus intervalos. */
export function iniciosDelDia(args: {
  modalidad: Modalidad;
  producto: ProductoAgenda;
  fecha: string;
  duracion: unknown;
}): TurnoIntervalo[] {
  const { modalidad, producto, fecha, duracion } = args;
  const base = { modalidad, producto, fecha, duracion };
  if (modalidad === "legacy") {
    return horariosDe(fecha)
      .map((hora) => turnoPara({ ...base, hora }))
      .filter((t): t is TurnoIntervalo => t !== null);
  }
  const reglas = reglasDiaV2(fecha);
  if (!reglas) return [];
  const out: TurnoIntervalo[] = [];
  const tope = reglas.limite.minuto;
  for (let m = reglas.apertura; m <= tope; m += reglas.paso) {
    const turno = turnoPara({ ...base, hora: horaDeMinutos(m) });
    if (turno) out.push(turno);
  }
  return out;
}
