import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { guardarQuali } from "@/lib/bracketServer";
import { tiempoToMs } from "@/lib/campeonatos";

type RouteContext = { params: Promise<{ id: string }> };

// Carga de clasificación (staff): presente / mejor tiempo (único) / incluido de un
// participante. Operación deportiva, no estructural. No se cargan vueltas sueltas.
export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const inscripcionId = String(body.inscripcion_id ?? "");
  if (!isValidUuid(inscripcionId)) return NextResponse.json({ error: "Inscripción inválida" }, { status: 400 });

  const patch: { presente?: boolean; incluido?: boolean; mejor_ms?: number | null } = {};
  if (typeof body.presente === "boolean") patch.presente = body.presente;
  if (typeof body.incluido === "boolean") patch.incluido = body.incluido;
  // Mejor tiempo: acepta ms directo o el texto "M:SS.mmm" (se convierte server-side).
  if ("mejor_ms" in body || "mejor_tiempo" in body) {
    if (typeof body.mejor_ms === "number" && Number.isFinite(body.mejor_ms)) {
      patch.mejor_ms = body.mejor_ms;
    } else {
      const s = typeof body.mejor_tiempo === "string" ? body.mejor_tiempo.trim() : "";
      patch.mejor_ms = s ? tiempoToMs(s) : null;
    }
  }

  const res = await guardarQuali(id, inscripcionId, patch);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
