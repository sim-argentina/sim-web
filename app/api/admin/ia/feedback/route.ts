import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = new Set(["util", "no_util", "error"]);

// Feedback de una respuesta (útil / no útil / reporte de error con comentario).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mensajeId = typeof body.mensaje_id === "string" ? body.mensaje_id : "";
  const tipo = typeof body.tipo === "string" ? body.tipo : "";
  const comentario = typeof body.comentario === "string" ? body.comentario.trim().slice(0, 2000) : null;
  if (!UUID_RE.test(mensajeId) || !TIPOS.has(tipo)) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  // El mensaje debe pertenecer a una conversación del admin.
  const { data: msg } = await supabaseAdmin.from("ia_mensajes").select("id, conversacion_id").eq("id", mensajeId).maybeSingle();
  if (!msg) return NextResponse.json({ error: "Mensaje no encontrado." }, { status: 404 });
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").select("owner").eq("id", msg.conversacion_id).maybeSingle();
  if (!conv || conv.owner !== IA_OWNER_ADMIN) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { error } = await supabaseAdmin.from("ia_feedback").insert({ mensaje_id: mensajeId, tipo, comentario, actor: IA_OWNER_ADMIN });
  if (error) return NextResponse.json({ error: "No se pudo guardar el feedback." }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
