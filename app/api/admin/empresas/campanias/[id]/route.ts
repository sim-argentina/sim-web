import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { logSecurityEvent } from "@/lib/apiError";
import { getCampania, actualizarCampania, softDeleteCampania } from "@/lib/empresasServer";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const res = await getCampania(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const res = await actualizarCampania(id, body);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ campania: res.data });
}

// Archivado (soft delete): SOLO admin. No borra códigos/usos/historial.
export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const res = await softDeleteCampania(id, auth.role);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logSecurityEvent("empresa_campania_archivada", { id, role: auth.role });
  return NextResponse.json({ ok: true });
}
