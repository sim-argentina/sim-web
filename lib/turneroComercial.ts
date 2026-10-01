// ============================================================================
// Turnero del Stand con modalidad comercial (Bloque B8). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// El Turnero es carga manual de la venta presencial: personas, minutos por
// persona, pagos libres (efectivo, QR, débito, crédito, transferencia, mixto,
// gratis). Eso NO cambia. Cambia qué se ofrece y cómo se guarda:
//
//   · La modalidad se resuelve UNA vez por alta (modalidadVigente: override >
//     calendario) y se guarda en turnos_stand.modalidad. Editar no la cambia.
//   · legacy (lo que rige hoy, con el override): la experiencia de siempre,
//     minutos libres y "Turnos" a mano. Nada se recalcula.
//   · v2_10: oferta 10/20/30 por persona. cantidad_minutos = minutos por
//     persona (sin buffer: el Stand no ocupa la agenda online) y cantidad_turnos
//     la calcula el servidor: bloques de 10 por persona (2 personas · 20 = 4).
//   · Después de activar v2 todavía pueden llegar productos anteriores (Gift
//     Card o código Empresa de 15/30). Se registran con un flujo EXPLÍCITO
//     ("registro_legacy"): 15 o 30 minutos, turnos de 15. Una carga normal
//     nunca cae en legacy por su duración: 15 no existe en v2 y 30 existe en
//     las dos, así que la duración sola no decide nada.
//   · Pestaña vieja: el alta normal manda la modalidad con la que se armó el
//     formulario (`modalidad_vista`); si no es la vigente, 409 sin escribir.
// ============================================================================

import {
  CATALOGO_ACTUALIZADO, catalogoDe, duracionesPermitidas, esModalidad, precioBaseReserva, turnosComerciales,
  type Modalidad,
} from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";

export const MENSAJE_TURNERO_ACTUALIZADO =
  "Cambió la modalidad comercial. Actualizá el Turnero antes de registrar el turno.";

/** Tope de minutos por persona en una carga v2 (múltiplos de 10). */
export const MINUTOS_MAX_TURNERO_V2 = 120;
/** Personas por turno: los 4 simuladores. */
export const PERSONAS_MAX_TURNERO = 4;

export type CatalogoTurnero = {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad. */
  resuelto_en: string;
  /** Oferta rápida de la modalidad vigente (por persona). */
  duraciones: number[];
  /** Minutos de un turno comercial: 15 legacy, 10 v2. */
  minutos_por_turno: number;
  /** Los de cada modalidad: al EDITAR manda la de la fila, no la vigente. */
  minutos_por_turno_por_modalidad: Record<Modalidad, number>;
  /** Precio de referencia por persona (solo v2; en legacy la pantalla no cambia). */
  precios: Array<{ duracion: number; precio: number }>;
  /** Carga EXPLÍCITA de productos anteriores; solo existe cuando rige v2. */
  legacy: { duraciones: number[]; minutos_por_turno: number } | null;
};

export function catalogoTurneroPara(modalidad: Modalidad, ahora: Date): CatalogoTurnero {
  const duraciones = [...duracionesPermitidas(modalidad, "reserva")];
  return {
    modalidad,
    resuelto_en: ahora.toISOString(),
    duraciones,
    minutos_por_turno: catalogoDe(modalidad).minutosPorTurno,
    minutos_por_turno_por_modalidad: { legacy: catalogoDe("legacy").minutosPorTurno, v2_10: catalogoDe("v2_10").minutosPorTurno },
    precios: modalidad === "v2_10"
      ? duraciones.map((d) => ({ duracion: d, precio: precioBaseReserva("v2_10", d, "semana") ?? 0 }))
      : [],
    legacy: modalidad === "v2_10"
      ? { duraciones: [...duracionesPermitidas("legacy", "reserva")], minutos_por_turno: catalogoDe("legacy").minutosPorTurno }
      : null,
  };
}

export async function catalogoTurneroVigente(ahora: Date = new Date()): Promise<CatalogoTurnero> {
  const { modalidad } = await modalidadVigente(ahora);
  return catalogoTurneroPara(modalidad, ahora);
}

export type FalloTurnero = { ok: false; status: number; codigo: string; error: string; catalogo?: CatalogoTurnero };
export type CamposTurnero = {
  modalidad: Modalidad;
  cantidad_personas: number;
  cantidad_minutos: number;
  cantidad_turnos: number;
};

const fail = (status: number, codigo: string, error: string): FalloTurnero => ({ ok: false, status, codigo, error });

function personasValidas(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= PERSONAS_MAX_TURNERO ? n : null;
}

