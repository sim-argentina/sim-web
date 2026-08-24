import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { obtenerEstado } from "@/lib/bracketServer";

type RouteContext = { params: Promise<{ id: string }> };

// Estado completo del bracket de un campeonato (clasificación, rondas, carreras,
// participantes, podio). Lectura para admin y staff.
export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });

  const res = await obtenerEstado(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
