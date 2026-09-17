import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getBloqueosActivos, turnoBloqueado } from "@/lib/bloqueos";
import { construirOcupacion } from "@/lib/reservasSlots";
import { SIMULADORES_VALIDOS } from "@/lib/reservasValidation";
import {
  bloquesDeAgendaPara, diaHabilitadoPara, duracionValidaPara,
  fechaDentroDeVentana, fechaValida, hoyEnSim, horariosDe, type Producto,
} from "@/lib/agenda";

// Cálculo de disponibilidad REAL de un día (Bloque M6). Solo servidor.
//
// La regla central de las duraciones largas es la INTERSECCIÓN: para reservar N
// simuladores durante 45 o 60 minutos tienen que existir N simuladores CONCRETOS
// libres en TODOS los bloques. No alcanza con que en cada bloque suelto haya N
// libres: si Ferrari está libre en el primero y ocupado en el segundo, y McLaren
// al revés, no hay ningún simulador disponible para la experiencia completa.
//
// Por eso el cálculo interno trabaja con los NOMBRES de los simuladores libres y
// recién al final se reduce a una cantidad. Lo que sale al navegador es siempre
// la cantidad; los nombres no se exponen.
//
// Reutiliza los bloqueos y la ocupación que ya usaba Reservas: no hay una
// segunda definición de nada.

/** Las pendientes de pago recientes retienen el turno mientras se paga. */
export const PENDIENTE_TTL_MIN = 15;

export type HorarioDisponible = {
  hora: string;
  /** Cuántos simuladores están libres durante TODA la duración. */
  simuladores: number;
};

export type ResultadoDisponibilidad =
  | { ok: true; fecha: string; duracion: number; horarios: HorarioDisponible[] }
  | { ok: false; status: number; error: string };

type Fallo = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fallo => ({ ok: false, status, error });

/** Interno: por cada inicio posible, QUÉ simuladores quedan libres. */
type ResultadoLibres =
  | { ok: true; libres: Map<string, string[]> }
  | Fallo;

async function libresPorHorario(args: {
  fecha: string;
  duracion: number;
  producto: Producto;
  hoy?: string;
}): Promise<ResultadoLibres> {
  const { fecha, duracion, producto } = args;
  const hoy = args.hoy ?? hoyEnSim();

  if (!fechaValida(fecha)) return fail(400, "Fecha inválida");
  if (!fechaDentroDeVentana(fecha, hoy)) return fail(400, "Fecha fuera del rango disponible");
  if (!duracionValidaPara(producto, duracion)) return fail(400, "Duración inválida");
  // (M5C.1) El producto puede no operar ese día: Mensualidades es de lunes a
  // viernes. Reservas normales tienen habilitados los siete, así que para ellas
  // esto nunca corta.
  if (!diaHabilitadoPara(producto, fecha)) {
    return fail(400, "Ese día no está disponible para este producto.");
  }

  // 1) Ocupación: reservas confirmadas + pendientes de pago recientes.
  const ttlIso = new Date(Date.now() - PENDIENTE_TTL_MIN * 60_000).toISOString();
  const { data: reservas, error } = await supabaseAdmin
    .from("reservas")
    .select("hora, duracion_minutos, simuladores, estado, created_at")
    .eq("fecha", fecha)
    .in("estado", ["activa", "pendiente_pago"]);
  if (error) return fail(500, "No se pudo calcular la disponibilidad");

  const bloqueantes = (reservas ?? []).filter(
    (r) => r.estado === "activa" ||
      (r.estado === "pendiente_pago" && r.created_at && r.created_at > ttlIso),
  );
  const ocupacion = construirOcupacion(fecha, bloqueantes);

  // 2) Bloqueos administrativos del día.
  let bloqueos;
  try {
    bloqueos = await getBloqueosActivos(fecha);
  } catch {
    return fail(500, "No se pudo calcular la disponibilidad");
  }

  // 3) Por cada inicio posible, intersección de simuladores libres.
  // El Map conserva el orden de inserción, así que sale cronológico.
  const libres = new Map<string, string[]>();
  for (const hora of horariosDe(fecha)) {
    // (M5C.1) Suma al chequeo de agenda de M6 el día habilitado y el cierre a
    // las 22:00 del producto. Para "reserva" es equivalente a bloquesDeAgenda:
    // mismos días, misma grilla, mismo resultado que antes.
    const bloques = bloquesDeAgendaPara(producto, fecha, hora, duracion);
    // null = no entra completa, hay discontinuidad, o el producto no lo admite.
    if (!bloques) continue;

    const disponibles = SIMULADORES_VALIDOS.filter((sim) => {
      // Libre en TODOS los bloques...
      if (bloques.some((b) => ocupacion[b]?.has(sim))) return false;
      // ...y sin bloqueo administrativo en NINGUNO.
      return !turnoBloqueado(bloqueos, bloques, [sim]);
    });

    if (disponibles.length > 0) libres.set(hora, [...disponibles]);
  }

  return { ok: true, libres };
}

