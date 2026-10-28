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

export type ImportacionResumen = {
  archivo_key: string;
  archivo_nombre: string;
  anio: string;
  /** Meses ("01".."12") con ventas de ese archivo en ese año. */
  meses: string[];
  ventas: number;
  facturacion: number;
};

/**
 * Una fila por importación (archivo + año): lo que muestra el panel de
 * históricos y lo que usa el diálogo para avisar "ya importado en 2025".
 * Agrupa en el servidor; al navegador viajan unas pocas filas.
 */
export async function resumenImportaciones(): Promise<{ ok: true; importaciones: ImportacionResumen[] } | { ok: false; error: unknown }> {
  const grupos = new Map<string, ImportacionResumen & { _meses: Set<string> }>();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseAdmin
      .from("turnos_historicos")
      .select("archivo_key, archivo_nombre, fecha, total")
      .order("id")
      .range(desde, desde + 999);
    if (error) return { ok: false, error };
    for (const f of data ?? []) {
      const anio = String(f.fecha ?? "").slice(0, 4);
      const clave = `${f.archivo_key}|${anio}`;
      if (!grupos.has(clave)) {
        grupos.set(clave, { archivo_key: f.archivo_key, archivo_nombre: f.archivo_nombre ?? f.archivo_key, anio, meses: [], ventas: 0, facturacion: 0, _meses: new Set() });
      }
      const g = grupos.get(clave)!;
      g._meses.add(String(f.fecha ?? "").slice(5, 7));
      g.ventas += 1;
      g.facturacion += Number(f.total || 0);
    }
    if (!data || data.length < 1000) break;
  }
  const importaciones = [...grupos.values()]
    .map(({ _meses, ...g }) => ({ ...g, meses: [..._meses].filter(Boolean).sort() }))
    .sort((a, b) => `${a.anio}-${a.meses[0] ?? ""}`.localeCompare(`${b.anio}-${b.meses[0] ?? ""}`) || a.archivo_nombre.localeCompare(b.archivo_nombre));
  return { ok: true, importaciones };
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
