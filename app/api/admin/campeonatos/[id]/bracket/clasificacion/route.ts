import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { guardarQuali } from "@/lib/bracketServer";
import type { VueltaQuali } from "@/lib/bracketEngine";

type RouteContext = { params: Promise<{ id: string }> };

// Carga de clasificación (staff): presente / vueltas / incluido de un participante.
// Operación deportiva, no estructural.
export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const participanteId = String(body.participante_id ?? "");
  if (!isValidUuid(participanteId)) return NextResponse.json({ error: "Participante inválido" }, { status: 400 });

  const patch: { presente?: boolean; incluido?: boolean; vueltas?: VueltaQuali[] } = {};
  if (typeof body.presente === "boolean") patch.presente = body.presente;
  if (typeof body.incluido === "boolean") patch.incluido = body.incluido;
  if (Array.isArray(body.vueltas)) {
    patch.vueltas = (body.vueltas as unknown[]).map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const ms = o.tiempo_ms;
      return {
        tiempo_ms: ms == null || ms === "" ? null : Number(ms),
        valida: o.valida !== false,
      };
    });
  }

  const res = await guardarQuali(id, participanteId, patch);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
