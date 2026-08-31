import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Restaurar una conversación desde la papelera (dentro de los 30 días).
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const { data } = await supabaseAdmin.from("ia_conversaciones").select("id, owner, estado").eq("id", id).maybeSingle();
  if (!data || data.owner !== IA_OWNER_ADMIN) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  await supabaseAdmin.from("ia_conversaciones").update({ estado: "activa", deleted_at: null, updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
