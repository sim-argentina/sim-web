// ============================================================================
// Disponibilidad por INTERVALOS y RECURSOS (Bloque B2). Módulo PURO.
// ----------------------------------------------------------------------------
// Recibe las filas ya leídas (reservas, slots, bloqueos) y el instante `ahora`
// (solo para el vencimiento de pendientes y bloqueos: la modalidad llega
// siempre explícita). La carga desde la base vive en
// lib/disponibilidadIntervalosServer.ts, que lee todo UNA vez por rango.
//
// RECURSOS
// Los cuatro simuladores son recursos equivalentes: ninguna regla depende del
// nombre. Se conservan los nombres porque las reservas existentes tienen
// simulador asignado. Un recurso sirve para un turno solo si está libre durante
// TODO [inicio, finOcupacion): no alcanza con contar cuántos hay ocupados a la
// vez. Si A está tomado 12:00–12:30 y B 12:30–13:00, un turno 12:10–12:50 no
// puede ir ni en A ni en B.
//
// FUENTES DE OCUPACIÓN
//   · reserva_slots activos: la verdad de la base (lo que controlan el índice
//     único y el trigger B1). Fila legacy (ocupacion_min NULL) = el bloque de
//     20 que empieza en `hora`; fila v2 = [hora, hora + ocupacion_min).
//   · reservas activas SIN slots activos: los bloques que les tocan por su
//     modalidad (legacy: getOccupiedSlots, lo mismo que usa el motor actual).
//   · pendientes de pago vigentes: todavía no tienen slots y retienen el turno
//     mientras se paga (mismo TTL que hoy). Legacy: los slots que el webhook va
//     a crear; v2: duración + buffer.
// Web, Empresas y Mensualidades son todas reservas: no hay reglas por origen.
// Cada reserva ocupa según SU modalidad persistida (NULL = legacy), nunca la
// que rija hoy.
// ============================================================================

import {
  duracionesPermitidas, ocupacionMinutos, pasoAgendaMin, type Modalidad,
} from "@/lib/catalogoComercial";
import { bloqueoAplicable } from "@/lib/bloqueosEstado";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import { SIMULADORES_VALIDOS } from "@/lib/reservasValidation";
import {
  bloquesLegacy, iniciosDelDia, minutosDeHora, seSuperponen,
  type Intervalo, type ProductoAgenda, type TurnoIntervalo,
} from "@/lib/agendaIntervalos";

/** Los recursos de la agenda, en el orden de siempre. */
export const RECURSOS_AGENDA: readonly string[] = SIMULADORES_VALIDOS;

const MS_POR_MINUTO = 60_000;

/**
 * Duración que el motor actual le asume a una reserva sin duración
 * (construirOcupacion): la más corta que vende Reservas en legacy.
 */
const DURACION_LEGACY_POR_DEFECTO = duracionesPermitidas("legacy", "reserva")[0];

// ── Filas de entrada (como llegan de la base) ───────────────────────────────

export type FilaReserva = {
  id: number | string;
  fecha: string;
  hora: string;
  duracion_minutos: number | null;
  simuladores: unknown;
  estado: string;
  created_at: string | null;
  modalidad: string | null;
  origen?: string | null;
};

export type FilaSlot = {
  reserva_id: number | string;
  fecha: string;
  hora: string;
  simulador: string;
  estado: string;
  ocupacion_min: number | null;
};

export type FilaBloqueo = {
  fecha: string;
  todo_el_dia: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  simulador: string | null;
  activo: boolean;
};

/** NULL (histórico) o 'legacy' → legacy; 'v2_10' → v2_10. */
export function modalidadDeReserva(valor: unknown): Modalidad {
  return valor === "v2_10" ? "v2_10" : "legacy";
}

// ── Ocupaciones ─────────────────────────────────────────────────────────────

export type FuenteOcupacion = "slot" | "reserva_sin_slots" | "pendiente";

export type OcupacionRecurso = {
  recurso: string;
  intervalo: Intervalo;
  modalidad: Modalidad;
  fuente: FuenteOcupacion;
  origen: string | null;
};

export type ResumenFuentes = {
  slotsActivos: number;
  reservasConSlots: number;
  reservasSinSlots: number;
  pendientesVigentes: number;
  pendientesVencidas: number;
  /** Filas que no se pudieron ubicar en el día (hora o duración inválidas). */
  descartadas: number;
};

const simuladoresDe = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.map((s) => String(s)) : [];

