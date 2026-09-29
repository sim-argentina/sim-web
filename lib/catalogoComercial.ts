// ============================================================================
// Catálogo comercial VERSIONADO de SIM (Bloque B0 · turnos 10/20/30).
// ----------------------------------------------------------------------------
// Módulo PURO: sin base, sin red, sin reloj y sin variables de entorno. Lo
// pueden importar el navegador y el servidor. Describe QUÉ se vende en cada
// modalidad; NO decide cuál rige ahora. Eso lo resuelve SOLO el servidor, en
// lib/modalidadComercial.ts: el navegador nunca elige catálogo por su cuenta.
//
// Dos modalidades, cerradas:
//
//   · legacy → la operación vigente hasta el corte, TAL CUAL está hoy en
//              lib/agenda.ts, lib/reservasSlots.ts, lib/giftCards.ts y
//              lib/mensualidades.ts. No se "mejora" nada: la ocupación sigue en
//              bloques de 20 y el turno de 30 sigue costando distinto el finde.
//   · v2_10  → grilla de 10, +10 de buffer operativo, 10/20/30 en los tres
//              productos y el mismo precio los siete días.
//
// (B0) Todavía NO tiene consumidores. Las reglas legacy siguen viviendo también
// en sus módulos de origen, y lib/catalogoComercial.test.ts compara las dos
// copias: falla si una se mueve sin la otra. Los bloques siguientes migran a
// los consumidores de a uno.
//
// Los precios de los PLANES de Mensualidades NO viven acá: su fuente es la base
// (mensualidad_planes y, desde B1, mensualidad_plan_precios versionada).
// ============================================================================

export const MODALIDADES = ["legacy", "v2_10"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

/** ¿Es EXACTAMENTE una modalidad conocida? Sin normalizar: "V2_10" no lo es. */
export function esModalidad(valor: unknown): valor is Modalidad {
  return typeof valor === "string" && (MODALIDADES as readonly string[]).includes(valor);
}

export const PRODUCTOS_COMERCIALES = ["reserva", "mensualidad", "gift_card"] as const;
export type ProductoComercial = (typeof PRODUCTOS_COMERCIALES)[number];

/**
 * Tipo de día para el precio. Lo calcula quien llama (esFinDeSemana de
 * lib/agenda.ts): este módulo no conoce el calendario, solo los precios.
 */
export type TipoDia = "semana" | "finde";

/**
 * Cómo se convierte la duración COMERCIAL en ocupación de agenda.
 *
 *   · bloques (legacy): cada `minutosComerciales` vendidos ocupan un bloque de
 *     `minutosBloque`. Es la regla de hoy: 15→20, 30→40, 45→60, 60→80. El
 *     buffer está implícito y crece con la duración.
 *   · buffer (v2_10): la ocupación es la duración comercial más un buffer fijo.
 *     20 minutos vendidos ocupan 30.
 *
 * En los dos casos el buffer es SOLO capacidad: no se cobra, no descuenta saldo
 * y no es tiempo de uso. La única duración de una operación es la comercial.
 */
export type ReglaOcupacion =
  | { readonly tipo: "bloques"; readonly minutosComerciales: number; readonly minutosBloque: number }
  | { readonly tipo: "buffer"; readonly bufferMin: number };

export type ProductoGiftCard = { readonly duracion: number; readonly monto: number };

export type CatalogoComercial = {
  readonly modalidad: Modalidad;
  /** Separación entre inicios de agenda, en minutos. */
  readonly pasoAgendaMin: number;
  readonly ocupacion: ReglaOcupacion;
  /**
   * Minutos que valen UN turno por persona/simulador. Legacy: 15, el canon de
   * Métricas y del Turnero. v2_10: 10, así que 10→1, 20→2 y 30→3 por persona.
   * Las filas históricas conservan su cantidad_turnos: esto no las recalcula.
   */
  readonly minutosPorTurno: number;
  /** Duraciones que cada producto puede VENDER en esta modalidad. */
  readonly duraciones: Readonly<Record<ProductoComercial, readonly number[]>>;
  /** Precio base de Reserva por simulador, por duración y tipo de día. */
  readonly preciosReserva: Readonly<Record<number, Readonly<Record<TipoDia, number>>>>;
  readonly giftCards: readonly ProductoGiftCard[];
};

/** Congela en profundidad: ningún consumidor puede modificar un catálogo. */
function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor as Record<string, unknown>)) congelar(v);
  }
  return valor;
}