/** v2: minutos por persona múltiplos de 10; turnos = bloques de 10 por persona (servidor). */
function camposV2(body: Record<string, unknown>): { ok: true; campos: CamposTurnero } | FalloTurnero {
  const personas = personasValidas(body.cantidad_personas);
  if (personas === null) return fail(422, "personas_invalidas", `Elegí entre 1 y ${PERSONAS_MAX_TURNERO} personas.`);
  const minutos = Number(body.cantidad_minutos);
  if (!Number.isInteger(minutos) || minutos < 10 || minutos > MINUTOS_MAX_TURNERO_V2 || minutos % 10 !== 0) {
    return fail(422, "minutos_invalidos",
      "En la oferta actual los turnos son de 10, 20 o 30 minutos por persona (o múltiplos de 10). Si es un producto anterior de 15 o 30 minutos (Gift Card o código), registralo como producto anterior.");
  }
  const turnos = turnosComerciales("v2_10", minutos, personas) ?? 0;
  return { ok: true, campos: { modalidad: "v2_10", cantidad_personas: personas, cantidad_minutos: minutos, cantidad_turnos: turnos } };
}

/** Producto anterior registrado a propósito: 15 o 30 por persona, turnos de 15 (servidor). */
function camposLegacyExplicito(body: Record<string, unknown>): { ok: true; campos: CamposTurnero } | FalloTurnero {
  const personas = personasValidas(body.cantidad_personas);
  if (personas === null) return fail(422, "personas_invalidas", `Elegí entre 1 y ${PERSONAS_MAX_TURNERO} personas.`);
  const minutos = Number(body.cantidad_minutos);
  const permitidas = duracionesPermitidas("legacy", "reserva");
  if (!permitidas.includes(minutos)) {
    return fail(422, "minutos_invalidos", `Un producto anterior es de ${permitidas.join(" o ")} minutos por persona.`);
  }
  const turnos = turnosComerciales("legacy", minutos, personas) ?? 0;
  return { ok: true, campos: { modalidad: "legacy", cantidad_personas: personas, cantidad_minutos: minutos, cantidad_turnos: turnos } };
}

/** legacy normal: EXACTAMENTE lo de siempre (minutos y turnos como vienen, con los mismos defaults). */
function camposLegacyComoSiempre(body: Record<string, unknown>): CamposTurnero {
  return {
    modalidad: "legacy",
    cantidad_personas: Number(body.cantidad_personas) || 1,
    cantidad_minutos: Number(body.cantidad_minutos) || 15,
    cantidad_turnos: Number(body.cantidad_turnos) || 1,
  };
}

/**
 * Alta de un turno. La modalidad la decide el servidor (vigente, o legacy si el
 * operador eligió a propósito "producto anterior"); el cuerpo solo informa con
 * qué catálogo se armó el formulario.
 */
export async function prepararAltaTurnero(
  body: Record<string, unknown>,
  opts: { ahora?: Date } = {},
): Promise<{ ok: true; campos: CamposTurnero } | FalloTurnero> {
  const catalogo = await catalogoTurneroVigente(opts.ahora ?? new Date());
  if (body.registro_legacy === true) {
    // Solo tiene sentido cuando rige v2; con legacy vigente es el alta normal.
    if (catalogo.modalidad === "legacy") return { ok: true, campos: camposLegacyComoSiempre(body) };
    return camposLegacyExplicito(body);
  }
  // Sin el campo es una pestaña anterior a B8, que solo conocía legacy.
  const vista = body.modalidad_vista === undefined ? "legacy" : body.modalidad_vista;
  if (!esModalidad(vista)) return fail(400, "modalidad_invalida", "Modalidad inválida.");
  if (vista !== catalogo.modalidad) {
    return { ...fail(CATALOGO_ACTUALIZADO.status, CATALOGO_ACTUALIZADO.codigo, MENSAJE_TURNERO_ACTUALIZADO), catalogo };
  }
  if (catalogo.modalidad === "v2_10") return camposV2(body);
  return { ok: true, campos: camposLegacyComoSiempre(body) };
}

/**
 * Edición: la modalidad es la de la FILA y no cambia. Una fila v2 vuelve a
 * validar y recalcula sus turnos; una legacy (NULL o 'legacy') se guarda como
 * siempre, sin reinterpretar nada.
 */
export function prepararEdicionTurnero(
  body: Record<string, unknown>,
  modalidadFila: Modalidad,
): { ok: true; campos: Omit<CamposTurnero, "modalidad"> } | FalloTurnero {
  if (modalidadFila === "v2_10") {
    const r = camposV2(body);
    if (!r.ok) return r;
    const { modalidad: _m, ...campos } = r.campos;
    void _m;
    return { ok: true, campos };
  }
  const { modalidad: _m, ...campos } = camposLegacyComoSiempre(body);
  void _m;
  return { ok: true, campos };
}
