import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  bloquesDeAgendaPara, cantidadSimuladoresValidaPara, diaHabilitadoPara,
  fechaDentroDeVentana, fechaValida, horariosDe,
} from "@/lib/agenda";
import { hayDisponibilidadPara } from "@/lib/disponibilidad";

// Cancelación y reprogramación de reservas de Mensualidades (Bloque M5C).
// SOLO SERVIDOR.
//
// Este módulo es el único que llama a cancelar_reserva_mensualidad y a
// reprogramar_reserva_mensualidad. Su trabajo es:
//   1. validar la forma de la solicitud;
//   2. para reprogramar, resolver los bloques con la fuente única de M6 y
//      comprobar disponibilidad real antes de tocar nada;
//   3. delegar la atomicidad a la RPC (slots + saldo + movimiento);
//   4. traducir los errores del motor a mensajes que se le pueden mostrar a una
//      persona, sin filtrar SQL, saldo interno, ids ni PII.
//
// La PERTENENCIA no se comprueba acá: viaja `mensualidadId`, que sale de la
// sesión de M4, y la RPC exige en su propio WHERE que la reserva sea de esa
// billetera. Una referencia ajena es indistinguible de una inexistente.

/** Clave de idempotencia que genera el navegador por intento lógico. */
const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Referencia pública de reserva: RES-XXXX-XXXX, alfabeto sin 0/O/1/I. */
const REF_RE = /^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export type Fallo = { ok: false; status: number; codigo: string; error: string };
const fail = (status: number, codigo: string, error: string): Fallo =>
  ({ ok: false, status, codigo, error });

// Errores de las RPC → respuesta pública. Nunca se devuelve el texto crudo del
// motor: eso filtraría nombres de constraints y estructura.
const MAPA: Record<string, { status: number; error: string }> = {
  reserva_inexistente: { status: 404, error: "No encontramos esa reserva." },
  mensualidad_inexistente: { status: 404, error: "No encontrado" },
  estado_no_cancelable: {
    status: 409,
    error: "Esa reserva ya no se puede cancelar.",
  },
  estado_no_reprogramable: {
    status: 409,
    error: "Esa reserva ya no se puede reprogramar.",
  },
  reserva_ya_iniciada: {
    status: 409,
    error: "Ese turno ya empezó, así que no se puede modificar.",
  },
  fuera_de_plazo: {
    status: 409,
    error: "Para reprogramar faltan más de 24 horas. Podés cancelar, pero los minutos no se devuelven.",
  },
  turno_posterior_al_vencimiento: {
    status: 422,
    error: "Esa fecha cae después del vencimiento de tu mensualidad. Elegí una anterior.",
  },
  fecha_fuera_de_ventana: {
    status: 422,
    error: "Solo se puede reservar desde mañana y hasta 15 días de anticipación.",
  },
  reserva_sin_simuladores: { status: 409, error: "Esa reserva no se puede reprogramar." },
  idempotency_key_invalida: { status: 400, error: "Solicitud inválida." },
  bloques_incoherentes: { status: 400, error: "Solicitud inválida." },
  bloques_desordenados: { status: 400, error: "Solicitud inválida." },
  hora_invalida: { status: 400, error: "Elegí un horario válido." },
};

/** El conflicto de turno llega como índice único o como el trigger de bloqueos. */
function esConflictoDeTurno(mensaje: string, code: string): boolean {
  if (code === "23514") return true; // trg_reserva_slot_bloqueo
  return code === "23505" && mensaje.includes("reserva_slots_activa_uq");
}

function traducir(mensaje: string, code: string): Fallo {
  for (const clave of Object.keys(MAPA)) {
    if (mensaje.includes(clave)) {
      const m = MAPA[clave];
      return fail(m.status, clave, m.error);
    }
  }
  if (esConflictoDeTurno(mensaje, code)) {
    return fail(409, "turno_ocupado", "Ese turno se ocupó mientras elegías. Elegí otro horario.");
  }
  return fail(500, "error", "No pudimos completar la operación. Probá de nuevo.");
}

// ── Cancelar ────────────────────────────────────────────────────────────────

export type CancelacionHecha = {
  referencia: string;
  estado: string;
  restituyo: boolean;
  minutos_restituidos: number;
  saldo_restante: number;
  idempotente: boolean;
};

export type ResultadoCancelacion = { ok: true; data: CancelacionHecha } | Fallo;

type FilaCancelar = {
  reserva_id: number;
  referencia_publica: string;
  estado: string;
  restituyo: boolean;
  minutos_restituidos: number;
  saldo_anterior: number;
  saldo_posterior: number;
  idempotente: boolean;
};

/**
 * Cancela una reserva de la billetera de la sesión. La regla de las 24 horas la
 * decide la RPC con la hora de Córdoba: acá no se calcula nada de eso, para que
 * no existan dos criterios.
 */