const LEGACY = congelar<CatalogoComercial>({
  modalidad: "legacy",
  pasoAgendaMin: 20,
  ocupacion: { tipo: "bloques", minutosComerciales: 15, minutosBloque: 20 },
  minutosPorTurno: 15,
  duraciones: {
    reserva: [15, 30],
    mensualidad: [15, 30, 45, 60],
    gift_card: [15, 30],
  },
  preciosReserva: {
    15: { semana: 12000, finde: 12000 },
    30: { semana: 18000, finde: 20000 },
  },
  giftCards: [
    { duracion: 15, monto: 12000 },
    { duracion: 30, monto: 20000 },
  ],
});

const V2_10 = congelar<CatalogoComercial>({
  modalidad: "v2_10",
  pasoAgendaMin: 10,
  ocupacion: { tipo: "buffer", bufferMin: 10 },
  minutosPorTurno: 10,
  duraciones: {
    reserva: [10, 20, 30],
    mensualidad: [10, 20, 30],
    gift_card: [10, 20, 30],
  },
  // Sin diferencia semana/finde: el mismo precio los siete días.
  preciosReserva: {
    10: { semana: 10000, finde: 10000 },
    20: { semana: 17000, finde: 17000 },
    30: { semana: 23000, finde: 23000 },
  },
  giftCards: [
    { duracion: 10, monto: 10000 },
    { duracion: 20, monto: 17000 },
    { duracion: 30, monto: 23000 },
  ],
});

/** Los dos catálogos, congelados. */
export const CATALOGOS: Readonly<Record<Modalidad, CatalogoComercial>> = congelar({
  legacy: LEGACY,
  v2_10: V2_10,
});

/** El catálogo de una modalidad. Una modalidad desconocida es un error de programación. */
export function catalogoDe(modalidad: Modalidad): CatalogoComercial {
  if (!esModalidad(modalidad)) {
    throw new Error(`Modalidad comercial desconocida: ${String(modalidad)}`);
  }
  return CATALOGOS[modalidad];
}

/**
 * Entero positivo ESTRICTO, con el mismo criterio que bloquesPara
 * (lib/agenda.ts): " 30 ", "30abc", "0x1E", 30.5 o true no son una duración.
 */
