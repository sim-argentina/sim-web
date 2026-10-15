// Datos del Informe del evento del Colectivo (server-only). ÚNICA fuente para la
// pantalla (GET /eventos/[id]/informe) y el PDF (GET /eventos/[id]/informe/pdf):
// las dos rutas consumen exactamente este resultado, así que siempre cierran
// entre sí. Las cifras las arma armarInformeEvento con las reglas de la caja.
//
// El informe del Colectivo es interno y no forma parte de Finanzas SIM: no lee
// ni escribe nada de fin_*.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { armarInformeEvento, COLUMNAS_GASTO_COLECTIVO, type InformeEvento, type TipoCaja } from "@/lib/colectivo";

export type EventoInforme = {
  id: string; nombre: string; fecha_inicio: string; fecha_fin: string;
  localidad: string | null; provincia: string | null; ubicacion: string | null; estado: string;
};
export type MovimientoInforme = {
  id: string; fecha: string; categoria_id: string; categoria_nombre: string; tipo: TipoCaja;
  concepto: string; monto: number | string; medio_pago: string; observaciones: string | null; created_at: string;
};
export type DatosInformeEvento = { evento: EventoInforme; informe: InformeEvento; movimientos: MovimientoInforme[] };

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; error: string; detalle?: unknown };

export async function cargarInformeEvento(eventoId: string): Promise<Resultado<DatosInformeEvento>> {
  const [ev, tu, ve, mo] = await Promise.all([
    supabaseAdmin
      .from("colectivo_eventos")
      .select("id, nombre, fecha_inicio, fecha_fin, localidad, provincia, ubicacion, estado")
      .eq("id", eventoId)
      .maybeSingle(),
    supabaseAdmin
      .from("colectivo_turnos")
      .select("total, estado, metodo_pago, pagos_detalle, cantidad_turnos, cantidad_personas, cantidad_minutos")
      .eq("evento_id", eventoId),
    supabaseAdmin
      .from("colectivo_ventas")
      .select("total, estado, metodo_pago, pagos_detalle, producto_nombre, cantidad")
      .eq("evento_id", eventoId),
    // Movimientos vigentes, más reciente primero (orden del detalle).
    supabaseAdmin
      .from("colectivo_gastos")
      .select(COLUMNAS_GASTO_COLECTIVO)
      .eq("evento_id", eventoId)
      .is("eliminado_at", null)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const error = ev.error || tu.error || ve.error || mo.error;
  if (error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: error };
  if (!ev.data) return { ok: false, status: 404, error: "Evento no encontrado" };

  const movimientos = (mo.data ?? []) as MovimientoInforme[];
  const informe = armarInformeEvento({ turnos: tu.data ?? [], ventas: ve.data ?? [], movimientos });
  return { ok: true, valor: { evento: ev.data as EventoInforme, informe, movimientos } };
}
