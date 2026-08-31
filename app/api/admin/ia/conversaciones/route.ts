import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

// Lista de conversaciones activas del admin (owner server-side, nunca del cliente).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("ia_conversaciones")
    .select("id, titulo, estado, modelo_ultimo, updated_at, created_at")
    .eq("owner", IA_OWNER_ADMIN)
    .eq("estado", "activa")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "No se pudieron listar las conversaciones." }, { status: 500 });
  return NextResponse.json({ conversaciones: data ?? [] });
}

// Crea una conversación vacía.
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("ia_conversaciones")
    .insert({ owner: IA_OWNER_ADMIN, estado: "activa" })
    .select("id, titulo, estado, updated_at, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "No se pudo crear la conversación." }, { status: 500 });
  return NextResponse.json({ conversacion: data }, { status: 201 });
}
