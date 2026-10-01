// ============================================================================
// Empresas con modalidad comercial (Bloque B7). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// El producto B2B no cambia: campaña, códigos, canje con total 0, sin Mercado
// Pago y sin Finanzas automáticas. Cambia la AGENDA del canje:
//
//   · La modalidad se resuelve UNA vez, al CREAR la campaña (modalidadVigente,
//     override > calendario), y se guarda en empresa_campanias.modalidad_comercial.
//     No se recalcula nunca: ni al editar, ni al canjear, ni al reprogramar.
//     NULL = campaña histórica = legacy.
//   · El canje usa la modalidad de la CAMPAÑA; la reprogramación, la de la
//     RESERVA (reservas.modalidad). Nunca el reloj.
//   · La disponibilidad sale del motor B2 con el producto "empresa" y la
//     duración de la campaña: legacy = grilla de 20 y bloques (15→20, 30→40);
//     v2_10 = grilla de 10 y duración + 10 (10→20, 20→30, 30→40). El navegador
//     ya no calcula nada: pide los horarios a este módulo.
//   · La garantía final contra carreras sigue siendo la base: la RPC toma el
//     código FOR UPDATE y el índice único + trigger B1 rechazan el solapamiento
//     dentro de la misma transacción.
// ============================================================================

import {
  CATALOGO_ACTUALIZADO, duracionPermitida, duracionesPermitidas, esModalidad, type Modalidad,
} from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";
import { bloquesLegacy, minutosDeHora, turnoPara } from "@/lib/agendaIntervalos";
import { RECURSOS_AGENDA, horariosConLibres } from "@/lib/disponibilidadIntervalos";
import { cargarFuentesAgenda, disponibilidadDesdeFuentes } from "@/lib/disponibilidadIntervalosServer";
import { ZONA_SIM, hoyEnSim } from "@/lib/agenda";

/** El 409 del alta desde el panel: el formulario se armó con otro catálogo. */
export const MENSAJE_EMPRESAS_ACTUALIZADAS_ADMIN =
  "Cambió la modalidad comercial. Revisá las duraciones antes de crear la campaña.";

export type FalloEmpresas = { ok: false; status: number; codigo: string; error: string };
const fail = (status: number, codigo: string, error: string): FalloEmpresas => ({ ok: false, status, codigo, error });

/** Modalidad PERSISTIDA de una campaña o una reserva: NULL (histórica) o 'legacy' → legacy; 'v2_10' → v2_10. */
export function modalidadGuardada(valor: unknown): Modalidad {
  return valor === "v2_10" ? "v2_10" : "legacy";
}

/** Duraciones que puede tener una campaña NUEVA de esa modalidad: las de Reservas. */
export function duracionesEmpresa(modalidad: Modalidad): number[] {
  return [...duracionesPermitidas(modalidad, "reserva")];
}

export function duracionEmpresaValida(modalidad: Modalidad, duracion: unknown): boolean {
  return duracionPermitida(modalidad, "reserva", duracion);
}

/** "Elegí una duración de 15 o 30 minutos." / "… de 10, 20 o 30 minutos." */
export function mensajeDuracionEmpresa(modalidad: Modalidad): string {
  const v = duracionesEmpresa(modalidad);
  const lista = v.length === 1 ? String(v[0]) : `${v.slice(0, -1).join(", ")} o ${v[v.length - 1]}`;
  return `Elegí una duración de ${lista} minutos.`;
}

export type CatalogoEmpresas = {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad. */
  resuelto_en: string;
  duraciones: number[];
};

export function catalogoEmpresasPara(modalidad: Modalidad, ahora: Date): CatalogoEmpresas {
  return { modalidad, resuelto_en: ahora.toISOString(), duraciones: duracionesEmpresa(modalidad) };
}

/** El catálogo VIGENTE para crear campañas: resuelve la modalidad en este request. */
export async function catalogoEmpresasVigente(ahora: Date = new Date()): Promise<CatalogoEmpresas> {
  const { modalidad } = await modalidadVigente(ahora);
  return catalogoEmpresasPara(modalidad, ahora);
}

/**
 * La modalidad con la que se CREA una campaña en este request, contrastada con
 * la que vio el formulario (`modalidad_vista`). Sin el campo es una pestaña
 * anterior a B7, que solo conocía legacy. Un valor que no es una modalidad →
 * 400; otra modalidad → 409 con el catálogo vigente, antes de escribir nada.
 */