/** Intervalos que ocupa una reserva que todavía no tiene slots, por SU modalidad. */
function intervalosDeReserva(fecha: string, r: FilaReserva): Intervalo[] | null {
  if (modalidadDeReserva(r.modalidad) === "v2_10") {
    const inicio = minutosDeHora(r.hora);
    const ocupacion = ocupacionMinutos("v2_10", r.duracion_minutos);
    if (inicio === null || ocupacion === null) return null;
    return [{ desde: inicio, hasta: inicio + ocupacion }];
  }
  // Legacy: exactamente los bloques que usa el motor actual y que el webhook
  // inserta al aprobarse el pago, con la misma duración por defecto.
  const paso = pasoAgendaMin("legacy");
  const out: Intervalo[] = [];
  for (const bloque of getOccupiedSlots(fecha, r.hora, Number(r.duracion_minutos) || DURACION_LEGACY_POR_DEFECTO)) {
    const m = minutosDeHora(bloque);
    if (m !== null) out.push({ desde: m, hasta: m + paso });
  }
  return out.length ? out : null;
}

/**
 * Todo lo que ocupa cada recurso en `fecha`. `ahora` y `pendienteTtlMin` deciden
 * qué pendientes siguen reteniendo su turno (misma regla que el motor actual).
 */
export function ocupacionesDelDia(args: {
  fecha: string;
  reservas: readonly FilaReserva[];
  slots: readonly FilaSlot[];
  ahora: Date;
  pendienteTtlMin: number;
}): { ocupaciones: OcupacionRecurso[]; resumen: ResumenFuentes } {
  const { fecha, ahora, pendienteTtlMin } = args;
  const reservas = args.reservas.filter((r) => r.fecha === fecha);
  const origenDe = new Map(reservas.map((r) => [String(r.id), r.origen ?? null]));
  const ocupaciones: OcupacionRecurso[] = [];
  const resumen: ResumenFuentes = {
    slotsActivos: 0, reservasConSlots: 0, reservasSinSlots: 0,
    pendientesVigentes: 0, pendientesVencidas: 0, descartadas: 0,
  };

  // 1) Slots activos: la verdad de la base, sea cual sea el estado de la reserva.
  const conSlots = new Set<string>();
  for (const s of args.slots) {
    if (s.fecha !== fecha || s.estado !== "activa") continue;
    const inicio = minutosDeHora(s.hora);
    const v2 = s.ocupacion_min !== null && s.ocupacion_min !== undefined;
    const ocupacion = v2 ? Number(s.ocupacion_min) : pasoAgendaMin("legacy");
    if (inicio === null || !Number.isSafeInteger(ocupacion) || ocupacion <= 0) {
      resumen.descartadas++;
      continue;
    }
    resumen.slotsActivos++;
    conSlots.add(String(s.reserva_id));
    ocupaciones.push({
      recurso: String(s.simulador),
      intervalo: { desde: inicio, hasta: inicio + ocupacion },
      modalidad: v2 ? "v2_10" : "legacy",
      fuente: "slot",
      origen: origenDe.get(String(s.reserva_id)) ?? null,
    });
  }

  // 2) Reservas activas sin slots y 3) pendientes vigentes: por sus datos.
  const limitePendiente = ahora.getTime() - pendienteTtlMin * MS_POR_MINUTO;
  for (const r of reservas) {
    let fuente: FuenteOcupacion;
    if (r.estado === "activa") {
      if (conSlots.has(String(r.id))) {
        resumen.reservasConSlots++;
        continue;
      }
      fuente = "reserva_sin_slots";
    } else if (r.estado === "pendiente_pago") {
      const creada = r.created_at ? Date.parse(r.created_at) : Number.NaN;
      if (!(creada > limitePendiente)) {
        resumen.pendientesVencidas++;
        continue;
      }
      fuente = "pendiente";
    } else {
      continue;
    }
    const intervalos = intervalosDeReserva(fecha, r);
    if (!intervalos) {
      resumen.descartadas++;
      continue;
    }
    if (fuente === "pendiente") resumen.pendientesVigentes++;
    else resumen.reservasSinSlots++;
    const modalidad = modalidadDeReserva(r.modalidad);
    for (const recurso of simuladoresDe(r.simuladores)) {
      for (const intervalo of intervalos) {
        ocupaciones.push({ recurso, intervalo, modalidad, fuente, origen: r.origen ?? null });
      }
    }
  }

  return { ocupaciones, resumen };
}

// ── Bloqueos ────────────────────────────────────────────────────────────────

/** Bloqueos que valen en `fecha` y `ahora`: habilitados y no vencidos (lib/bloqueosEstado.ts). */
export function bloqueosAplicables(
  bloqueos: readonly FilaBloqueo[], fecha: string, ahora: Date,
): FilaBloqueo[] {
  return bloqueos.filter((b) => b.fecha === fecha && b.activo === true && bloqueoAplicable(b, ahora.getTime()));
}

/**
 * ¿Ese bloqueo le impide ese turno a ese recurso?
 *   · legacy: el criterio de siempre (lib/bloqueos.ts y rama legacy del
 *     trigger): el INICIO de algún bloque de 20 cae en [hora_inicio, hora_fin],
 *     comparando "HH:MM" como texto.
 *   · v2: el intervalo de ocupación toca el tramo bloqueado. hora_fin sigue
 *     siendo inclusiva para el inicio, como en la rama v2 del trigger: un turno
 *     que empieza justo en hora_fin choca; uno que termina justo en hora_inicio
 *     no. Un límite ilegible no bloquea, igual que en el trigger.
 */
