import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = { params: Promise<{ id: string }> };

function tiempoASegundos(tiempo: string): number {
  if (!tiempo?.trim()) return 999999;
  const t = tiempo.trim();
  if (t.includes(":")) {
    const [mins, secs] = t.split(":");
    return parseFloat(mins) * 60 + parseFloat(secs || "0");
  }
  return parseFloat(t) || 999999;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const body = await req.json();

    const updates: Record<string, unknown> = {
      ...body,
      updated_at: new Date().toISOString(),
    };

    if (body.nombre !== undefined || body.apellido !== undefined) {
      updates.nombre_completo = `${body.nombre || ""} ${body.apellido || ""}`.trim();
    }

    if (body.tiempo !== undefined) {
      updates.tiempo_segundos = tiempoASegundos(body.tiempo || "");
    }

    const { data, error } = await supabaseAdmin
      .from("campeonato_registros")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