export async function modalidadParaNuevaCampania(
  body: unknown,
  opts: { ahora?: Date } = {},
): Promise<{ ok: true; catalogo: CatalogoEmpresas } | (FalloEmpresas & { catalogo: CatalogoEmpresas })> {
  const catalogo = await catalogoEmpresasVigente(opts.ahora ?? new Date());
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const vista = b.modalidad_vista === undefined ? "legacy" : b.modalidad_vista;
  if (!esModalidad(vista)) return { ...fail(400, "modalidad_invalida", "Modalidad inválida."), catalogo };
  if (vista !== catalogo.modalidad) {
    return { ...fail(CATALOGO_ACTUALIZADO.status, CATALOGO_ACTUALIZADO.codigo, MENSAJE_EMPRESAS_ACTUALIZADAS_ADMIN), catalogo };
  }
  return { ok: true, catalogo };
}

// ── Agenda (motor B2) ───────────────────────────────────────────────────────

/** Minuto del día en la zona de SIM. */
function minutoEnSim(ahora: Date): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA_SIM, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(ahora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return valor("hour") * 60 + valor("minute");
}

/** ¿Ese inicio ya pasó en SIM? Días anteriores a hoy y, hoy, hasta el minuto actual. */
export function inicioYaPaso(fecha: string, hora: string, ahora: Date): boolean {
  const hoy = hoyEnSim(ahora);
  if (fecha !== hoy) return fecha < hoy;
  const inicio = minutosDeHora(hora);
  return inicio === null || inicio <= minutoEnSim(ahora);
}

export type HorarioEmpresa = { hora: string; simuladores: string[] };

type ArgsAgenda = {
  modalidad: Modalidad;
  fecha: string;
  duracion: number;
  ahora: Date;
  /** Público: sin inicios pasados. El panel puede reprogramar a cualquier fecha. */
  soloFuturos: boolean;
  /** La reserva que se reprograma: su lugar actual también le sirve. */
  excluirReservaId?: number | string;
};

/**
 * Inicios con al menos un simulador libre durante TODO el turno (ocupación con
 * buffer), sin bloqueo, para la modalidad y la duración dadas. La ocupación
 * incluye todos los orígenes: web legacy y v2, Mensualidades, Empresas y
 * pendientes de pago vigentes.
 */
export async function horariosEmpresa(args: ArgsAgenda): Promise<HorarioEmpresa[]> {
  const { modalidad, fecha, duracion, ahora } = args;
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
    modalidad, producto: "empresa", fecha, duracion, ahora,
  });
  return horariosConLibres(disponibilidad)
    .filter((h) => !args.soloFuturos || !inicioYaPaso(fecha, h.hora, ahora))
    .map((h) => ({ hora: h.hora, simuladores: [...h.libres] }));
}

/**
 * ¿Se puede tomar ESE turno con ESOS simuladores? Devuelve los bloques de 20
 * que necesita la RPC legacy (en v2 no hay bloques: una fila por simulador con
 * ocupacion_min). Es una comprobación temprana: la base vuelve a decidir.
 */
export async function evaluarTurnoEmpresa(args: ArgsAgenda & {
  hora: string;
  simuladores: readonly string[];
}): Promise<{ ok: true; bloques: string[] } | FalloEmpresas> {
  const { modalidad, fecha, hora, duracion, simuladores, ahora } = args;
  const turno = turnoPara({ modalidad, producto: "empresa", fecha, hora, duracion });
  if (!turno) return fail(422, "horario_invalido", "Ese horario no está disponible para esta experiencia.");
  if (args.soloFuturos && inicioYaPaso(fecha, turno.hora, ahora)) {
    return fail(409, "horario_pasado", "Ese horario ya pasó. Elegí otro.");
  }
  if (simuladores.length < 1 || simuladores.length > RECURSOS_AGENDA.length
    || new Set(simuladores).size !== simuladores.length
    || simuladores.some((s) => !RECURSOS_AGENDA.includes(s))) {
    return fail(400, "simuladores_invalidos", "Elegí un simulador válido.");
  }
  const horarios = await horariosEmpresa(args);
  const h = horarios.find((x) => x.hora === turno.hora);
  if (!h || !simuladores.every((s) => h.simuladores.includes(s))) {
    return fail(409, "turno_ocupado", "Ese horario ya no está disponible.");
  }
  return { ok: true, bloques: modalidad === "legacy" ? bloquesLegacy(turno) : [] };
}
