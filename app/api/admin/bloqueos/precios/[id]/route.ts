import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { eliminarPrecioEspecial } from "@/lib/preciosEspeciales";

type Ctx = { params: Promise<{ id: string }> };

// Eliminar un precio especial (ADMIN-ONLY): borra la configuración COMPLETA de
// esa fecha, de cualquier modalidad, como acción explícita. No afecta reservas
// ya creadas o pagadas: solo cambia el precio de NUEVAS operaciones.
export async function DELETE(req: Request, { params }: Ctx) {
  // La cookie administrativa es SameSite=strict: esto es la segunda cerradura.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  try {
    await eliminarPrecioEspecial(id);
  } catch (error) {
    return failResponse(500, "No se pudo eliminar el precio especial", { logContext: "precios DELETE", error });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
