// Persistencia de los Excel históricos del stand (tabla turnos_historicos).
// La validación y la forma canónica de cada fila viven en lib/historicosStand.ts
// (puro, compartido con el navegador); acá solo se escribe.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filaHistoricaCanonica } from "@/lib/historicosStand";

/**
 * Inserta las ventas nuevas e ignora las que ya existen (mismo `hash_unico`).
 * Cada fila se rearma acá con el pago normalizado y el hash recalculado: el
 * hash que manda el navegador no se usa. Devuelve cuántas se insertaron:
 * reimportar un archivo con el mismo año da 0.
 */
export async function guardarTurnosHistoricos(
  turnos: Record<string, unknown>[],
): Promise<{ ok: true; recibidos: number; insertados: number } | { ok: false; error: unknown }> {
  const porHash = new Map<string, ReturnType<typeof filaHistoricaCanonica>>();
  for (const t of turnos) {
    const fila = filaHistoricaCanonica(t);
    if (!porHash.has(fila.hash_unico)) porHash.set(fila.hash_unico, fila);
  }
  const rows = [...porHash.values()];

  const { data, error } = await supabaseAdmin
    .from("turnos_historicos")
    .upsert(rows, {
      onConflict: "hash_unico",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) return { ok: false, error };
  return { ok: true, recibidos: turnos.length, insertados: (data ?? []).length };
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
