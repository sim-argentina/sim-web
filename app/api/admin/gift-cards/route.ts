import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";

// Listado de Gift Cards para el panel (admin y staff).
export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const codigo = url.searchParams.get("codigo");
    const estado_uso = url.searchParams.get("estado_uso");

    // El panel solo muestra Gift Cards efectivamente vendidas (pago aprobado).
    let query = supabaseAdmin
      .from("gift_cards")
      .select("*")
      .eq("estado_pago", "pagado")
      .order("created_at", { ascending: false });

    if (codigo) query = query.ilike("codigo_unico", `%${codigo.trim().toUpperCase()}%`);
    if (estado_uso) query = query.eq("estado_uso", estado_uso);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
