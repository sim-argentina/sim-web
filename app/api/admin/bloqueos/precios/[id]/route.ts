import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";

type Ctx = { params: Promise<{ id: string }> };

// Eliminar un precio especial (ADMIN-ONLY). No afecta reservas ya pagadas: solo cambia
// el precio de NUEVAS operaciones a partir de ahora.
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { error } = await supabaseAdmin.from("reservas_precios_especiales").delete().eq("id", id);
  if (error) return failResponse(500, "No se pudo eliminar el precio especial", { logContext: "precios DELETE", error });
  return NextResponse.json({ ok: true });
}
