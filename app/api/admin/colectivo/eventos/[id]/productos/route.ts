import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { esVendibleEnEvento } from "@/lib/colectivo";
import { productosDelEvento } from "@/lib/colectivoProductos";

// Productos disponibles en un evento.
//   GET   admin: todo el catálogo con la marca de habilitado (para configurar).
//         staff: solo los vendibles (activos y habilitados), para registrar ventas.
//   PATCH SOLO admin: habilita o deshabilita un producto en el evento, también
//         con el evento en curso. Deshabilitar no toca ventas ya registradas.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const r = await productosDelEvento(id);
  if (!r.ok) return failResponse(r.status, r.error, { logContext: "colectivo/eventos/[id]/productos GET", error: r.detalle });
  const productos = auth.role === "admin" ? r.valor : r.valor.filter(esVendibleEnEvento);
  return NextResponse.json({ productos });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const productoId = String(body.producto_id || "");
    if (!isValidUuid(productoId)) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    if (typeof body.habilitado !== "boolean") return NextResponse.json({ error: "Valor inválido" }, { status: 400 });

    const [{ data: evento }, { data: producto }] = await Promise.all([
      supabaseAdmin.from("colectivo_eventos").select("id, estado").eq("id", id).maybeSingle(),
      supabaseAdmin.from("colectivo_productos").select("id, activo").eq("id", productoId).maybeSingle(),
    ]);
    if (!evento) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (evento.estado === "finalizado" || evento.estado === "cancelado") {
      return NextResponse.json({ error: "El evento está cerrado. Reabrilo para cambiar sus productos." }, { status: 400 });
    }
    if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    if (body.habilitado && !producto.activo) {
      return NextResponse.json({ error: "El producto está inactivo en el catálogo. Activalo primero." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("colectivo_evento_productos")
      .upsert(
        [{ evento_id: id, producto_id: productoId, habilitado: body.habilitado, updated_at: new Date().toISOString() }],
        { onConflict: "evento_id,producto_id" },
      );
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/eventos/[id]/productos PATCH", error });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error actualizando productos del evento" }, { status: 500 });
  }
}
