// ============================================================================
// Agenda de Mensualidades sobre el motor por intervalos (Bloque B6). SOLO
// SERVIDOR.
// ----------------------------------------------------------------------------
// Mensualidades deja lib/disponibilidad.ts y usa el motor de B2, en la
// modalidad que corresponde:
//   · para RESERVAR, la del PLAN (mensualidades.modalidad, NULL = legacy);
//   · para REPROGRAMAR, la de la RESERVA (reservas.modalidad, NULL = legacy).
// Nunca la modalidad global vigente: un plan legacy sigue con 15/30/45/60 y
// grilla de 20 después del corte; uno v2 usa 10/20/30, grilla de 10 y +10 de
// buffer.
//
// La ocupación sale de la base tal cual la controla el trigger de B1: slots
// activos (legacy = bloque de 20, v2 = ocupacion_min), reservas activas sin
// slots y pendientes web vigentes, de TODOS los orígenes (web legacy y v2,
// Mensualidades legacy y v2, Empresas) y los bloqueos. Diferencia intencional
// con el motor anterior (clase D1 de B2): una Mensualidad de fin de semana que
// pasa las 14:00 ahora ocupa TODOS sus bloques, igual que en la base; antes se
// veía solo el primero y se podía ofrecer un turno que la base rechazaba.
// ============================================================================

import { duracionPermitida, duracionesPermitidas, type Modalidad } from "@/lib/catalogoComercial";
import { turnoPara } from "@/lib/agendaIntervalos";
import { horariosConLibres } from "@/lib/disponibilidadIntervalos";
import { cargarFuentesAgenda, disponibilidadDesdeFuentes } from "@/lib/disponibilidadIntervalosServer";
import {
  bloquesDeAgendaPara, diaHabilitadoPara, fechaDentroDeVentana, fechaValida, horariosDe,
  hoyEnSim, limiteDeTurno, REGLAS_POR_PRODUCTO,
} from "@/lib/agenda";

export type FalloAgenda = { ok: false; status: number; codigo: string; error: string };
const fail = (status: number, codigo: string, error: string): FalloAgenda => ({ ok: false, status, codigo, error });

