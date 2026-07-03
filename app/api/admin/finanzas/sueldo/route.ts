import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getMesInicio, mesEstaCerrado, mesValido, registrarFinLog } from "@/lib/finanzas";

// Sueldo mensual asignado ("Mi sueldo"). Es una meta/presupuesto del mes; no es
// un movimiento ni afecta la caja. Los gastos personales (egresos clasificados
// como sueldo_personal) se descuentan de este monto.

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || "";
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_sueldos")
    .select("monto, observacion")
    .eq("mes", mes)
    .maybeSingle();
  if (error) {
    return failResponse(500, "Error cargando el sueldo", { logContext: "finanzas sueldo GET", error });
  }
  return NextResponse.json({ mes, monto: data ? Number(data.monto) || 0 : 0, observacion: data?.observacion || null });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto < 0 || monto > 1e13) {
    return NextResponse.json({ error: "Monto de sueldo inválido" }, { status: 400 });
  }

  try {
    const mesInicio = await getMesInicio();
    if (mes < mesInicio) {
      return NextResponse.json({ error: `Finanzas comienza en ${mesInicio}.` }, { status: 400 });
    }
    if (await mesEstaCerrado(mes)) {
      return NextResponse.json({ error: `El mes ${mes} está cerrado. Reabrilo para editarlo.` }, { status: 400 });
    }

    const observacion = body.observacion ? String(body.observacion).slice(0, 300) : null;
    const { error } = await supabaseAdmin
      .from("fin_sueldos")
      .upsert([{ mes, monto, observacion }], { onConflict: "mes" });
    if (error) throw error;

    await registrarFinLog("editar_sueldo", "fin_sueldos", mes, { mes, monto }, auth.role);
    return NextResponse.json({ ok: true, mes, monto });
  } catch (error) {
    return failResponse(500, "Error guardando el sueldo", { logContext: "finanzas sueldo PUT", error });
  }
}
