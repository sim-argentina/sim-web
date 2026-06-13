import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Listado de Gift Cards para el panel (admin y staff).
export async function GET(req: Request) {
  const cookieStore = await cookies();
  const role = cookieStore.get("sim-admin-role")?.value;
  if (!role) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const codigo = url.searchParams.get("codigo");
    const estado_pago = url.searchParams.get("estado_pago");
    const estado_uso = url.searchParams.get("estado_uso");

    let query = supabaseAdmin
      .from("gift_cards")
      .select("*")
      .order("created_at", { ascending: false });

    if (codigo) query = query.ilike("codigo_unico", `%${codigo.trim().toUpperCase()}%`);
    if (estado_pago) query = query.eq("estado_pago", estado_pago);
    if (estado_uso) query = query.eq("estado_uso", estado_uso);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
