// IA SIM · Bloque 4E (hotfix) — Resolución DETERMINÍSTICA de expresiones temporales relativas
// ("este mes", "mes pasado", "el mismo mes del año pasado", "hoy", "ayer", "esta semana",
// "semana pasada", "este año", "año pasado") a fechas concretas, SIEMPRE en America/Argentina/
// Cordoba. Puro (sin DB, sin llamadas a Claude): el modelo nunca calcula estas fechas, las pide
// server-side con un token y el servidor resuelve.
//
// Motivo: el prompt de sistema es ESTÁTICO y ninguna herramienta aceptaba períodos relativos,
// así que ante "compará este mes con el mes pasado" el modelo no tenía forma de saber qué año/mes
// es "este mes" y terminaba pidiendo aclaración (o inventando un año). Ver comparar_periodos en
// lib/ia/analisis/herramientas.ts, que es quien consume resolverMesRelativo.

import { hoyCordoba } from "@/lib/ia/periodo";

export type VentanaDia = { desde: string; hasta: string }; // 'YYYY-MM-DD' inclusive, ambos límites

export type TokenPeriodoMes = "este_mes" | "mes_pasado" | "mismo_mes_anio_pasado";
export const TOKENS_PERIODO_MES: readonly TokenPeriodoMes[] = ["este_mes", "mes_pasado", "mismo_mes_anio_pasado"];

function partesDeHoy(ahora: Date): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = hoyCordoba(ahora).split("-").map(Number);
  return { anio, mes, dia };
}

// Mes anterior a (anio, mes), con acarreo de año (enero → diciembre del año anterior).
export function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

// "este_mes" | "mes_pasado" | "mismo_mes_anio_pasado" → {anio, mes} concretos, en Córdoba.
export function resolverMesRelativo(token: TokenPeriodoMes, ahora: Date = new Date()): { anio: number; mes: number } {
  const { anio, mes } = partesDeHoy(ahora);
  if (token === "este_mes") return { anio, mes };
  if (token === "mes_pasado") return mesAnterior(anio, mes);
  if (token === "mismo_mes_anio_pasado") return { anio: anio - 1, mes };
  throw new Error(`token de período relativo desconocido: ${token}`);
}

// ── Utilidades de día/semana/año — mismo criterio (Córdoba, reloj inyectable), listas para
// cuando exista una herramienta con granularidad diaria/semanal/anual. Hoy ninguna herramienta
// de IA SIM la tiene (todas son mensuales): se dejan probadas y disponibles, sin conectarlas a
// ningún flujo de chat todavía, para no ampliar el alcance de este hotfix.

export function ventanaHoy(ahora: Date = new Date()): VentanaDia {
  const hoy = hoyCordoba(ahora);
  return { desde: hoy, hasta: hoy };
}

export function ventanaAyer(ahora: Date = new Date()): VentanaDia {
  const { anio, mes, dia } = partesDeHoy(ahora);
  const ayer = new Date(Date.UTC(anio, mes - 1, dia - 1)).toISOString().slice(0, 10);
  return { desde: ayer, hasta: ayer };
}

// Lunes=1 ... domingo=7 (ISO), calculado sobre el día calendario de Córdoba (evita el corrimiento
// de zona horaria de Date.getDay(), que corre en la zona del proceso).
function diaIsoSemana(anio: number, mes: number, dia: number): number {
  const dow = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0=domingo..6=sábado
  return dow === 0 ? 7 : dow;
}

function sumarDiasCalendario(anio: number, mes: number, dia: number, delta: number): string {
  return new Date(Date.UTC(anio, mes - 1, dia + delta)).toISOString().slice(0, 10);
}

export function ventanaEstaSemana(ahora: Date = new Date()): VentanaDia {
  const { anio, mes, dia } = partesDeHoy(ahora);
  const iso = diaIsoSemana(anio, mes, dia);
  const lunes = sumarDiasCalendario(anio, mes, dia, -(iso - 1));
  return { desde: lunes, hasta: hoyCordoba(ahora) };
}

export function ventanaSemanaPasada(ahora: Date = new Date()): VentanaDia {
  const estaSemana = ventanaEstaSemana(ahora);
  const [anio, mes, dia] = estaSemana.desde.split("-").map(Number);
  const lunesPasado = sumarDiasCalendario(anio, mes, dia, -7);
  const domingoPasado = sumarDiasCalendario(anio, mes, dia, -1);
  return { desde: lunesPasado, hasta: domingoPasado };
}

export function ventanaEsteAnio(ahora: Date = new Date()): VentanaDia {
  const { anio } = partesDeHoy(ahora);
  return { desde: `${anio}-01-01`, hasta: hoyCordoba(ahora) };
}

export function ventanaAnioPasado(ahora: Date = new Date()): VentanaDia {
  const { anio } = partesDeHoy(ahora);
  return { desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` };
}
