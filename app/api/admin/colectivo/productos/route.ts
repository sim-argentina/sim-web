import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("colectivo_productos")
    .select("*")
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos GET", error });
  return NextResponse.json({ productos: data ?? [] });
}

// Configura el precio predeterminado (o activo) de un producto, sin tocar código.
export async function PATCH(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const id = String(body.id || "");
    if (!isValidUuid(id)) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.precio_predeterminado !== undefined) {
      const precio = Number(body.precio_predeterminado);
      if (!Number.isFinite(precio) || precio < 0) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
      updates.precio_predeterminado = Math.round(precio);
    }
    if (typeof body.activo === "boolean") updates.activo = body.activo;

    const { error } = await supabaseAdmin.from("colectivo_productos").update(updates).eq("id", id);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/productos PATCH", error });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error actualizando producto" }, { status: 500 });
  }
}