export type HorarioConSimuladores = {
  hora: string;
  /** Escuderías concretas libres durante TODA la duración. */
  simuladores: string[];
};

export type ResultadoConSimuladores =
  | { ok: true; fecha: string; duracion: number; horarios: HorarioConSimuladores[] }
  | Fallo;

/**
 * (M5A) Igual que `disponibilidadDelDia` pero con los NOMBRES de los simuladores
 * libres. Es server-only y solo puede llegar al navegador detrás de un endpoint
 * que exija sesión válida de Mensualidades: el cliente tiene que elegir Ferrari
 * o McLaren, no "una de tres".
 *
 * NO debilita el DTO público de M6: `/api/disponibilidad` sigue devolviendo
 * únicamente cantidades, porque no pide sesión.
 */
export async function simuladoresLibresDelDia(args: {
  fecha: string;
  duracion: number;
  producto: Producto;
  hoy?: string;
}): Promise<ResultadoConSimuladores> {
  const r = await libresPorHorario(args);
  if (!r.ok) return r;
  const horarios = Array.from(r.libres, ([hora, simuladores]) => ({ hora, simuladores }));
  return { ok: true, fecha: args.fecha, duracion: args.duracion, horarios };
}

/**
 * Disponibilidad del día en la forma que ve el público: horario + CANTIDAD de
 * simuladores libres. Nunca los nombres.
 */
export async function disponibilidadDelDia(args: {
  fecha: string;
  duracion: number;
  producto: Producto;
  hoy?: string;
}): Promise<ResultadoDisponibilidad> {
  const r = await libresPorHorario(args);
  if (!r.ok) return r;
  const horarios = Array.from(r.libres, ([hora, sims]) => ({ hora, simuladores: sims.length }));
  return { ok: true, fecha: args.fecha, duracion: args.duracion, horarios };
}

/**
 * ¿Se puede reservar exactamente esto? Es la comprobación que debe hacer el
 * servidor ANTES de iniciar una reserva, además de la garantía de base
 * (reserva_slots_activa_uq + trigger reserva_slot_bloqueo), que sigue siendo la
 * que resuelve las carreras.
 *
 * Comprueba los simuladores CONCRETOS que se piden, no una cantidad: el cliente
 * elige simuladores, así que pedir Ferrari cuando Ferrari está tomado tiene que
 * fallar aunque queden otras tres libres.
 */
export async function hayDisponibilidadPara(args: {
  fecha: string; hora: string; duracion: number; simuladores: string[]; producto: Producto; hoy?: string;
}): Promise<{ ok: true } | Fallo> {
  const r = await libresPorHorario({
    fecha: args.fecha, duracion: args.duracion, producto: args.producto, hoy: args.hoy,
  });
  if (!r.ok) return r;

  const libres = r.libres.get(args.hora);
  // Sin entrada = la duración no entra ahí, o no queda ningún simulador.
  if (!libres || libres.length === 0) {
    return fail(409, "Ese horario no está disponible.");
  }
  if (args.simuladores.some((sim) => !libres.includes(sim))) {
    return fail(409, "Uno o más simuladores ya están reservados en ese horario");
  }
  return { ok: true };
}
