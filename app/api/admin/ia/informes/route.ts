import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { listarPorConversacion } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Listar informes (no descartados/papelera) de una conversación del admin.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const conv = new URL(req.url).searchParams.get("conversacion_id") || "";
  if (!UUID_RE.test(conv)) return NextResponse.json({ error: "conversacion_id inválido." }, { status: 400 });
  const r = await listarPorConversacion(conv, IA_OWNER_ADMIN);
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
