import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = sanitizeSearchTerm(searchParams.get("q"));

  if (!q || q.length < 2) {
    return NextResponse.json({ clientes: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("turnos_stand")
    .select("nombre, telefono")
    .or(`nombre.ilike.%${q}%,telefono.ilike.%${q}%`)
    .not("nombre", "is", null)
    .not("telefono", "is", null)
    .limit(10);

  if (error) {
    return NextResponse.json(
      { error: "Error buscando clientes" },
      { status: 500 }
    );
  }

  const clientesUnicos = Array.from(
    new Map(
      data.map((c) => [`${c.nombre}-${c.telefono}`, c])
    ).values()
  );

  return NextResponse.json({ clientes: clientesUnicos });
}