function enteroPositivo(valor: unknown): number | null {
  if (typeof valor === "string") {
    if (!/^\d+$/.test(valor)) return null;
  } else if (typeof valor !== "number") {
    return null;
  }
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Duraciones que ese producto puede vender en esa modalidad. */
export function duracionesPermitidas(
  modalidad: Modalidad,
  producto: ProductoComercial,
): readonly number[] {
  const lista = catalogoDe(modalidad).duraciones[producto];
  if (!lista) throw new Error(`Producto comercial desconocido: ${String(producto)}`);
  return lista;
}

/** ¿Ese producto puede vender esa duración en esa modalidad? */
export function duracionPermitida(
  modalidad: Modalidad,
  producto: ProductoComercial,
  duracion: unknown,
): boolean {
  const d = enteroPositivo(duracion);
  return d !== null && duracionesPermitidas(modalidad, producto).includes(d);
}

/** Separación entre inicios de agenda. */
export function pasoAgendaMin(modalidad: Modalidad): number {
  return catalogoDe(modalidad).pasoAgendaMin;
}

/** Todas las duraciones que la modalidad vende en algún producto. */
function duracionesDeLaModalidad(modalidad: Modalidad): number[] {
  const todas = new Set<number>();
  for (const producto of PRODUCTOS_COMERCIALES) {
    for (const d of duracionesPermitidas(modalidad, producto)) todas.add(d);
  }
  return [...todas].sort((a, b) => a - b);
}

/**
 * Minutos de agenda que ocupa UNA experiencia de esa duración, buffer incluido.
 *
 *   · legacy: solo las duraciones que hoy tienen bloques (15, 30, 45 y 60), con
 *     la misma cuenta que bloquesPara × PASO_AGENDA_MIN. Cualquier otra → null.
 *   · v2_10: duración + buffer, para cualquier entero positivo múltiplo de 5 de
 *     hasta 240. No exige que la duración se VENDA en v2 (eso lo dice
 *     duracionPermitida): una campaña de Empresa legacy de 15 canjeada con la
 *     agenda nueva ocupa 25.
 */
export function ocupacionMinutos(modalidad: Modalidad, duracion: unknown): number | null {
  const d = enteroPositivo(duracion);
  if (d === null) return null;
  const { ocupacion } = catalogoDe(modalidad);
  if (ocupacion.tipo === "bloques") {
    if (!duracionesDeLaModalidad(modalidad).includes(d)) return null;
    if (d % ocupacion.minutosComerciales !== 0) return null;
    return (d / ocupacion.minutosComerciales) * ocupacion.minutosBloque;
  }
  if (d % 5 !== 0 || d > 240) return null;
  return d + ocupacion.bufferMin;
}

/**
 * Buffer operativo de esa duración: ocupación menos duración comercial.
 * legacy: 15→5, 30→10, 45→15, 60→20 (implícito). v2_10: siempre 10.
 */
export function bufferMinutos(modalidad: Modalidad, duracion: unknown): number | null {
  const d = enteroPositivo(duracion);
  const ocupacion = ocupacionMinutos(modalidad, duracion);
  return d === null || ocupacion === null ? null : ocupacion - d;
}

/**
 * Precio BASE de Reserva por simulador. null si esa duración no se vende como
 * Reserva en esa modalidad. Los precios especiales por fecha no viven acá: se
 * aplican encima, en el servidor.
 */
export function precioBaseReserva(
  modalidad: Modalidad,
  duracion: unknown,
  tipoDia: TipoDia,
): number | null {
  if (tipoDia !== "semana" && tipoDia !== "finde") return null;
  const d = enteroPositivo(duracion);
  if (d === null || !duracionPermitida(modalidad, "reserva", d)) return null;
  const precios = catalogoDe(modalidad).preciosReserva[d];
  return precios ? precios[tipoDia] : null;
}

/** Productos de Gift Card que se venden en esa modalidad. */
export function productosGiftCard(modalidad: Modalidad): readonly ProductoGiftCard[] {
  return catalogoDe(modalidad).giftCards;
}

/** El producto de Gift Card de esa duración, o null si esa modalidad no lo vende. */
export function productoGiftCard(modalidad: Modalidad, duracion: unknown): ProductoGiftCard | null {
  const d = enteroPositivo(duracion);
  if (d === null) return null;
  return productosGiftCard(modalidad).find((p) => p.duracion === d) ?? null;
}

/**
 * Turnos comerciales de una venta (la unidad de cantidad_turnos):
 * personas × minutos por persona / minutosPorTurno.
 * legacy: 15→1 y 30→2 por persona. v2_10: 10→1, 20→2 y 30→3 por persona.
 *
 * (B0) Solo fija la semántica aprobada. El Turnero y Métricas la adoptan en B8
 * y las filas históricas conservan la cantidad_turnos que tienen. Puede dar un
 * número fraccionario (una Gift Card legacy de 15 registrada en v2 vale 1,5):
 * redondear o no es una decisión de B8, no de este módulo.
 */
export function turnosComerciales(
  modalidad: Modalidad,
  minutosPorPersona: unknown,
  personas: unknown,
): number | null {
  const m = enteroPositivo(minutosPorPersona);
  const p = enteroPositivo(personas);
  if (m === null || p === null) return null;
  return (p * m) / catalogoDe(modalidad).minutosPorTurno;
}

// ── 409 catalogo_actualizado ────────────────────────────────────────────────
// Contrato para los bloques que venden (B3 en adelante): si el cliente armó la
// compra con una modalidad y al confirmar rige otra, el servidor NO cobra un
// precio que la persona no vio. Responde este 409 y la pantalla recarga el
// catálogo conservando los datos personales que pueda.

export const CATALOGO_ACTUALIZADO = congelar({
  codigo: "catalogo_actualizado",
  status: 409,
  mensaje: "Actualizamos nuestros turnos y precios. Revisá las nuevas opciones para continuar.",
} as const);

/**
 * ¿La modalidad que el cliente VIO es la vigente? Un valor ausente o
 * desconocido cuenta como desactualizado: ante la duda no se cobra.
 */
export function catalogoVistoVigente(vista: unknown, vigente: Modalidad): boolean {
  return esModalidad(vista) && vista === vigente;
}
