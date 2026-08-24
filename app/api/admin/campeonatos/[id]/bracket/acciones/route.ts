import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { logSecurityEvent } from "@/lib/apiError";
import {
  cerrarClasificacion, reabrirClasificacion, seedManual, generarBracket,
  generarSiguienteRonda, overrideRonda, finalizarTorneo,
} from "@/lib/bracketServer";

type RouteContext = { params: Promise<{ id: string }> };

// Acciones ESTRUCTURALES del bracket: SOLO admin (validado server-side, no UI).
// cerrar/reabrir clasificación, seeding manual, generar bracket, generar ronda
// siguiente, override de ronda y finalizar torneo.
export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const accion = String(body.accion ?? "");

  let res;
  switch (accion) {
    case "cerrar_clasificacion":
      res = await cerrarClasificacion(id); break;
    case "reabrir_clasificacion":
      res = await reabrirClasificacion(id); break;
    case "seed_manual": {
      const orden = Array.isArray(body.orden) ? (body.orden as unknown[]).map(String).filter(isValidUuid) : [];
      res = await seedManual(id, orden); break;
    }
    case "generar_bracket":
      res = await generarBracket(id); break;
    case "generar_siguiente_ronda": {
      const rondaId = String(body.ronda_id ?? "");
      if (!isValidUuid(rondaId)) return NextResponse.json({ error: "Ronda inválida" }, { status: 400 });
      res = await generarSiguienteRonda(id, rondaId); break;
    }
    case "override_ronda": {
      const rondaId = String(body.ronda_id ?? "");
      if (!isValidUuid(rondaId)) return NextResponse.json({ error: "Ronda inválida" }, { status: 400 });
      const asignacion = Array.isArray(body.asignacion)
        ? (body.asignacion as Array<{ carrera_id: string; inscripcion_ids: string[] }>).map((a) => ({
            carrera_id: String(a.carrera_id),
            inscripcion_ids: Array.isArray(a.inscripcion_ids) ? a.inscripcion_ids.map(String) : [],
          }))
        : [];
      res = await overrideRonda(id, rondaId, asignacion); break;
    }
    case "finalizar_torneo":
      res = await finalizarTorneo(id); break;
    default:
      return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  }

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logSecurityEvent("bracket_accion", { campeonato_id: id, accion, role: auth.role });
  return NextResponse.json(res.data);
}
