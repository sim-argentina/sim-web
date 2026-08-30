import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/security";
import { renombrarPlantilla, actualizarPlantilla, estadoPlantilla } from "@/lib/cronogramaCopiaServer";

type Ctx = { params: Promise<{ id: string }> };

// Mutaciones de una plantilla (SOLO admin). accion: renombrar | actualizar | archivar | reactivar.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-copia:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = String(b.accion ?? "");

  if (accion === "renombrar") {
    const res = await renombrarPlantilla(id, String(b.nombre ?? ""));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ plantilla: res.data });
  }
  if (accion === "actualizar") {
    const origen: { lunes?: string; anio?: number; mes?: number } = {};
    if (typeof b.lunes === "string") origen.lunes = b.lunes;
    if (b.anio !== undefined) origen.anio = Number(b.anio);
    if (b.mes !== undefined) origen.mes = Number(b.mes);
    const res = await actualizarPlantilla(id, origen);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ plantilla: res.data });
  }
  if (accion === "archivar" || accion === "reactivar") {
    const res = await estadoPlantilla(id, accion === "reactivar");
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ plantilla: res.data });
  }
  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
