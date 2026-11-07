// Tope diario COMPARTIDO de consultas reales a Google Places — SOLO SERVIDOR.
//
// Implementación del Contador de lib/googleReviews.ts sobre Supabase
// (db/google-places-consumo.sql): una fila por fecha de negocio de Argentina,
// que comparten todas las instancias de Vercel. La RPC reserva una llamada de
// forma atómica ANTES de cada consulta a Google (API nueva y respaldo legacy).
//
// Falla CERRADO: si la tabla o la RPC no responden (p. ej. todavía no se aplicó
// la migración), la reserva vuelve "no_operativo" y la consulta pública no se
// hace (la Home muestra solo el enlace a Google Maps). No guarda nada de Google.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import { topeDiario, type Contador, type EstadoContador, type Reserva } from "@/lib/googleReviews";

export const RPC_RESERVAR = "google_places_reservar_llamada";
export const TABLA_CONSUMO = "google_places_consumo";

export function contadorGooglePlaces(tope: number = topeDiario().tope): Contador {
  return {
    tope,
    async reservar(forzar: boolean): Promise<Reserva> {
      try {
        const { data, error } = await supabaseAdmin.rpc(RPC_RESERVAR, { p_tope: tope, p_forzar: forzar });
        if (error) return { ok: false, motivo: "no_operativo" };
        if (data === null || data === undefined) return { ok: false, motivo: "tope" };
        const llamada = Number(data);
        return Number.isInteger(llamada) && llamada >= 1 ? { ok: true, llamada } : { ok: false, motivo: "no_operativo" };
      } catch {
        return { ok: false, motivo: "no_operativo" };
      }
    },
    async leer(): Promise<EstadoContador> {
      const fecha = hoyEnSim(new Date());
      try {
        const { data, error } = await supabaseAdmin.from(TABLA_CONSUMO).select("llamadas").eq("fecha", fecha).maybeSingle();
        if (error) return { operativo: false, fecha, llamadas: null, tope };
        return { operativo: true, fecha, llamadas: Number((data as { llamadas?: number } | null)?.llamadas ?? 0), tope };
      } catch {
        return { operativo: false, fecha, llamadas: null, tope };
      }
    },
  };
}
