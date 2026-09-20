import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hayDisponibilidadPara } from "@/lib/disponibilidad";
import { SIMULADORES_VALIDOS } from "@/lib/reservasValidation";
import { CONDICIONES_RESERVA_VERSION } from "@/lib/mensualidadesCondiciones";
import {
  bloquesDeAgendaPara, cantidadSimuladoresValidaPara, diaHabilitadoPara,
  duracionValidaPara, fechaDentroDeVentana, fechaValida, horariosDe,
  REGLAS_POR_PRODUCTO,
} from "@/lib/agenda";

// Reserva de Mensualidades pagada 100% con saldo (Bloque M5A). SOLO SERVIDOR.
//
// Este módulo es el único que llama a la RPC crear_reserva_mensualidad. Su
// trabajo es:
//   1. validar la selección con la MISMA fuente de agenda que Reservas (M6);
//   2. comprobar disponibilidad real antes de tocar la billetera;
//   3. delegar la atomicidad a la RPC (saldo + reserva + slots + movimiento);
//   4. traducir los errores del motor a mensajes que se le pueden mostrar a una
//      persona, sin filtrar SQL, saldo interno, ids ni PII.
//
// Lo que NO hace: recibir el nombre, el teléfono, el email ni los minutos desde
// el navegador. Esos datos salen de la billetera dentro de la RPC.

/** Minutos que consume una selección: duración x simuladores. Siempre múltiplo de 15. */
export function minutosRequeridos(duracion: number, cantidadSimuladores: number): number {
  return duracion * cantidadSimuladores;
}

export type SeleccionReserva = {
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: string[];
  idempotencyKey: string;
  aceptoCondiciones: boolean;
};

export type ReservaCreada = {
  referencia: string;
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: string[];
  minutos_consumidos: number;
  saldo_restante: number;
  idempotente: boolean;
};

export type ResultadoReserva =
  | { ok: true; data: ReservaCreada }
  | { ok: false; status: number; error: string; codigo: string; faltan?: number; saldo?: number };

const fail = (
  status: number, codigo: string, error: string,
  extra: { faltan?: number; saldo?: number } = {},
): ResultadoReserva => ({ ok: false, status, error, codigo, ...extra });

// La clave de idempotencia la genera el navegador por INTENTO LÓGICO. Se exige
// opaca: sin PII adentro y con entropía suficiente para no chocar entre clientes.
const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Valida la selección con la fuente única de M6. Puro respecto de la base: no
 * consulta nada, así que sirve también para los tests sin DB.
 */
export function validarSeleccion(
  body: unknown,
  hoy?: string,
): { ok: true; value: SeleccionReserva & { bloques: string[] } } | { ok: false; codigo: string; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const idempotencyKey = String(b.idempotency_key ?? "");
  if (!IDEM_RE.test(idempotencyKey)) {
    return { ok: false, codigo: "idempotency_invalida", error: "Solicitud inválida." };
  }

  const fecha = String(b.fecha ?? "");
  if (!fechaValida(fecha)) {
    return { ok: false, codigo: "fecha_invalida", error: "Elegí una fecha válida." };
  }
  if (!fechaDentroDeVentana(fecha, hoy)) {
    return {
      ok: false, codigo: "fecha_fuera_de_ventana",
      error: "Solo se puede reservar desde mañana y hasta 15 días de anticipación.",
    };
  }
  // (M5C.1) Mensualidades opera de lunes a viernes.
  if (!diaHabilitadoPara("mensualidad", fecha)) {
    return {
      ok: false, codigo: "dia_no_habilitado",
      error: "Con la mensualidad se reserva de lunes a viernes.",
    };
  }

  // Duración: las cuatro de Mensualidades. 45 y 60 no existen para Reservas
  // normales y eso lo decide DURACIONES_POR_PRODUCTO, no este archivo.
  const duracion = Number(b.duracion_minutos);
  if (!duracionValidaPara("mensualidad", b.duracion_minutos)) {
    return { ok: false, codigo: "duracion_invalida", error: "Elegí una duración de 15, 30, 45 o 60 minutos." };
  }

  const hora = String(b.hora ?? "");
  if (!horariosDe(fecha).includes(hora)) {
    return { ok: false, codigo: "hora_invalida", error: "Elegí un horario válido." };
  }
  // (M5C.1) Además de la agenda, el turno tiene que TERMINAR antes del cierre.
  const bloques = bloquesDeAgendaPara("mensualidad", fecha, hora, duracion);
  if (!bloques) {
    return {
      ok: false, codigo: "sin_bloques",
      error: "Ese horario no sirve para esa duración: la experiencia tiene que terminar antes de las 22:00.",
    };
  }

  // (M8C) De 1 a 4 simuladores. Los límites salen de REGLAS_POR_PRODUCTO, que es
  // la única fuente: no se escriben acá ni se repiten en el mensaje.
  const { simuladoresMin, simuladoresMax } = REGLAS_POR_PRODUCTO.mensualidad;
  const crudos = b.simuladores;
  if (!Array.isArray(crudos) || !cantidadSimuladoresValidaPara("mensualidad", crudos.length)) {
    return {
      ok: false, codigo: "simuladores_invalidos",
      error: `Elegí entre ${simuladoresMin} y ${simuladoresMax} simuladores.`,
    };
  }
  const simuladores = crudos.map((s) => String(s));
  if (new Set(simuladores).size !== simuladores.length) {
    return { ok: false, codigo: "simuladores_duplicados", error: "No se puede repetir un simulador." };
  }
  for (const s of simuladores) {
    if (!(SIMULADORES_VALIDOS as readonly string[]).includes(s)) {
      return { ok: false, codigo: "simulador_desconocido", error: "Elegí simuladores de la lista." };
    }
  }

  // El checkbox del navegador no alcanza como prueba, pero su ausencia sí alcanza
  // para no seguir: la aceptación real se guarda con versión y fecha en la RPC.
  if (b.acepto_condiciones !== true) {
    return { ok: false, codigo: "condiciones", error: "Tenés que aceptar las condiciones para reservar." };
  }

  return {
    ok: true,
    value: { fecha, hora, duracion, simuladores, idempotencyKey, aceptoCondiciones: true, bloques },
  };
}

