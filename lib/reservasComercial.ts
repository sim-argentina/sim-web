// ============================================================================
// Reservas web con modalidad comercial (Bloque B3). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// La única puerta del catálogo, la disponibilidad, el precio y la validación de
// una Reserva web NUEVA. Resuelve la modalidad UNA vez por request con
// modalidadVigente(); una reserva que ya existe usa SIEMPRE la suya
// (reservas.modalidad, NULL = legacy), nunca el reloj.
//
// Antes del corte todo esto responde legacy y tiene que ser EXACTAMENTE lo que
// hacía producción; desde el primer request posterior al corte, v2_10. Nada se
// cachea: cada llamada vuelve a resolver la modalidad.
// ============================================================================

import {
  CATALOGO_ACTUALIZADO, bufferMinutos, catalogoVistoVigente, duracionPermitida,
  duracionesPermitidas, pasoAgendaMin, precioBaseReserva, type Modalidad,
} from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";
import {
  esFinDeSemana, fechaDentroDeVentana, fechaValida, fechasPublicas, hoyEnSim, horariosDe,
} from "@/lib/agenda";
import { iniciosDelDia, type ProductoAgenda } from "@/lib/agendaIntervalos";
import { recursosLibres } from "@/lib/disponibilidadIntervalos";
import {
  cargarFuentesAgenda, disponibilidadDesdeFuentes, type FuentesAgenda,
} from "@/lib/disponibilidadIntervalosServer";
import { getPrecioEspecialCompleto, precioReservaPara } from "@/lib/reservasPricing";
import { validarReservaInput, type ReservaValida } from "@/lib/reservasValidation";

export type Fallo = { ok: false; status: number; error: string; codigo?: string; duraciones?: number[] };
const fail = (status: number, error: string, extra: Partial<Fallo> = {}): Fallo => ({ ok: false, status, error, ...extra });

/** El 409 del contrato de B0: el cliente armó la compra con otro catálogo. */
export const falloCatalogoActualizado = (): Fallo =>
  fail(CATALOGO_ACTUALIZADO.status, CATALOGO_ACTUALIZADO.mensaje, { codigo: CATALOGO_ACTUALIZADO.codigo });

// ── Catálogo ────────────────────────────────────────────────────────────────

export type RangoHorario = { desde: string; hasta: string };

export type CatalogoReservas = {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad (diagnóstico). */
  resuelto_en: string;
  duraciones: number[];
  duracion_inicial: number;
  /** Precio base por simulador (sin precio especial), por tipo de día. */
  precios_base: { semana: Record<string, number>; fin_de_semana: Record<string, number> };
  desde_precio: number;
  /** Separación entre inicios de agenda. */
  paso_min: number;
  /** v2: buffer operativo después del tiempo comercial. legacy: implícito en los bloques. */
  buffer_min: number | null;
  /** Primer y último inicio de un día hábil y de fin de semana (duración más corta). */
  horario: { semana: RangoHorario; fin_de_semana: RangoHorario };
  /** Fechas reservables: de mañana a hoy + 15. */
  ventana: string[];
};

/**
 * Los inicios que se MUESTRAN en un día: legacy, la grilla de 20 de siempre; v2,
 * los inicios de la duración más corta (los de las demás son un subconjunto).
 */
function grillaDelDia(modalidad: Modalidad, fecha: string, duracionMasCorta: number): string[] {
  return modalidad === "legacy"
    ? horariosDe(fecha)
    : iniciosDelDia({ modalidad, producto: "reserva", fecha, duracion: duracionMasCorta }).map((t) => t.hora);
}

function rangoDelDia(modalidad: Modalidad, fecha: string, duracion: number): RangoHorario {
  const horas = grillaDelDia(modalidad, fecha, duracion);
  return { desde: horas[0] ?? "", hasta: horas[horas.length - 1] ?? "" };
}

/** El catálogo de Reservas de una modalidad EXPLÍCITA. No consulta la base. */
export function catalogoPara(modalidad: Modalidad, ahora: Date): CatalogoReservas {
  const ventana = fechasPublicas(hoyEnSim(ahora));
  const duraciones = [...duracionesPermitidas(modalidad, "reserva")];
  const semana: Record<string, number> = {};
  const finde: Record<string, number> = {};
  for (const d of duraciones) {
    semana[d] = precioBaseReserva(modalidad, d, "semana") ?? 0;
    finde[d] = precioBaseReserva(modalidad, d, "finde") ?? 0;
  }
  const habil = ventana.find((f) => !esFinDeSemana(f)) ?? ventana[0];
  const sabado = ventana.find((f) => esFinDeSemana(f)) ?? ventana[0];
  return {
    modalidad,
    resuelto_en: ahora.toISOString(),
    duraciones,
    duracion_inicial: duraciones[0],
    precios_base: { semana, fin_de_semana: finde },
    desde_precio: Math.min(...Object.values(semana), ...Object.values(finde)),
    paso_min: pasoAgendaMin(modalidad),
    buffer_min: modalidad === "v2_10" ? bufferMinutos(modalidad, duraciones[0]) : null,
    horario: {
      semana: rangoDelDia(modalidad, habil, duraciones[0]),
      fin_de_semana: rangoDelDia(modalidad, sabado, duraciones[0]),
    },
    ventana,
  };
}