export async function cancelarReserva(
  mensualidadId: string,
  referencia: string,
  idempotencyKey: string,
): Promise<ResultadoCancelacion> {
  if (!IDEM_RE.test(idempotencyKey)) {
    return fail(400, "idempotency_invalida", "Solicitud inválida.");
  }
  if (!REF_RE.test(referencia)) {
    // Mismo 404 que una referencia ajena: no se puede enumerar probando.
    return fail(404, "reserva_inexistente", "No encontramos esa reserva.");
  }

  const { data, error } = await supabaseAdmin.rpc("cancelar_reserva_mensualidad", {
    p_mensualidad_id: mensualidadId,
    p_referencia: referencia,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    return traducir(String(error.message ?? ""), String((error as { code?: string }).code ?? ""));
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaCancelar | undefined;
  if (!fila) return fail(500, "error", "No pudimos cancelar la reserva. Probá de nuevo.");

  return {
    ok: true,
    data: {
      referencia: fila.referencia_publica,
      estado: fila.estado,
      restituyo: Boolean(fila.restituyo),
      minutos_restituidos: Number(fila.minutos_restituidos) || 0,
      saldo_restante: Number(fila.saldo_posterior) || 0,
      idempotente: Boolean(fila.idempotente),
    },
  };
}

// ── Reprogramar ─────────────────────────────────────────────────────────────

export type ReprogramacionHecha = {
  referencia: string;
  fecha: string;
  hora: string;
  duracion: number;
  minutos_consumidos: number;
  sin_cambios: boolean;
};

export type ResultadoReprogramacion = { ok: true; data: ReprogramacionHecha } | Fallo;

type FilaReprogramar = {
  reserva_id: number;
  referencia_publica: string;
  fecha: string;
  hora: string;
  duracion_minutos: number;
  minutos_consumidos: number;
  sin_cambios: boolean;
};

/** Duración y simuladores de la reserva, para resolver los bloques del nuevo horario. */
type Actual = { duracion: number; simuladores: string[]; fecha: string; hora: string };

async function leerReservaPropia(
  mensualidadId: string,
  referencia: string,
): Promise<Actual | null> {
  const { data } = await supabaseAdmin
    .from("reservas")
    .select("duracion_minutos, simuladores, fecha, hora")
    .eq("referencia_publica", referencia)
    .eq("mensualidad_id", mensualidadId)
    .eq("origen", "mensualidad")
    .eq("estado", "activa")
    .maybeSingle();
  if (!data) return null;
  return {
    duracion: Number(data.duracion_minutos) || 0,
    simuladores: Array.isArray(data.simuladores) ? data.simuladores.map(String) : [],
    fecha: String(data.fecha),
    hora: String(data.hora),
  };
}

/**
 * Mueve la reserva a otra fecha/hora. La duración y los simuladores NO se tocan:
 * salen de la reserva existente, no del cuerpo de la solicitud, así que no hay
 * forma de cambiarlas reprogramando.
 */
export async function reprogramarReserva(
  mensualidadId: string,
  referencia: string,
  fecha: string,
  hora: string,
  idempotencyKey: string,
): Promise<ResultadoReprogramacion> {
  if (!IDEM_RE.test(idempotencyKey)) {
    return fail(400, "idempotency_invalida", "Solicitud inválida.");
  }
  if (!REF_RE.test(referencia)) {
    return fail(404, "reserva_inexistente", "No encontramos esa reserva.");
  }
  if (!fechaValida(fecha)) {
    return fail(422, "fecha_invalida", "Elegí una fecha válida.");
  }
  if (!fechaDentroDeVentana(fecha)) {
    return fail(422, "fecha_fuera_de_ventana",
      "Solo se puede reservar desde mañana y hasta 15 días de anticipación.");
  }
  // (M5C.1) Mensualidades opera de lunes a viernes: no se reprograma a un finde.
  if (!diaHabilitadoPara("mensualidad", fecha)) {
    return fail(422, "dia_no_habilitado", "Con la mensualidad se reserva de lunes a viernes.");
  }
  if (!horariosDe(fecha).includes(hora)) {
    return fail(422, "hora_invalida", "Elegí un horario válido.");
  }

  // La duración manda y sale de la reserva, nunca del cliente.
  const actual = await leerReservaPropia(mensualidadId, referencia);
  if (!actual) return fail(404, "reserva_inexistente", "No encontramos esa reserva.");

  // (M5C.1) Una reserva vieja con menos de 2 simuladores no se puede mover: las
  // reglas nuevas rigen para reprogramaciones nuevas. Se puede cancelar.
  if (!cantidadSimuladoresValidaPara("mensualidad", actual.simuladores.length)) {
    return fail(422, "simuladores_invalidos",
      "Esa reserva no cumple las condiciones actuales y no se puede reprogramar. Podés cancelarla.");
  }

  // (M5C.1) El turno nuevo también tiene que terminar antes del cierre.
  const bloques = bloquesDeAgendaPara("mensualidad", fecha, hora, actual.duracion);
  if (!bloques) {
    return fail(422, "sin_bloques",
      "Ese horario no sirve para la duración de tu reserva: la experiencia tiene que terminar antes de las 22:00.");
  }

  // Disponibilidad real (M6) ANTES de tocar nada, salvo que sea el mismo turno:
  // ahí la reserva se vería a sí misma como ocupada y diría que no hay lugar.
  const mismoTurno = actual.fecha === fecha && actual.hora === hora;
  if (!mismoTurno) {
    const disp = await hayDisponibilidadPara({
      fecha, hora, duracion: actual.duracion,
      simuladores: actual.simuladores, producto: "mensualidad",
    });
    if (!disp.ok) {
      const status = disp.status === 409 ? 409 : 422;
      return fail(status, status === 409 ? "turno_ocupado" : "seleccion_invalida", disp.error);
    }
  }

  const { data, error } = await supabaseAdmin.rpc("reprogramar_reserva_mensualidad", {
    p_mensualidad_id: mensualidadId,
    p_referencia: referencia,
    p_fecha: fecha,
    p_hora: hora,
    p_slots: bloques,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    return traducir(String(error.message ?? ""), String((error as { code?: string }).code ?? ""));
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaReprogramar | undefined;
  if (!fila) return fail(500, "error", "No pudimos reprogramar la reserva. Probá de nuevo.");

  return {
    ok: true,
    data: {
      referencia: fila.referencia_publica,
      fecha: fila.fecha,
      hora: fila.hora,
      duracion: Number(fila.duracion_minutos) || 0,
      minutos_consumidos: Number(fila.minutos_consumidos) || 0,
      sin_cambios: Boolean(fila.sin_cambios),
    },
  };
}
