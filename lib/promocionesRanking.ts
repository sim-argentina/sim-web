// ============================================================================
// Promociones: ranking de clientes del Turnero (Bloque B9). Módulo PURO.
// ----------------------------------------------------------------------------
// Antes se rankeaba por SUM(cantidad_turnos). Con v2 eso mezcla unidades: un
// turno legacy son 15 minutos y uno v2, 10. Ahora la actividad se mide en
// MINUTOS COMERCIALES, comparables entre modalidades (30 legacy = 30 v2):
//   · fila legacy (NULL o 'legacy'): (cantidad_turnos || 1) × 15 — el mismo
//     fallback que usaba Promociones, así que con datos legacy el ranking y los
//     totales son exactamente los de antes (×15);
//   · fila v2_10: minutos por persona × personas (sin buffer).
//
// El umbral de la pantalla ("Turnos necesarios") no se persiste en ninguna
// tabla: es un filtro. Conserva su contrato histórico, 1 turno = 15 minutos de
// actividad, y se compara en minutos (turnos × 15). Con datos legacy da
// exactamente lo mismo que antes; con v2, una sesión de 30 cuenta igual que una
// legacy de 30.
// ============================================================================

import { minutosComercialesStand, type FilaStand } from "@/lib/metricasStand";
import { MINUTOS_TURNO_LEGACY, modalidadDeFila } from "@/lib/minutosComerciales";

/** Contrato histórico del umbral de Promociones: 1 turno = 15 minutos. */
export const MINUTOS_POR_TURNO_PROMO = MINUTOS_TURNO_LEGACY;

export type RegistroPromo = FilaStand & {
  nombre?: unknown;
  telefono?: unknown;
  fecha?: unknown;
  total?: unknown;
};

export type ClientePromo = {
  nombre: string;
  telefono: string;
  /** Minutos comerciales del período (la unidad del ranking). */
  minutos: number;
  /** minutos / 15: el "turno" histórico de la promo (puede tener decimales con v2). */
  turnos_equivalentes: number;
  /** Compatibilidad con pantallas anteriores: igual a turnos_equivalentes. */
  cantidad_turnos: number;
  total_gastado: number;
  ultimo_turno: string;
};

/** Minutos comerciales de un registro del Turnero para Promociones. */
export function minutosPromoDeRegistro(t: RegistroPromo): number {
  if (modalidadDeFila(t.modalidad) === "v2_10") return minutosComercialesStand(t);
  return (Number(t.cantidad_turnos) || 1) * MINUTOS_TURNO_LEGACY;
}

const soloDigitos = (s: string) => s.replace(/\D/g, "");
const redondear1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Agrupa por persona (nombre + teléfono normalizados, como siempre) y ordena por
 * minutos comerciales. Con búsqueda (2+ caracteres) devuelve solo coincidencias
 * (hasta maxBusqueda); sin búsqueda, el Top N.
 */
export function rankingPromociones(
  filas: RegistroPromo[],
  opts: { q?: string; topN?: number; maxBusqueda?: number } = {},
): ClientePromo[] {
  type Acum = ClientePromo & { nombre_norm: string; telefono_norm: string };
  const map = new Map<string, Acum>();

  for (const t of filas) {
    const nombre = String(t.nombre ?? "").trim().replace(/\s+/g, " ");
    const telefono = String(t.telefono ?? "").trim();
    // Excluye nombre/teléfono null, vacíos o solo espacios.
    if (!nombre || !telefono) continue;

    const nombreNorm = nombre.toLowerCase();
    const telefonoNorm = soloDigitos(telefono) || telefono.toLowerCase();
    const clave = `${nombreNorm}|${telefonoNorm}`;
    const minutos = minutosPromoDeRegistro(t);
    const monto = Number(t.total || 0);
    const fecha = String(t.fecha ?? "");

    const actual = map.get(clave);
    if (!actual) {
      map.set(clave, {
        nombre, telefono, nombre_norm: nombreNorm, telefono_norm: telefonoNorm,
        minutos, turnos_equivalentes: 0, cantidad_turnos: 0, total_gastado: monto, ultimo_turno: fecha,
      });
    } else {
      actual.minutos += minutos;
      actual.total_gastado += monto;
      if (fecha > actual.ultimo_turno) actual.ultimo_turno = fecha;
    }
  }

  let clientes = Array.from(map.values());
  clientes.sort((a, b) => b.minutos - a.minutos);

  const q = (opts.q ?? "").trim();
  if (q.length >= 2) {
    const qLower = q.toLowerCase();
    const qDigits = soloDigitos(q);
    clientes = clientes
      .filter((c) => c.nombre_norm.includes(qLower) || (qDigits.length > 0 && c.telefono_norm.includes(qDigits)))
      .slice(0, opts.maxBusqueda ?? 50);
  } else {
    clientes = clientes.slice(0, opts.topN ?? 10);
  }

  return clientes.map((c) => {
    const turnos = redondear1(c.minutos / MINUTOS_POR_TURNO_PROMO);
    return {
      nombre: c.nombre,
      telefono: c.telefono,
      minutos: c.minutos,
      turnos_equivalentes: turnos,
      cantidad_turnos: turnos,
      total_gastado: c.total_gastado,
      ultimo_turno: c.ultimo_turno,
    };
  });
}
