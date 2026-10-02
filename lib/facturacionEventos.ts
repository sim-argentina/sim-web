// Fuente CANÓNICA de facturación de SIM, del lado de TypeScript.
//
// Este módulo NO enumera fuentes. La composición vive en un solo lugar, la
// función SQL `fin_eventos_facturacion` (db/facturacion-eventos-canonica.sql):
// turnos del stand, reservas web pagadas, gift cards, campeonatos,
// mensualidades, ingresos manuales operativos y cualquier fuente que se agregue
// ahí en el futuro. Si mañana entra una fuente nueva, aparece acá sola.
//
// Queda afuera siempre, porque la función no las emite: transferencias entre
// cuentas, préstamos, ajustes de saldo, egresos, el Colectivo y todo registro
// cancelado, anulado o no pagado.
//
// Solo lectura.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ClaseFacturacion = "automatico" | "manual";

// El catálogo de fuentes vive aparte para que lo puedan usar validaciones puras
// (sin base de datos). Se re-exporta acá por comodidad de quien ya lee eventos.
export { FUENTES_FACTURACION, type FuenteFacturacion } from "@/lib/facturacionFuentes";

export type EventoFacturacion = {
  fuente: string;
  clase: ClaseFacturacion;
  fechaContable: string; // YYYY-MM-DD, ya en fecha contable de Argentina
  metodo: string;
  monto: number;
  cantidad: number;
  eventoId: string; // estable: permite deduplicar sin mirar el contenido
};

const PAGINA = 1000;

// Lee los eventos de facturación de un rango de fechas contables (inclusive).
// Pagina: un rango largo puede superar el tope de filas de PostgREST y una
// respuesta truncada en silencio daría un total menor al real.
export async function leerEventosFacturacion(desde: string, hasta: string): Promise<EventoFacturacion[]> {
  const out: EventoFacturacion[] = [];
  const vistos = new Set<string>();
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await supabaseAdmin
      .rpc("fin_eventos_facturacion", { p_desde: desde, p_hasta: hasta })
      .select("fuente, clase, fecha_contable, metodo, monto, cantidad, evento_id")
      .order("fecha_contable", { ascending: true })
      .order("evento_id", { ascending: true })
      .range(from, from + PAGINA - 1);
    if (error) throw error;
    const filas = (data ?? []) as Array<Record<string, unknown>>;
    for (const f of filas) {
      const eventoId = String(f.evento_id ?? "");
      // Deduplicación por identificador estable: un mismo evento contable no
      // puede sumar dos veces (ni por paginación ni por un reflejo financiero).
      if (eventoId && vistos.has(eventoId)) continue;
      if (eventoId) vistos.add(eventoId);
      out.push({
        fuente: String(f.fuente ?? ""),
        clase: f.clase === "manual" ? "manual" : "automatico",
        fechaContable: String(f.fecha_contable ?? "").slice(0, 10),
        metodo: String(f.metodo ?? "").trim() || "desconocido",
        monto: Number(f.monto) || 0,
        cantidad: Number(f.cantidad) || 0,
        eventoId,
      });
    }
    if (filas.length < PAGINA) break;
  }
  return out;
}

// Fuentes presentes en un conjunto de eventos, ordenadas por importe. Sirve
// para explicarle al usuario qué fuentes hay cuando pidió filtrar por una que
// en ese período no tiene movimientos — sin mantener ninguna lista fija.
export function fuentesPresentes(eventos: EventoFacturacion[]): string[] {
  const porFuente = new Map<string, number>();
  for (const e of eventos) porFuente.set(e.fuente, (porFuente.get(e.fuente) ?? 0) + e.monto);
  return [...porFuente.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
}
