// Persistencia de los Excel históricos del stand (tabla turnos_historicos).
// La validación vive en lib/historicosStand.ts (pura); acá solo se escribe.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TurnoHistoricoBody = {
  archivo_nombre: string;
  archivo_key: string;
  fecha: string;
  hora_subida?: string;
  hora_bajada?: string;
  hora_tomado?: string;
  metodo_pago: string;
  total: number;
  cantidad_simuladores: number;
  cantidad_turnos: number;
  duracion: number;
  escuderia?: string;
  hash_unico: string;
};

/**
 * Inserta las ventas nuevas e ignora las que ya existen (mismo `hash_unico`).
 * Devuelve cuántas se insertaron: reimportar un archivo con el mismo año da 0.
 */
export async function guardarTurnosHistoricos(
  turnos: TurnoHistoricoBody[],
): Promise<{ ok: true; recibidos: number; insertados: number } | { ok: false; error: unknown }> {
  const rows = turnos.map((t) => ({
    archivo_nombre: t.archivo_nombre,
    archivo_key: t.archivo_key,
    fecha: t.fecha,
    hora_subida: t.hora_subida || null,
    hora_bajada: t.hora_bajada || null,
    hora_tomado: t.hora_tomado || null,
    metodo_pago: t.metodo_pago,
    total: Number(t.total || 0),
    cantidad_simuladores: Number(t.cantidad_simuladores || 1),
    cantidad_turnos: Number(t.cantidad_turnos || 1),
    duracion: Number(t.duracion || 15),
    escuderia: t.escuderia || null,
    hash_unico: t.hash_unico,
    origen: "excel",
  }));

  const { data, error } = await supabaseAdmin
    .from("turnos_historicos")
    .upsert(rows, {
      onConflict: "hash_unico",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) return { ok: false, error };
  return { ok: true, recibidos: rows.length, insertados: (data ?? []).length };
}

/**
 * Borra una importación. Con `anio`, solo las ventas de ese año: el mismo
 * archivo (p. ej. "Turnos Octubre.xlsx") puede estar cargado en dos años.
 */
export async function borrarImportacionHistorica(
  archivoKey: string,
  anio: number | null,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let query = supabaseAdmin.from("turnos_historicos").delete().eq("archivo_key", archivoKey);
  if (anio != null) query = query.like("fecha", `${anio}-%`);
  const { error } = await query;
  if (error) return { ok: false, error };
  return { ok: true };
}