function hhmm(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/** "15, 30, 45 o 60" / "10, 20 o 30". */
function enumerar(valores: readonly number[]): string {
  if (valores.length === 1) return String(valores[0]);
  return `${valores.slice(0, -1).join(", ")} o ${valores[valores.length - 1]}`;
}

/** Duraciones por reserva de un plan de esa modalidad. */
export function duracionesMensualidad(modalidad: Modalidad): number[] {
  return [...duracionesPermitidas(modalidad, "mensualidad")];
}

export function mensajeDuracion(modalidad: Modalidad): string {
  return `Elegí una duración de ${enumerar(duracionesMensualidad(modalidad))} minutos.`;
}

/**
 * ¿Se puede EMPEZAR ese turno con esa modalidad? Devuelve los bloques legacy
 * que la RPC legacy necesita (en v2 no hay bloques: una fila por simulador).
 * No mira la ocupación.
 */
export function turnoMensualidad(
  modalidad: Modalidad, fecha: string, hora: string, duracion: unknown,
): { ok: true; bloques: string[] } | FalloAgenda {
  if (!duracionPermitida(modalidad, "mensualidad", duracion)) {
    return fail(422, "duracion_invalida", mensajeDuracion(modalidad));
  }
  const d = Number(duracion);
  if (modalidad === "legacy") {
    // Exactamente la regla de siempre (M8C.1): inicio en la grilla del día y,
    // de lunes a viernes, terminar a las 22:00; el fin de semana, último inicio.
    if (!horariosDe(fecha).includes(hora)) return fail(422, "hora_invalida", "Elegí un horario válido.");
    const bloques = bloquesDeAgendaPara("mensualidad", fecha, hora, d);
    if (!bloques) {
      const limite = limiteDeTurno("mensualidad", fecha);
      const grilla = horariosDe(fecha);
      const detalle = limite.tipo === "ultimoInicio"
        ? `el último horario para empezar es ${grilla[grilla.length - 1]}`
        : `la experiencia tiene que terminar antes de las ${hhmm(limite.minuto)}`;
      return fail(422, "sin_bloques", `Ese horario no sirve para esa duración: ${detalle}.`);
    }
    return { ok: true, bloques };
  }
  // v2: paso de 10; de lunes a viernes el tiempo comercial termina a las 22:00
  // como máximo; sábado y domingo el último inicio es 14:00. Es la misma regla
  // que aplica la RPC (mensualidad_horario_valido_v2).
  const turno = turnoPara({ modalidad, producto: "mensualidad", fecha, hora, duracion: d });
  if (!turno) {
    const limite = limiteDeTurno("mensualidad", fecha);
    const grilla = horariosDe(fecha);
    const detalle = limite.tipo === "ultimoInicio"
      ? `el último horario para empezar es ${grilla[grilla.length - 1]}`
      : `la experiencia tiene que terminar antes de las ${hhmm(limite.minuto)}`;
    return fail(422, "sin_bloques", `Ese horario no sirve para esa duración: ${detalle}.`);
  }
  return { ok: true, bloques: [] };
}

export type HorarioMensualidad = { hora: string; simuladores: string[] };

/**
 * Simuladores CONCRETOS libres durante todo el turno, por inicio, para una
 * modalidad explícita. Solo los inicios con al menos uno libre (la forma que
 * ya veía la pantalla). `excluirReservaId` saca de la cuenta a la reserva que
 * se está reprogramando: su lugar actual también le sirve.
 */
export async function simuladoresLibresMensualidad(args: {
  modalidad: Modalidad;
  fecha: string;
  duracion: number;
  ahora?: Date;
  excluirReservaId?: number | string;
}): Promise<{ ok: true; horarios: HorarioMensualidad[] } | FalloAgenda> {
  const ahora = args.ahora ?? new Date();
  const { modalidad, fecha, duracion } = args;
  if (!fechaValida(fecha)) return fail(400, "fecha_invalida", "Fecha inválida");
  if (!fechaDentroDeVentana(fecha, hoyEnSim(ahora))) return fail(400, "fecha_fuera_de_ventana", "Fecha fuera del rango disponible");
  if (!diaHabilitadoPara("mensualidad", fecha)) return fail(400, "dia_no_habilitado", "Ese día no está disponible.");
  if (!duracionPermitida(modalidad, "mensualidad", duracion)) return fail(400, "duracion_invalida", "Duración inválida");

  let fuentes = await cargarFuentesAgenda(fecha, fecha);
  if (args.excluirReservaId !== undefined) {
    const propio = String(args.excluirReservaId);
    fuentes = {
      ...fuentes,
      reservas: fuentes.reservas.filter((r) => String(r.id) !== propio),
      slots: fuentes.slots.filter((s) => String(s.reserva_id) !== propio),
    };
  }
  const { disponibilidad } = disponibilidadDesdeFuentes(fuentes, {
    modalidad, producto: "mensualidad", fecha, duracion, ahora,
  });
  return {
    ok: true,
    horarios: horariosConLibres(disponibilidad).map((h) => ({ hora: h.hora, simuladores: [...h.libres] })),
  };
}

/**
 * ¿Están libres ESOS simuladores durante todo ese turno? Comprobación temprana:
 * la garantía final contra carreras sigue siendo la base (índice único +
 * trigger B1 dentro de la misma transacción de la RPC).
 */
export async function evaluarTurnoMensualidad(args: {
  modalidad: Modalidad;
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: readonly string[];
  ahora?: Date;
  excluirReservaId?: number | string;
}): Promise<{ ok: true } | FalloAgenda> {
  const r = await simuladoresLibresMensualidad(args);
  if (!r.ok) return fail(422, "seleccion_invalida", r.error);
  const h = r.horarios.find((x) => x.hora === args.hora);
  if (!h || h.simuladores.length === 0) return fail(409, "turno_ocupado", "Ese horario no está disponible.");
  const pedidos = args.simuladores;
  const todosLibres = pedidos.length > 0
    && new Set(pedidos).size === pedidos.length
    && pedidos.every((s) => h.simuladores.includes(s));
  if (!todosLibres) {
    return fail(409, "turno_ocupado", "Uno o más simuladores ya están reservados en ese horario");
  }
  return { ok: true };
}

/** Límites de simuladores por reserva (iguales en las dos modalidades). */
export const SIMULADORES_MENSUALIDAD = {
  min: REGLAS_POR_PRODUCTO.mensualidad.simuladoresMin,
  max: REGLAS_POR_PRODUCTO.mensualidad.simuladoresMax,
} as const;
