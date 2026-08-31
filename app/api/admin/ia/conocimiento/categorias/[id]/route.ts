import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { actualizarCategoria } from "@/lib/ia/docs/conocimientoServer";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Renombrar / archivar / reactivar (no se elimina físicamente si tiene historial).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { nombre?: string; estado?: "activa" | "archivada" } = {};
  if (typeof b.nombre === "string" && b.nombre.trim()) patch.nombre = b.nombre;
  if (b.estado === "activa" || b.estado === "archivada") patch.estado = b.estado;
  if (!patch.nombre && !patch.estado) return NextResponse.json({ error: "Nada para actualizar." }, { status: 400 });
  const r = await actualizarCategoria(id, patch);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
