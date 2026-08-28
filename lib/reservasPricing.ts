// Fuente ÚNICA del precio de reserva (server-side). Regla:
//   1) si hay precio especial para la fecha y esa duración → usarlo;
//   2) si no → precio normal vigente (precioPorSimulador, sin cambios);
//   3) nunca se confía en el precio enviado por el frontend.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { precioPorSimulador } from "@/lib/reservasSlots";

export type PrecioEspecial = { precio_15: number | null; precio_30: number | null };

// Resolución PURA (testeable): elige el override si existe para la duración, si no el
// precio normal (calculado por `normal`). 15 min usa precio_15; ≥30 usa precio_30.
export function resolverPrecioReserva(
  especial: PrecioEspecial | null,
  fecha: string,
  duracion: number,
  normal: (fecha: string, duracion: number) => number = precioPorSimulador,
): number {
  const usa30 = Number(duracion) >= 30;
  const override = especial ? (usa30 ? especial.precio_30 : especial.precio_15) : null;
  if (override != null && Number.isFinite(Number(override)) && Number(override) >= 0) {
    return Math.round(Number(override));
  }
  return normal(fecha, duracion);
}

// Lee el precio especial de una fecha (o null). Solo servidor.
export async function getPrecioEspecial(fecha: string): Promise<PrecioEspecial | null> {
  const { data } = await supabaseAdmin
    .from("reservas_precios_especiales")
    .select("precio_15, precio_30")
    .eq("fecha", fecha)
    .maybeSingle();
  if (!data) return null;
  return {
    precio_15: data.precio_15 != null ? Number(data.precio_15) : null,
    precio_30: data.precio_30 != null ? Number(data.precio_30) : null,
  };
}

// Precio POR SIMULADOR para (fecha, duración): especial si existe, si no el normal.
export async function getPrecioReserva(fecha: string, duracion: number): Promise<number> {
  const especial = await getPrecioEspecial(fecha);
  return resolverPrecioReserva(especial, fecha, duracion);
}

// Ambos precios efectivos de una fecha (para mostrar en la web pública). Sin PII.
export async function getPreciosEfectivos(fecha: string): Promise<{ precio_15: number; precio_30: number }> {
  const especial = await getPrecioEspecial(fecha);
  return {
    precio_15: resolverPrecioReserva(especial, fecha, 15),
    precio_30: resolverPrecioReserva(especial, fecha, 30),
  };
}
