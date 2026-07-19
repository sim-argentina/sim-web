import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { registrarFinLog } from "@/lib/finanzas";
import { isValidUuid } from "@/lib/security";

// Configuración de comisiones de cobro. Solo admin (RLS deny-all; service_role).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("fin_comisiones_cobro")
    .select("*")
    .order("procesador", { ascending: true })
    .order("metodo_pago", { ascending: true });
  if (error) return failResponse(500, "Error cargando comisiones", { logContext: "finanzas comisiones GET", error });
  return NextResponse.json({ comisiones: data ?? [] });
}

// PATCH { id, porcentaje_base?, aplica_iva?, iva_porcentaje?, acreditacion?, activa? }
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const id = String(body.id || "");
    if (!isValidUuid(id)) return NextResponse.json({ error: "Comisión no encontrada" }, { status: 404 });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.porcentaje_base !== undefined) {
      const p = Number(body.porcentaje_base);
      if (!Number.isFinite(p) || p < 0 || p > 100) return NextResponse.json({ error: "Porcentaje base inválido" }, { status: 400 });
      updates.porcentaje_base = p;
    }
    if (typeof body.aplica_iva === "boolean") updates.aplica_iva = body.aplica_iva;
    if (body.iva_porcentaje !== undefined) {
      const iva = Number(body.iva_porcentaje);
      if (!Number.isFinite(iva) || iva < 0 || iva > 100) return NextResponse.json({ error: "IVA inválido" }, { status: 400 });
      updates.iva_porcentaje = iva;
    }
    if (body.acreditacion === "inmediata" || body.acreditacion === "24_hs") updates.acreditacion = body.acreditacion;
    if (typeof body.activa === "boolean") updates.activa = body.activa;

    const { error } = await supabaseAdmin.from("fin_comisiones_cobro").update(updates).eq("id", id);
    if (error) return failResponse(500, "No se pudo actualizar la comisión", { logContext: "finanzas comisiones PATCH", error });

    await registrarFinLog("editar_comision", "fin_comisiones_cobro", id, updates, auth.role);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
