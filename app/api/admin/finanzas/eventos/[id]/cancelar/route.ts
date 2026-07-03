import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { registrarFinLog } from "@/lib/finanzas";

type Params = { params: Promise<{ id: string }> };

// Cancela una ocurrencia: deja de impactar la proyección, sin borrar historial.
export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const { data: evento, error: errEv } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .select("id, estado, recurrencia_id")
      .eq("id", id)
      .maybeSingle();
    if (errEv) throw errEv;
    if (!evento) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (evento.estado === "pagado" || evento.estado === "cobrado") {
      return NextResponse.json({ error: `El evento ya está ${evento.estado}. No se puede cancelar.` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .update({ estado: "cancelado", editado_manual: evento.recurrencia_id ? true : undefined })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    await registrarFinLog("cancelar", "fin_eventos_futuros", id, {}, auth.role);
    return NextResponse.json({ ok: true, evento: data });
  } catch (error) {
    return failResponse(500, "Error cancelando el evento", { logContext: "finanzas cancelar POST", error });
  }
}
