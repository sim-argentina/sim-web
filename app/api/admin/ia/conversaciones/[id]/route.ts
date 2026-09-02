import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function propia(id: string): Promise<{ id: string; estado: string; titulo: string | null } | null> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").select("id, owner, estado, titulo").eq("id", id).maybeSingle();
  if (!data || data.owner !== IA_OWNER_ADMIN) return null;
  return { id: data.id, estado: data.estado, titulo: data.titulo };
}

// Abrir: conversación + mensajes (sin exponer stack traces ni internos sensibles).
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const conv = await propia(id);
  if (!conv) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const { data: mensajes } = await supabaseAdmin
    .from("ia_mensajes")
    .select("id, rol, contenido, modelo, clase_modelo, escalado, fuentes, herramientas, estado, tokens_in, tokens_out, busquedas_web, created_at")
    .eq("conversacion_id", id)
    .order("created_at", { ascending: true });
  return NextResponse.json({ conversacion: conv, mensajes: mensajes ?? [] });
}

// Renombrar (solo el título; anti mass-assignment).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const conv = await propia(id);
  if (!conv) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const titulo = typeof body.titulo === "string" ? body.titulo.trim().slice(0, 120) : "";
  if (!titulo) return NextResponse.json({ error: "Título inválido." }, { status: 400 });
  await supabaseAdmin.from("ia_conversaciones").update({ titulo, updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true, titulo });
}

// Eliminar → papelera (soft delete, restaurable 30 días).
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const conv = await propia(id);
  if (!conv) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  await supabaseAdmin.from("ia_conversaciones").update({ estado: "papelera", deleted_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
