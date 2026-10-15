// ============================================================================
// Calendario de una reserva confirmada (experiencia post-pago, EXPERIMENTAL).
// ----------------------------------------------------------------------------
// Enlace estándar de Google Calendar (sin OAuth: el cliente lo guarda él mismo)
// y archivo .ics según RFC 5545, con un recordatorio 24 horas antes.
//
// PURO: no lee la base ni el entorno. Recibe los datos ACTUALES de la reserva,
// así que después de una reprogramación el próximo enlace o la próxima
// descarga ya traen la fecha y la hora nuevas. El UID es estable por reserva y
// SEQUENCE es la cantidad de reprogramaciones: un calendario que reimporta el
// archivo lo reconoce como una versión nueva del MISMO evento.
//
// No lleva datos internos: ni ids de la base ni de Mercado Pago, ni montos.
// ============================================================================

import { ZONA_SIM } from "@/lib/agenda";
import { SITE_URL } from "@/lib/seo";

export const TITULO_EVENTO = "Reserva SIM 🏁";
export const UBICACION_EVENTO = "Nuevo Centro Shopping, Córdoba";
export const AVISO_24H = "Mañana tenés tu reserva en SIM 🏁";

export type EventoReserva = {
  /** AAAA-MM-DD, fecha local de Córdoba. */
  fecha: string;
  /** HH:MM, hora local de Córdoba. */
  hora: string;
  /** Duración comercial contratada (sin el buffer de la agenda). */
  duracionMin: number;
  simuladores: number;
  /** Código visible de la reserva (nunca el id de la base). */
  codigo: string;
  /** Identificador estable del evento (derivado en el servidor). */
  uid: string;
  /** Versión del evento: cantidad de reprogramaciones. */
  secuencia: number;
};

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA_RE = /^(\d{2}):(\d{2})(?::\d{2})?$/;
const dos = (n: number) => String(n).padStart(2, "0");

function partes(fecha: string, hora: string): [number, number, number, number, number] {
  const f = FECHA_RE.exec(fecha);
  const h = HORA_RE.exec(hora);
  if (!f || !h) throw new Error(`fecha u hora inválida: ${fecha} ${hora}`);
  return [Number(f[1]), Number(f[2]), Number(f[3]), Number(h[1]), Number(h[2])];
}

/**
 * Suma minutos a una fecha y hora "de pared" (sin zona). Se calcula sobre UTC
 * solo como aritmética: el resultado se lee de nuevo como hora local, así que
 * cruza la medianoche bien y no depende de la zona del proceso.
 */
export function sumarMinutos(fecha: string, hora: string, minutos: number): { fecha: string; hora: string } {
  const [y, mo, d, h, mi] = partes(fecha, hora);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi) + minutos * 60_000);
  return {
    fecha: `${t.getUTCFullYear()}-${dos(t.getUTCMonth() + 1)}-${dos(t.getUTCDate())}`,
    hora: `${dos(t.getUTCHours())}:${dos(t.getUTCMinutes())}`,
  };
}

/** AAAAMMDDTHHMMSS (hora local, el formato que usan Google y DTSTART;TZID). */
function compacto(fecha: string, hora: string): string {
  const [y, mo, d, h, mi] = partes(fecha, hora);
  return `${y}${dos(mo)}${dos(d)}T${dos(h)}${dos(mi)}00`;
}

