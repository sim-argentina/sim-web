import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { iniciarCarrera, guardarResultadoCarrera, finalizarCarrera, reabrirCarrera } from "@/lib/bracketServer";

type RouteContext = { params: Promise<{ id: string }> };

// Operación de carreras. iniciar / guardar_resultado / finalizar → staff o admin.
// reabrir → SOLO admin (acción estructural con protección downstream).
export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const carreraId = String(body.carrera_id ?? "");
  if (!isValidUuid(carreraId)) return NextResponse.json({ error: "Carrera inválida" }, { status: 400 });
  const accion = String(body.accion ?? "");

  let res;
  switch (accion) {
    case "iniciar":
      res = await iniciarCarrera(id, carreraId); break;
    case "guardar_resultado": {
      const resultado = Array.isArray(body.resultado)
        ? (body.resultado as Array<Record<string, unknown>>).map((r) => ({
            participante_id: String(r.participante_id),
            posicion_final: r.posicion_final == null || r.posicion_final === "" ? null : Number(r.posicion_final),
            estado: typeof r.estado === "string" ? r.estado : undefined,
            observacion: typeof r.observacion === "string" ? r.observacion : null,
          }))
        : [];
      res = await guardarResultadoCarrera(id, carreraId, resultado); break;
    }
    case "finalizar":
      res = await finalizarCarrera(id, carreraId); break;
    case "reabrir":
      if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede reabrir carreras" }, { status: 403 });
      res = await reabrirCarrera(id, carreraId); break;
    default:
      return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  }

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
