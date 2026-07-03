import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { registrarFinLog } from "@/lib/finanzas";
import { validarEvento } from "@/lib/finanzasEventos";

type Params = { params: Promise<{ id: string }> };

async function buscarEvento(id: string) {
  const { data, error } = await supabaseAdmin.from("fin_eventos_futuros").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// PUT: editar un evento (una ocurrencia). Si pertenece a una serie, queda
// marcado editado_manual para que la serie no lo pise al regenerarse.
export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const existente = await buscarEvento(id);
    if (!existente) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (existente.estado === "pagado" || existente.estado === "cobrado") {
      return NextResponse.json({ error: "El evento ya fue pagado/cobrado. No se puede editar." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const val = await validarEvento({ ...existente, ...body });
    if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .update({ ...val.row, editado_manual: existente.recurrencia_id ? true : existente.editado_manual })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    await registrarFinLog("editar", "fin_eventos_futuros", id, { tipo: data.tipo, monto: data.monto }, auth.role);
    return NextResponse.json({ evento: data });
  } catch (error) {
    return failResponse(500, "Error actualizando evento", { logContext: "finanzas eventos PUT", error });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const existente = await buscarEvento(id);
    if (!existente) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (existente.movimiento_id) {
      return NextResponse.json(
        { error: "El evento ya generó un movimiento real. Eliminá primero el movimiento desde Movimientos." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from("fin_eventos_futuros").delete().eq("id", id);
    if (error) throw error;

    await registrarFinLog("eliminar", "fin_eventos_futuros", id, { tipo: existente.tipo, monto: existente.monto }, auth.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failResponse(500, "Error eliminando evento", { logContext: "finanzas eventos DELETE", error });
  }
}
