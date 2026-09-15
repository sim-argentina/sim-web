import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { logSecurityEvent } from "@/lib/apiError";
import { reiniciarCampeonato } from "@/lib/bracketServer";

type RouteContext = { params: Promise<{ id: string }> };

// REINICIAR CAMPEONATO: borra TODO el estado deportivo del bracket (clasificación,
// seeds, mejores tiempos, rondas, carreras, resultados, podio). No toca
// inscripciones, pagos ni checkouts.
//
// Vive en su PROPIA ruta a propósito: /bracket/acciones maneja el flujo normal
// (cerrar/reabrir clasificación, generar, avanzar, finalizar) y no tiene forma de
// llegar hasta acá. Un error de tipeo en el campo `accion` no puede terminar en un
// reset destructivo.
//
// Doble barrera: solo rol admin (el más alto del proyecto; staff recibe 403) y la
// confirmación explícita, que valida lib/bracketServer, no la UI.

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campeonato no encontrado" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const res = await reiniciarCampeonato(id, String(body.confirmacion ?? ""));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  // Auditoría con la infraestructura que ya usa el resto del bracket. Sin PII:
  // solo el campeonato, el rol y el volumen de lo borrado.
  logSecurityEvent("bracket_reset", {
    campeonato_id: id,
    role: auth.role,
    resultado: res.data.resultado,
    estado_previo: res.data.estado_previo ?? "sin_bracket",
    rondas: res.data.rondas,
    carreras: res.data.carreras,
    participantes: res.data.participantes,
  });

  return NextResponse.json(res.data);
}
