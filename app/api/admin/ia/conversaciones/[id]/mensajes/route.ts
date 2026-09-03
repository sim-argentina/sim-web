import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit } from "@/lib/rateLimit";
import { correrChat } from "@/lib/ia/server";
import { IA_OWNER_ADMIN, getLimites } from "@/lib/ia/config";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 4D.4.1 — Vercel Hobby + Fluid Compute admite Functions de hasta 300s (doc oficial vigente).
// Esta ruta procesa la búsqueda web moderna (dynamic filtering + pause_turn + síntesis), que
// necesita >60s. El presupuesto del proveedor (getPresupuestoWeb, ~250s) es MENOR que este máximo,
// dejando ~40s para persistir y responder. DEBE coincidir con ROUTE_MAX_SEG en lib/ia/config.
export const maxDuration = 300;

// Enviar un mensaje del admin y obtener la respuesta de IA SIM (no streaming).
// Idempotencia por 'idempotency_key' para evitar doble cobro/guardado por doble clic.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  // Límite por minuto (además de la cuota atómica diaria/mensual del server).
  const { mensajesPorMinuto } = getLimites();
  if (!(await rateLimit(`ia-msg:${IA_OWNER_ADMIN}`, mensajesPorMinuto, 60_000))) {
    return NextResponse.json({ error: "Demasiadas consultas por minuto. Esperá unos segundos." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pregunta = typeof body.pregunta === "string" ? body.pregunta.trim() : "";
  const idem = typeof body.idempotency_key === "string" ? body.idempotency_key.slice(0, 100) : null;
  const { tokensEntradaMax } = getLimites();
  if (!pregunta) return NextResponse.json({ error: "Escribí una pregunta." }, { status: 400 });
  // Cota grosera de tokens de entrada (~4 chars/token) para no exceder el límite.
  if (pregunta.length > tokensEntradaMax * 4) return NextResponse.json({ error: "La pregunta es demasiado larga." }, { status: 400 });

  const res = await correrChat({ owner: IA_OWNER_ADMIN, conversacionId: id, pregunta, idempotencyKey: idem });
  if (!res.ok) return NextResponse.json({ error: res.error, motivo: res.motivo }, { status: res.status });
  return NextResponse.json(res, { status: 200 });
}