/** AAAAMMDDTHHMMSSZ en UTC (DTSTAMP). */
function utc(instante: Date): string {
  return instante.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function validar(e: EventoReserva): void {
  partes(e.fecha, e.hora);
  if (!Number.isInteger(e.duracionMin) || e.duracionMin <= 0 || e.duracionMin > 720) {
    throw new Error(`duración inválida: ${e.duracionMin}`);
  }
}

/** Texto útil y breve para la descripción del evento. */
export function descripcionEvento(e: EventoReserva): string {
  const sims = e.simuladores === 1 ? "1 simulador" : `${e.simuladores} simuladores`;
  return [
    `Reserva SIM: ${e.duracionMin} minutos · ${sims}`,
    `Código de reserva: ${e.codigo}`,
    UBICACION_EVENTO,
    "Llegá unos minutos antes de tu turno.",
    SITE_URL,
  ].join("\n");
}

/**
 * Enlace estándar de creación de evento de Google Calendar. Con `ctz` las
 * fechas van sin "Z": Google las lee como hora de Córdoba.
 */
export function enlaceGoogleCalendar(e: EventoReserva): string {
  validar(e);
  const fin = sumarMinutos(e.fecha, e.hora, e.duracionMin);
  const dates = `${compacto(e.fecha, e.hora)}/${compacto(fin.fecha, fin.hora)}`;
  const params: Array<[string, string]> = [
    ["action", "TEMPLATE"],
    ["text", TITULO_EVENTO],
    ["dates", dates],
    ["ctz", ZONA_SIM],
    ["location", UBICACION_EVENTO],
    ["details", descripcionEvento(e)],
  ];
  // `dates` solo tiene dígitos, "T" y "/": va tal cual (Google espera la barra).
  const query = params.map(([k, v]) => `${k}=${k === "dates" ? v : encodeURIComponent(v)}`).join("&");
  return `https://calendar.google.com/calendar/render?${query}`;
}

/** Escapa un valor TEXT de iCalendar (RFC 5545 §3.3.11). */
export function escaparTexto(valor: string): string {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const codificador = new TextEncoder();

/**
 * Pliega una línea a 75 octetos (RFC 5545 §3.1): CRLF + un espacio. Cuenta
 * bytes UTF-8 y corta entre caracteres, nunca dentro de uno (el 🏁 ocupa 4).
 */
export function plegar(linea: string): string {
  if (codificador.encode(linea).length <= 75) return linea;
  const trozos: string[] = [];
  let actual = "";
  let bytes = 0;
  let limite = 75;
  for (const caracter of linea) {
    const b = codificador.encode(caracter).length;
    if (bytes + b > limite) {
      trozos.push(actual);
      actual = "";
      bytes = 0;
      limite = 74; // la continuación empieza con un espacio
    }
    actual += caracter;
    bytes += b;
  }
  trozos.push(actual);
  return trozos.join("\r\n ");
}

/**
 * Archivo .ics de la reserva: VTIMEZONE de Córdoba (UTC−3, sin horario de
 * verano), un VEVENT con el horario real y un VALARM 24 horas antes.
 */
export function archivoIcs(e: EventoReserva, ahora: Date = new Date()): string {
  validar(e);
  const fin = sumarMinutos(e.fecha, e.hora, e.duracionMin);
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SIM Argentina//Reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${ZONA_SIM}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0300",
    "TZOFFSETTO:-0300",
    "TZNAME:-03",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${utc(ahora)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(e.secuencia) || 0)}`,
    `DTSTART;TZID=${ZONA_SIM}:${compacto(e.fecha, e.hora)}`,
    `DTEND;TZID=${ZONA_SIM}:${compacto(fin.fecha, fin.hora)}`,
    `SUMMARY:${escaparTexto(TITULO_EVENTO)}`,
    `LOCATION:${escaparTexto(UBICACION_EVENTO)}`,
    `DESCRIPTION:${escaparTexto(descripcionEvento(e))}`,
    `URL:${SITE_URL}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escaparTexto(AVISO_24H)}`,
    "TRIGGER:-PT24H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lineas.map(plegar).join("\r\n") + "\r\n";
}

/** "martes 20 de octubre de 2026" (sin depender de la zona del proceso). */
export function fechaLarga(fecha: string): string {
  const [y, mo, d] = partes(fecha, "12:00");
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(y, mo - 1, d, 12))).replace(",", "");
}