/** El catálogo VIGENTE: resuelve la modalidad en este request. */
export async function catalogoReservasVigente(ahora: Date = new Date()): Promise<CatalogoReservas> {
  const { modalidad } = await modalidadVigente(ahora);
  return catalogoPara(modalidad, ahora);
}

// ── Disponibilidad pública ──────────────────────────────────────────────────

export type HorarioReserva = { hora: string; disponibles: number; libres: string[] };

export type DisponibilidadReservas = CatalogoReservas & {
  fecha: string;
  duracion: number;
  /** Precio efectivo por simulador para esta fecha y duración (con precio especial). */
  precio: number;
  /** Precio efectivo de cada duración en esta fecha. */
  precios: Record<string, number>;
  /** Precio base de cada duración en esta fecha (sin precio especial). */
  precios_base_dia: Record<string, number>;
  /**
   * Inicios que se muestran, iguales para todas las duraciones del día. Los que
   * no están en `horarios` (no entran con esta duración) salen "Sin lugares".
   */
  grilla: string[];
  /** Inicios válidos para la duración, con los simuladores libres durante TODO el turno. */
  horarios: HorarioReserva[];
};

/**
 * Disponibilidad de Reservas de un día con el motor por intervalos (B2), en la
 * modalidad vigente. Sin `fecha`, el primer día reservable; sin `duracion`, la
 * primera del catálogo: así la página abre con UN request cuyo catálogo y cuya
 * disponibilidad salen de la misma modalidad. 3 consultas para la ocupación +
 * 1 para el precio especial + 1 para el override.
 */
export async function disponibilidadReservas(args: {
  fecha?: string | null;
  duracion?: unknown;
  ahora?: Date;
}): Promise<{ ok: true; data: DisponibilidadReservas } | Fallo> {
  const ahora = args.ahora ?? new Date();
  const { modalidad } = await modalidadVigente(ahora);
  const catalogo = catalogoPara(modalidad, ahora);
  const fecha = args.fecha === undefined || args.fecha === null || args.fecha === ""
    ? catalogo.ventana[0]
    : args.fecha;

  if (!fechaValida(fecha)) return fail(400, "Fecha inválida");
  if (!fechaDentroDeVentana(fecha, hoyEnSim(ahora))) return fail(400, "Fecha fuera del rango disponible");
  const cruda = args.duracion === undefined || args.duracion === null || args.duracion === ""
    ? catalogo.duracion_inicial
    : args.duracion;
  if (!duracionPermitida(modalidad, "reserva", cruda)) {
    return fail(400, "Duración inválida", { duraciones: catalogo.duraciones });
  }
  const duracion = Number(cruda);

  const [fuentes, especial] = await Promise.all([
    cargarFuentesAgenda(fecha, fecha),
    getPrecioEspecialCompleto(fecha),
  ]);
  const { disponibilidad } = disponibilidadDesdeFuentes(fuentes, {
    modalidad, producto: "reserva", fecha, duracion, ahora,
  });

  const precios: Record<string, number> = {};
  const preciosBase: Record<string, number> = {};
  const tipo = esFinDeSemana(fecha) ? "finde" : "semana";
  for (const d of catalogo.duraciones) {
    precios[d] = precioReservaPara(modalidad, fecha, d, especial) ?? 0;
    preciosBase[d] = precioBaseReserva(modalidad, d, tipo) ?? 0;
  }
  const horarios = disponibilidad.horarios.map((h) => ({
    hora: h.hora, disponibles: h.libres.length, libres: h.libres,
  }));

  return {
    ok: true,
    data: {
      ...catalogo,
      fecha,
      duracion,
      precio: precios[duracion],
      precios,
      precios_base_dia: preciosBase,
      grilla: grillaDelDia(modalidad, fecha, Math.min(...catalogo.duraciones)),
      horarios,
    },
  };
}

// ── Pedido de una Reserva web NUEVA ─────────────────────────────────────────

export type PedidoReservaWeb = ReservaValida & {
  modalidad: Modalidad;
  /** Instante con el que se resolvió la modalidad. */
  resuelto_en: string;
};

/**
 * Resuelve la modalidad UNA vez y valida el pedido con SUS reglas. No escribe.
 *
 * `modalidad_vista` es el catálogo que el navegador mostró. Si no coincide con
 * el vigente → 409 catalogo_actualizado, antes de crear nada. Un cliente sin el
 * campo es anterior a B3 y solo pudo ver legacy: se lo trata como 'legacy'.
 */
export async function prepararReservaWeb(
  body: unknown,
  opts: { ahora?: Date } = {},
): Promise<{ ok: true; pedido: PedidoReservaWeb } | Fallo> {
  const ahora = opts.ahora ?? new Date();
  const { modalidad } = await modalidadVigente(ahora);
  const b = (body ?? {}) as Record<string, unknown>;

  const vista = b.modalidad_vista === undefined ? "legacy" : b.modalidad_vista;
  if (!catalogoVistoVigente(vista, modalidad)) return falloCatalogoActualizado();

  const v = validarReservaInput(body, { hoy: hoyEnSim(ahora), modalidad });
  if (!v.ok) return fail(400, v.error);
  return { ok: true, pedido: { ...v.value, modalidad, resuelto_en: ahora.toISOString() } };
}

