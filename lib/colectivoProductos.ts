// Catálogo de productos del Colectivo y su disponibilidad por evento (server-only).
//
//   colectivo_productos           catálogo: nombre, precio predeterminado, activo.
//   colectivo_evento_productos    qué productos se venden en cada evento.
//
// Vendible en un evento = activo en el catálogo Y habilitado en ese evento. Las
// ventas guardan su propio nombre, cantidad, precio unitario y total: cambiar el
// catálogo o la disponibilidad nunca reescribe una venta.
//
// Como todo el Colectivo, esto es operativo y NO forma parte de Finanzas SIM.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { esVendibleEnEvento } from "@/lib/colectivo";

export type ProductoDelEvento = {
  id: string;
  nombre: string;
  precio_predeterminado: number;
  activo: boolean;
  habilitado: boolean;
};

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; error: string; detalle?: unknown };

// Todo el catálogo con la marca de habilitado para un evento, en el orden del catálogo.
export async function productosDelEvento(eventoId: string): Promise<Resultado<ProductoDelEvento[]>> {
  const [prod, conf] = await Promise.all([
    supabaseAdmin
      .from("colectivo_productos")
      .select("id, nombre, precio_predeterminado, activo")
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true }),
    supabaseAdmin
      .from("colectivo_evento_productos")
      .select("producto_id, habilitado")
      .eq("evento_id", eventoId),
  ]);
  if (prod.error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: prod.error };
  if (conf.error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: conf.error };
  const habilitados = new Set((conf.data ?? []).filter((c) => c.habilitado).map((c) => c.producto_id as string));
  return {
    ok: true,
    valor: (prod.data ?? []).map((p) => ({
      id: p.id as string,
      nombre: p.nombre as string,
      precio_predeterminado: Number(p.precio_predeterminado) || 0,
      activo: Boolean(p.activo),
      habilitado: habilitados.has(p.id as string),
    })),
  };
}

// El producto, solo si hoy se puede vender en ese evento.
export async function productoVendibleEnEvento(
  eventoId: string,
  productoId: string,
): Promise<Resultado<{ id: string; nombre: string; precio_predeterminado: number }>> {
  const [prod, conf] = await Promise.all([
    supabaseAdmin
      .from("colectivo_productos")
      .select("id, nombre, precio_predeterminado, activo")
      .eq("id", productoId)
      .maybeSingle(),
    supabaseAdmin
      .from("colectivo_evento_productos")
      .select("habilitado")
      .eq("evento_id", eventoId)
      .eq("producto_id", productoId)
      .maybeSingle(),
  ]);
  if (prod.error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: prod.error };
  if (conf.error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: conf.error };
  const p = prod.data;
  if (!p || !esVendibleEnEvento({ activo: Boolean(p.activo), habilitado: Boolean(conf.data?.habilitado) })) {
    return { ok: false, status: 400, error: "Ese producto no está disponible en este evento" };
  }
  return {
    ok: true,
    valor: { id: p.id as string, nombre: p.nombre as string, precio_predeterminado: Number(p.precio_predeterminado) || 0 },
  };
}

// Un evento nuevo arranca vendiendo los productos activos del catálogo (lo mismo
// que vendía todo evento antes de la configuración por evento). El admin ajusta
// después desde el evento.
export async function habilitarProductosActivosEnEvento(eventoId: string): Promise<Resultado<number>> {
  const { data: activos, error } = await supabaseAdmin.from("colectivo_productos").select("id").eq("activo", true);
  if (error) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: error };
  if (!activos?.length) return { ok: true, valor: 0 };
  const { error: errIns } = await supabaseAdmin
    .from("colectivo_evento_productos")
    .upsert(
      activos.map((p) => ({ evento_id: eventoId, producto_id: p.id as string, habilitado: true })),
      { onConflict: "evento_id,producto_id", ignoreDuplicates: true },
    );
  if (errIns) return { ok: false, status: 500, error: "No se pudo completar la operación", detalle: errIns };
  return { ok: true, valor: activos.length };
}
