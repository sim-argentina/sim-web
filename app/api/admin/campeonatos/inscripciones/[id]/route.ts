import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const role = cookieStore.get("sim-admin-role")?.value;

  if (role !== "admin") {
    return NextResponse.json({ error: "Solo el admin puede cancelar inscripciones" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const { error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .update({ estado_pago: "cancelado" })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