/**
 * Precio server-side del pedido por SU modalidad (precio especial incluido).
 * El total del cliente nunca se usa para cobrar. Si el navegador manda el
 * precio unitario que mostró (`precio_visto`) y no coincide → 409: no se cobra
 * en silencio un precio que la persona no vio.
 */
export async function precioDelPedido(
  pedido: PedidoReservaWeb,
  body: unknown,
): Promise<{ ok: true; precioUnitario: number; totalOriginal: number } | Fallo> {
  const especial = await getPrecioEspecialCompleto(pedido.fecha);
  const unitario = precioReservaPara(pedido.modalidad, pedido.fecha, pedido.duracion, especial);
  if (unitario === null || !Number.isFinite(unitario)) {
    return fail(400, "No se pudo calcular el precio de la reserva");
  }
  const visto = (body as Record<string, unknown> | null)?.precio_visto;
  if (visto !== undefined && visto !== null && Number(visto) !== unitario) return falloCatalogoActualizado();
  return { ok: true, precioUnitario: unitario, totalOriginal: unitario * pedido.simuladores.length };
}

export type VeredictoPedido = {
  /** Algún simulador pedido cae en un bloqueo aplicable (→ 400, como siempre). */
  bloqueado: boolean;
  /** El turno no está libre para los simuladores pedidos (→ 409), o null. */
  ocupado: Fallo | null;
};

/**
 * Bloqueos + ocupación del turno pedido con el motor B2 en la modalidad del
 * pedido: cada simulador tiene que estar libre durante TODO [inicio, fin de
 * ocupación). `excluirReservaId` saca de la cuenta a la reserva misma (sirve
 * para reactivarla). La garantía final contra carreras sigue siendo la base.
 */
export async function evaluarTurno(
  args: {
    modalidad: Modalidad;
    /** Reglas de grilla del turno. Por defecto, Reservas. */
    producto?: ProductoAgenda;
    fecha: string;
    hora: string;
    duracion: number;
    simuladores: readonly string[];
    ahora?: Date;
    excluirReservaId?: number | string;
  },
  fuentesPrevias?: FuentesAgenda,
): Promise<VeredictoPedido> {
  const ahora = args.ahora ?? new Date();
  let fuentes = fuentesPrevias ?? await cargarFuentesAgenda(args.fecha, args.fecha);
  if (args.excluirReservaId !== undefined) {
    const propio = String(args.excluirReservaId);
    fuentes = {
      ...fuentes,
      reservas: fuentes.reservas.filter((r) => String(r.id) !== propio),
      slots: fuentes.slots.filter((s) => String(s.reserva_id) !== propio),
    };
  }
  const { disponibilidad } = disponibilidadDesdeFuentes(fuentes, {
    modalidad: args.modalidad, producto: args.producto ?? "reserva", fecha: args.fecha, duracion: args.duracion, ahora,
  });
  const h = disponibilidad.horarios.find((x) => x.hora === args.hora);
  if (!h) return { bloqueado: false, ocupado: fail(409, "Ese horario no está disponible.") };
  const bloqueado = h.recursos.some((e) => e.bloqueado && args.simuladores.includes(e.recurso));
  if (h.libres.length === 0) return { bloqueado, ocupado: fail(409, "Ese horario no está disponible.") };
  if (!recursosLibres(h, args.simuladores)) {
    return { bloqueado, ocupado: fail(409, "Uno o más simuladores ya están reservados en ese horario") };
  }
  return { bloqueado, ocupado: null };
}

/** El turno del pedido, evaluado con SU modalidad. */
export function evaluarPedido(pedido: PedidoReservaWeb, ahora?: Date): Promise<VeredictoPedido> {
  return evaluarTurno({
    modalidad: pedido.modalidad, fecha: pedido.fecha, hora: pedido.hora,
    duracion: pedido.duracion, simuladores: pedido.simuladores, ahora,
  });
}

/** La fila de `reservas` de un pedido nuevo: persiste su modalidad explícita. */
export function filaReservaWeb(
  pedido: PedidoReservaWeb,
  datos: {
    estado: "activa" | "pendiente_pago";
    total: number;
    total_original: number;
    descuento_aplicado: number;
    codigo_descuento: string | null;
  },
): Record<string, unknown> {
  return {
    nombre: pedido.nombre,
    telefono: pedido.telefono,
    fecha: pedido.fecha,
    hora: pedido.hora,
    simuladores: pedido.simuladores,
    cantidad_turnos: pedido.simuladores.length,
    total: datos.total,
    total_original: datos.total_original,
    descuento_aplicado: datos.descuento_aplicado,
    codigo_descuento: datos.codigo_descuento,
    estado: datos.estado,
    acepto_condiciones: true,
    duracion_minutos: pedido.duracion,
    modalidad: pedido.modalidad,
  };
}
