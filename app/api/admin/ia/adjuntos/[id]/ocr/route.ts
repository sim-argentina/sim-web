import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN, getLimites } from "@/lib/ia/config";
import { obtenerAdjunto, analizarAdjuntoOCR } from "@/lib/ia/docs/adjuntosServer";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Analiza un adjunto con OCR/visión. NO consume la API sin confirmacion=true. El
// reprocesamiento (nuevo consumo) requiere reprocesar=true explícito.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const adj = await obtenerAdjunto(id);
  if (!adj) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").select("owner").eq("id", adj.conversacion_id as string).maybeSingle();
  if (!conv || conv.owner !== IA_OWNER_ADMIN) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.confirmacion !== true) {
    return NextResponse.json({ error: "Confirmá el uso de IA para analizar este archivo." }, { status: 400 });
  }

  if (!(await rateLimit(`ia-ocr:${IA_OWNER_ADMIN}`, getLimites().mensajesPorMinuto, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes por minuto. Esperá unos segundos." }, { status: 429 });
  }

  const r = await analizarAdjuntoOCR({ adjuntoId: id, reprocesar: b.reprocesar === true });
  if (!r.ok) return NextResponse.json({ error: r.error, motivo: r.motivo }, { status: r.status });
  return NextResponse.json(r, { status: 200 });
}
