import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

// Conversaciones en la papelera (restaurables 30 días).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data } = await supabaseAdmin
    .from("ia_conversaciones")
    .select("id, titulo, updated_at, deleted_at")
    .eq("owner", IA_OWNER_ADMIN)
    .eq("estado", "papelera")
    .order("deleted_at", { ascending: false })
    .limit(200);
  return NextResponse.json({ conversaciones: data ?? [] });
}
