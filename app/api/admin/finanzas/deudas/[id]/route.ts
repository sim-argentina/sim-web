import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { registrarFinLog } from "@/lib/finanzas";

type Params = { params: Promise<{ id: string }> };

const ESTADOS = ["activa", "pagada", "vencida", "cancelada"];

export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const patch: Record<string, unknown> = {};

  if (body.descripcion !== undefined) {
    const d = String(body.descripcion).trim().slice(0, 200);
    if (!d) return NextResponse.json({ error: "Descripción inválida" }, { status: 400 });
    patch.descripcion = d;
  }
  if (body.proveedor !== undefined) patch.proveedor = body.proveedor ? String(body.proveedor).slice(0, 150) : null;
  if (body.observaciones !== undefined) patch.observaciones = body.observaciones ? String(body.observaciones).slice(0, 500) : null;
  if (body.estado !== undefined) {
    const e = String(body.estado).trim();
    if (!ESTADOS.includes(e)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    patch.estado = e;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin.from("fin_deudas").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });

    // Si se cancela la deuda, cancelar sus cuotas pendientes.
    if (patch.estado === "cancelada") {
      await supabaseAdmin
        .from("fin_eventos_futuros")
        .update({ estado: "cancelado" })
        .eq("deuda_id", id)
        .in("estado", ["pendiente", "estimado"]);
    }

    await registrarFinLog("editar_deuda", "fin_deudas", id, patch, auth.role);
    return NextResponse.json({ deuda: data });
  } catch (error) {
    return failResponse(500, "Error actualizando deuda", { logContext: "finanzas deudas PUT", error });
  }
}

// DELETE: cancela la deuda y sus cuotas pendientes (no borra historial pagado).
export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });

  try {
    const { data: deuda, error: e1 } = await supabaseAdmin.from("fin_deudas").select("id").eq("id", id).maybeSingle();
    if (e1) throw e1;
    if (!deuda) return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });

    // ¿Tiene cuotas pagadas? → cancelar (conserva historial). Si no, borrar físico.
    const { data: pagadas, error: e2 } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .select("id")
      .eq("deuda_id", id)
      .in("estado", ["pagado", "cobrado"])
      .limit(1);
    if (e2) throw e2;

    if ((pagadas || []).length > 0) {
      await supabaseAdmin.from("fin_deudas").update({ estado: "cancelada" }).eq("id", id);
      await supabaseAdmin
        .from("fin_eventos_futuros")
        .update({ estado: "cancelado" })
        .eq("deuda_id", id)
        .in("estado", ["pendiente", "estimado"]);
      await registrarFinLog("cancelar_deuda", "fin_deudas", id, { motivo: "tenia cuotas pagadas" }, auth.role);
      return NextResponse.json({ ok: true, cancelada: true });
    }

    // Borrado físico: las cuotas caen por FK on delete cascade.
    const { error: e3 } = await supabaseAdmin.from("fin_deudas").delete().eq("id", id);
    if (e3) throw e3;

    await registrarFinLog("eliminar_deuda", "fin_deudas", id, {}, auth.role);
    return NextResponse.json({ ok: true, eliminada: true });
  } catch (error) {
    return failResponse(500, "Error eliminando deuda", { logContext: "finanzas deudas DELETE", error });
  }
}
