import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

// Precargar el calendario de fechas de un campeonato (SOLO admin). Idempotente:
// crea solo las fechas faltantes (1..total, default 10), no duplica. No inventa
// circuitos (quedan nulos para que el admin los complete en el tab Fechas).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const campeonato_id = body?.campeonato_id;
    if (typeof campeonato_id !== "string" || !isValidUuid(campeonato_id)) {
      return NextResponse.json({ error: "Campeonato inválido" }, { status: 400 });
    }
    const total = Math.min(20, Math.max(1, Number(body?.total) || 10));

    const { data: existentes, error: exErr } = await supabaseAdmin
      .from("campeonato_fechas")
      .select("numero_fecha")
      .eq("campeonato_id", campeonato_id);
    if (exErr)
      return failResponse(500, "No se pudo completar la operación", { logContext: "precargar load", error: exErr });

    const yaExisten = new Set((existentes ?? []).map((f) => Number(f.numero_fecha)));
    const aCrear: { campeonato_id: string; numero_fecha: number; nombre: string; estado: string }[] = [];
    for (let n = 1; n <= total; n++) {
      if (!yaExisten.has(n)) {
        aCrear.push({ campeonato_id, numero_fecha: n, nombre: `Fecha ${n}`, estado: "abierta" });
      }
    }

    if (aCrear.length === 0) {
      return NextResponse.json({ ok: true, creadas: 0, mensaje: `El campeonato ya tiene las ${total} fechas.` });
    }

    const { error: insErr } = await supabaseAdmin.from("campeonato_fechas").insert(aCrear);
    if (insErr)
      return failResponse(500, "No se pudo completar la operación", { logContext: "precargar insert", error: insErr });

    return NextResponse.json({
      ok: true,
      creadas: aCrear.length,
      mensaje: `Se crearon ${aCrear.length} fecha(s) faltante(s). Completá los circuitos en cada una.`,
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