// Errores que puede levantar la RPC → respuesta pública. Nunca se devuelve el
// texto crudo del motor: eso filtraría nombres de constraints y estructura.
const MAPA_ERRORES: Record<string, { status: number; error: string }> = {
  mensualidad_bloqueada: { status: 422, error: "Tu mensualidad necesita revisión. Escribinos y lo resolvemos." },
  mensualidad_vencida: { status: 422, error: "Tu mensualidad está vencida." },
  mensualidad_agotada: { status: 422, error: "Ya no te quedan minutos en la mensualidad." },
  turno_posterior_al_vencimiento: {
    status: 422,
    error: "Ese turno cae después del vencimiento de tu mensualidad. Elegí una fecha anterior.",
  },
  fecha_fuera_de_ventana: {
    status: 422,
    error: "Solo se puede reservar desde mañana y hasta 15 días de anticipación.",
  },
  saldo_insuficiente: { status: 422, error: "No te alcanza el saldo para esa selección." },
  simuladores_duplicados: { status: 422, error: "No se puede repetir un simulador." },
  simulador_desconocido: { status: 422, error: "Elegí simuladores de la lista." },
  // (M8C) El rango sale de la fuente de dominio: si mañana cambia, el mensaje
  // que ve la persona cambia con él. Antes decía "entre 2 y 4" escrito a mano,
  // así que la RPC y la pantalla podían contradecirse.
  cantidad_simuladores_invalida: {
    status: 422,
    error: `Elegí entre ${REGLAS_POR_PRODUCTO.mensualidad.simuladoresMin} y ${REGLAS_POR_PRODUCTO.mensualidad.simuladoresMax} simuladores.`,
  },
  duracion_invalida: { status: 422, error: "Elegí una duración de 15, 30, 45 o 60 minutos." },
  condiciones_requeridas: { status: 422, error: "Tenés que aceptar las condiciones para reservar." },
  idempotency_key_invalida: { status: 400, error: "Solicitud inválida." },
  idempotency_key_con_otro_payload: {
    status: 409,
    error: "Esa solicitud ya se usó para otra reserva. Volvé a intentar desde el principio.",
  },
  bloques_incoherentes: { status: 400, error: "Solicitud inválida." },
  bloques_desordenados: { status: 400, error: "Solicitud inválida." },
  mensualidad_inexistente: { status: 404, error: "No encontrado" },
};

// El conflicto de slot llega como violación del índice único o como el trigger de
// bloqueos. Los dos significan lo mismo para el cliente: alguien se adelantó.
function esConflictoDeTurno(mensaje: string, code: string): boolean {
  if (code === "23514") return true; // trg_reserva_slot_bloqueo
  return code === "23505" && mensaje.includes("reserva_slots_activa_uq");
}

function traducir(mensaje: string, code: string): ResultadoReserva {
  for (const clave of Object.keys(MAPA_ERRORES)) {
    if (mensaje.includes(clave)) {
      const m = MAPA_ERRORES[clave];
      return fail(m.status, clave, m.error);
    }
  }
  if (esConflictoDeTurno(mensaje, code)) {
    return fail(409, "turno_ocupado", "Ese turno se ocupó mientras elegías. Elegí otro horario.");
  }
  return fail(500, "error", "No pudimos confirmar la reserva. Probá de nuevo.");
}

/** ¿Esta clave ya creó una reserva? Solo se mira la existencia, no el contenido:
 *  quién decide si el payload coincide es la RPC. */
