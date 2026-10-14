// Categorías de la caja del Colectivo (server-only).
//
// La caja del Colectivo es interna al evento y no forma parte de Finanzas SIM:
// estas categorías son propias del Colectivo y no se relacionan con las de
// Finanzas (fin_categorias) ni con ninguna tabla fin_*.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type CategoriaCaja = { id: string; nombre: string; tipo: string; activo: boolean };

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; error: string; detalle?: unknown };

// Todo el catálogo, ordenado por nombre (activas e inactivas: las inactivas
// siguen identificando movimientos viejos).
export async function categoriasCaja(): Promise<Resultado<CategoriaCaja[]>> {
  const { data, error } = await supabaseAdmin
    .from("colectivo_caja_categorias")
    .select("id, nombre, tipo, activo")
    .order("nombre", { ascending: true });
  if (error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: error };
  return { ok: true, valor: (data ?? []) as CategoriaCaja[] };
}

// La categoría, solo si hoy se puede usar en un movimiento nuevo (activa).
export async function categoriaActivaCaja(id: string): Promise<Resultado<CategoriaCaja>> {
  const { data, error } = await supabaseAdmin
    .from("colectivo_caja_categorias")
    .select("id, nombre, tipo, activo")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: error };
  if (!data || !data.activo) return { ok: false, status: 400, error: "Esa categoría no está disponible" };
  return { ok: true, valor: data as CategoriaCaja };
}