export function bloqueoTocaTurno(b: FilaBloqueo, turno: TurnoIntervalo, recurso: string): boolean {
  if (b.simulador && b.simulador !== recurso) return false;
  if (b.todo_el_dia) return true;
  if (turno.modalidad === "legacy") {
    const ini = b.hora_inicio || "00:00";
    const fin = b.hora_fin || "23:59";
    return bloquesLegacy(turno).some((bloque) => bloque >= ini && bloque <= fin);
  }
  const ini = minutosDeHora(b.hora_inicio ?? "00:00");
  const fin = minutosDeHora(b.hora_fin ?? "23:59");
  if (ini === null || fin === null) return false;
  return seSuperponen(turno.intervalo, { desde: ini, hasta: fin + 1 });
}

// ── Disponibilidad ──────────────────────────────────────────────────────────

export type EstadoRecurso = { recurso: string; ocupado: boolean; bloqueado: boolean };

export type HorarioIntervalo = {
  hora: string;
  turno: TurnoIntervalo;
  /** Recursos libres durante TODO el intervalo y sin bloqueo, en el orden de los recursos. */
  libres: string[];
  recursos: EstadoRecurso[];
};

export type DisponibilidadIntervalos = {
  modalidad: Modalidad;
  producto: ProductoAgenda;
  fecha: string;
  duracion: number;
  horarios: HorarioIntervalo[];
};

/** Índice por recurso para no recorrer todas las ocupaciones en cada inicio. */
function porRecurso(ocupaciones: readonly OcupacionRecurso[]): Map<string, Intervalo[]> {
  const mapa = new Map<string, Intervalo[]>();
  for (const o of ocupaciones) {
    const lista = mapa.get(o.recurso) ?? [];
    lista.push(o.intervalo);
    mapa.set(o.recurso, lista);
  }
  return mapa;
}

/** Estado de UN recurso para UN turno: ocupado (algún intervalo lo toca) y/o bloqueado. */
export function estadoRecurso(
  turno: TurnoIntervalo,
  recurso: string,
  intervalosDelRecurso: readonly Intervalo[],
  bloqueosDelDia: readonly FilaBloqueo[],
): EstadoRecurso {
  return {
    recurso,
    ocupado: intervalosDelRecurso.some((i) => seSuperponen(i, turno.intervalo)),
    bloqueado: bloqueosDelDia.some((b) => bloqueoTocaTurno(b, turno, recurso)),
  };
}

/**
 * Disponibilidad de un día para un producto, una duración comercial y UNA
 * modalidad explícita (la del turno que se quiere vender). Devuelve todos los
 * inicios válidos, también los que no tienen ningún recurso libre.
 */
export function disponibilidadIntervalos(args: {
  modalidad: Modalidad;
  producto: ProductoAgenda;
  fecha: string;
  duracion: number;
  ocupaciones: readonly OcupacionRecurso[];
  bloqueos: readonly FilaBloqueo[];
  ahora: Date;
  recursos?: readonly string[];
}): DisponibilidadIntervalos {
  const { modalidad, producto, fecha, duracion, ahora } = args;
  const recursos = args.recursos ?? RECURSOS_AGENDA;
  const indice = porRecurso(args.ocupaciones);
  const bloqueos = bloqueosAplicables(args.bloqueos, fecha, ahora);

  const horarios = iniciosDelDia({ modalidad, producto, fecha, duracion }).map((turno) => {
    const estados = recursos.map((r) => estadoRecurso(turno, r, indice.get(r) ?? [], bloqueos));
    return {
      hora: turno.hora,
      turno,
      libres: estados.filter((e) => !e.ocupado && !e.bloqueado).map((e) => e.recurso),
      recursos: estados,
    };
  });
  return { modalidad, producto, fecha, duracion, horarios };
}

/** Solo los inicios con al menos un recurso libre: la forma que hoy ve el público. */
export function horariosConLibres(d: DisponibilidadIntervalos): HorarioIntervalo[] {
  return d.horarios.filter((h) => h.libres.length > 0);
}

/**
 * Asigna `cantidad` recursos CONCRETOS a un inicio, cada uno libre durante todo
 * el intervalo, en el orden de los recursos. Si no alcanzan, null: nunca se
 * promete capacidad que no existe.
 */
export function asignarRecursos(horario: HorarioIntervalo, cantidad: number): string[] | null {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > horario.libres.length) return null;
  return horario.libres.slice(0, cantidad);
}

/** ¿Están libres TODOS esos recursos puntuales (sin repetir) en ese inicio? */
export function recursosLibres(horario: HorarioIntervalo, pedidos: readonly string[]): boolean {
  return pedidos.length > 0
    && new Set(pedidos).size === pedidos.length
    && pedidos.every((r) => horario.libres.includes(r));
}