async function existeClave(clave: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("reservas")
    .select("id")
    .eq("idempotency_key", clave)
    .maybeSingle();
  return Boolean(data);
}

/** Saldo actual de la billetera. null si no se pudo leer (no rompe el flujo). */
async function saldoActual(mensualidadId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("mensualidades")
    .select("saldo_minutos")
    .eq("id", mensualidadId)
    .maybeSingle();
  return data ? Number(data.saldo_minutos) || 0 : null;
}

type FilaRpc = {
  reserva_id: number;
  referencia_publica: string;
  minutos_consumidos: number;
  saldo_anterior: number;
  saldo_posterior: number;
  idempotente: boolean;
};

/**
 * Confirma la reserva. `mensualidadId` viene de la sesión de M4: el navegador
 * nunca lo manda.
 */
export async function reservarConSaldo(
  mensualidadId: string,
  seleccion: SeleccionReserva & { bloques: string[] },
): Promise<ResultadoReserva> {
  const requeridos = minutosRequeridos(seleccion.duracion, seleccion.simuladores.length);

  // 0) ¿Es un REINTENTO? Tiene que resolverse antes que nada. Si no, el propio
  //    turno recién creado aparecería como ocupado y un doble clic devolvería
  //    "ese horario ya no está disponible" en vez de la reserva que sí se hizo.
  const esReintento = await existeClave(seleccion.idempotencyKey);

  if (!esReintento) {
    // 1) Disponibilidad real por la fuente única (M6), incluyendo bloqueos,
    //    pendientes de pago y la intersección de simuladores en todos los
    //    bloques. Es una comprobación temprana: la garantía definitiva contra
    //    carreras sigue siendo reserva_slots_activa_uq + trg_reserva_slot_bloqueo.
    const disp = await hayDisponibilidadPara({
      fecha: seleccion.fecha,
      hora: seleccion.hora,
      duracion: seleccion.duracion,
      simuladores: seleccion.simuladores,
      producto: "mensualidad",
    });
    if (!disp.ok) {
      // 409 = se ocupó mientras elegía; 422 = la selección nunca fue válida.
      const status = disp.status === 409 ? 409 : 422;
      return fail(status, status === 409 ? "turno_ocupado" : "seleccion_invalida", disp.error);
    }

    // 2) Saldo: se avisa ANTES de intentar la operación, para poder devolver
    //    cuánto falta. La autoridad sigue siendo la RPC —el saldo puede cambiar
    //    entre esta lectura y el consumo—, pero así el 422 lleva los números que
    //    M5B necesita para ofrecer el pago de la diferencia.
    const saldo = await saldoActual(mensualidadId);
    if (saldo !== null && requeridos > saldo) {
      return fail(422, "saldo_insuficiente", "No te alcanza el saldo para esa selección.", {
        saldo, faltan: requeridos - saldo,
      });
    }
  }

  // 3) Operación atómica. Solo datos ya identificados por el backend.
  const llamar = () => supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: mensualidadId,
    p_fecha: seleccion.fecha,
    p_hora: seleccion.hora,
    p_duracion: seleccion.duracion,
    p_simuladores: seleccion.simuladores,
    p_slots: seleccion.bloques,
    p_idempotency_key: seleccion.idempotencyKey,
    p_condiciones_version: CONDICIONES_RESERVA_VERSION,
  });

  let { data, error } = await llamar();

  // Dos primeros intentos EXACTAMENTE simultáneos con la misma clave: los dos
  // pasaron el chequeo de arriba y el perdedor choca con reservas_idem_uq. Es un
  // reintento, no un error: se vuelve a llamar y ahora sí encuentra la reserva.
  if (error && String(error.message ?? "").includes("reservas_idem_uq")) {
    ({ data, error } = await llamar());
  }

  if (error) {
    const r = traducir(String(error.message ?? ""), String((error as { code?: string }).code ?? ""));
    // Si el saldo se fue entre la lectura de arriba y el consumo (una carrera con
    // otra reserva del mismo titular), el 422 igual tiene que llevar los números.
    if (!r.ok && r.codigo === "saldo_insuficiente") {
      const s = await saldoActual(mensualidadId);
      if (s !== null) return { ...r, saldo: s, faltan: Math.max(requeridos - s, 0) };
    }
    return r;
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaRpc | undefined;
  if (!fila) {
    return fail(500, "error", "No pudimos confirmar la reserva. Probá de nuevo.");
  }

  return {
    ok: true,
    data: {
      referencia: fila.referencia_publica,
      fecha: seleccion.fecha,
      hora: seleccion.hora,
      duracion: seleccion.duracion,
      simuladores: seleccion.simuladores,
      minutos_consumidos: Number(fila.minutos_consumidos),
      saldo_restante: Number(fila.saldo_posterior),
      idempotente: Boolean(fila.idempotente),
    },
  };
}
