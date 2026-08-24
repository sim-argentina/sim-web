// Configuración POR CAMPEONATO (pura, sin secretos). La usan las APIs, la página
// pública, el admin y los tests. Nada acá está hardcodeado a un campeonato
// puntual (p. ej. "Duelo"): todo se deriva de la configuración de la fila.
//
// Columnas nuevas en `campeonatos`:
//   modalidad             text    default 'liga'   → "liga" | "eliminacion" (extensible)
//   permite_pago_stand    boolean default true     → habilita pago en el stand
//   usa_ronda_preliminar  boolean default false    → ronda preliminar/repechaje
//   config                jsonb   default '{}'      → detalle por modalidad (hora,
//                                                     circuito, premios, reglamento…)
// Se reutiliza `cupos_maximos` (integer, 0 = ilimitado) que ya existía.
//
// Los defaults preservan el comportamiento de los campeonatos históricos:
//   liga + pago en stand permitido + sin preliminar.

export type Modalidad = "liga" | "eliminacion";

export const MODALIDAD_DEFAULT: Modalidad = "liga";
export const MODALIDADES: readonly Modalidad[] = ["liga", "eliminacion"] as const;

export const PERMITE_PAGO_STAND_DEFAULT = true;
export const USA_RONDA_PRELIMINAR_DEFAULT = false;

// Fila (parcial) de campeonatos tal como llega de la DB.
export type CampeonatoConfigRow = {
  modalidad?: string | null;
  permite_pago_stand?: boolean | null;
  usa_ronda_preliminar?: boolean | null;
  cupos_maximos?: number | string | null;
  categorias?: string[] | null;
  config?: Record<string, unknown> | null;
};

export type CampeonatoConfig = {
  modalidad: Modalidad;
  permite_pago_stand: boolean;
  usa_ronda_preliminar: boolean;
  cupos_maximos: number; // 0 = ilimitado
  config: Record<string, unknown>;
};

// ── Normalizadores ────────────────────────────────────────────────────────────

// Cualquier valor desconocido cae a la modalidad por defecto (liga). Solo
// "eliminacion" (exacto) activa el formato de eliminación.
export function normalizarModalidad(v: unknown): Modalidad {
  return v === "eliminacion" ? "eliminacion" : MODALIDAD_DEFAULT;
}

export function esEliminacion(v: unknown): boolean {
  return normalizarModalidad(v) === "eliminacion";
}

// Default true (compatibilidad histórica): SOLO es false si se configuró
// explícitamente `permite_pago_stand = false`.
export function permitePagoStand(row: { permite_pago_stand?: boolean | null }): boolean {
  return row.permite_pago_stand !== false;
}

// Default false: solo true si se configuró explícitamente.
export function usaRondaPreliminar(row: { usa_ronda_preliminar?: boolean | null }): boolean {
  return row.usa_ronda_preliminar === true;
}

// 0 / negativo / vacío / NaN = sin límite (cupos ilimitados).
export function normalizarCupoMaximo(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ¿Queda lugar? cupoMaximo <= 0 ⇒ ilimitado (siempre hay lugar).
// ocupados = inscripciones que ya ocupan cupo (pagadas + pendientes vigentes).
export function hayCupo(cupoMaximo: unknown, ocupados: number): boolean {
  const lim = normalizarCupoMaximo(cupoMaximo);
  if (lim <= 0) return true;
  return ocupados < lim;
}

// ── Pago ──────────────────────────────────────────────────────────────────────

// Métodos que se OFRECEN públicamente. Sin pago en stand → solo Mercado Pago.
export function metodosPagoPublicos(
  row: { permite_pago_stand?: boolean | null },
): Array<"mercadopago" | "stand"> {
  return permitePagoStand(row) ? ["mercadopago", "stand"] : ["mercadopago"];
}

// Gate server-side: ¿este campeonato acepta el método pedido? El pago en stand
// solo se acepta si el campeonato lo habilita. Mercado Pago / online siempre.
export function metodoPagoPermitido(
  row: { permite_pago_stand?: boolean | null },
  metodo: string | null | undefined,
): boolean {
  if (metodo === "stand") return permitePagoStand(row);
  return true; // mercadopago / online / vacío
}

// ── Formulario / contenido según modalidad ────────────────────────────────────

// ¿Se pide escudería favorita? En liga sí (define el ranking de constructores).
// En eliminación no (autos aleatorios). `config.requiere_escuderia` puede forzar.
export function requiereEscuderia(
  row: { modalidad?: string | null; config?: Record<string, unknown> | null },
): boolean {
  const cfg = row.config;
  if (cfg && typeof cfg.requiere_escuderia === "boolean") return cfg.requiere_escuderia;
  return !esEliminacion(row.modalidad);
}

// ¿La página pública muestra los elementos de liga (Oro/Plata/Bronce, Fecha 0,
// puntos de campeonato, penalizaciones traspasadas, calendario largo)?
// Solo en modalidad liga.
export function usaCategoriasLiga(row: { modalidad?: string | null }): boolean {
  return !esEliminacion(row.modalidad);
}

// ── Normalización completa ────────────────────────────────────────────────────

export function normalizarCampeonatoConfig(row: CampeonatoConfigRow): CampeonatoConfig {
  return {
    modalidad: normalizarModalidad(row.modalidad),
    permite_pago_stand: permitePagoStand(row),
    usa_ronda_preliminar: usaRondaPreliminar(row),
    cupos_maximos: normalizarCupoMaximo(row.cupos_maximos),
    config: row.config && typeof row.config === "object" ? row.config : {},
  };
}
