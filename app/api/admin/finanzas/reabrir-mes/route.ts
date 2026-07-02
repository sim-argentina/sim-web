import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getCierreMes, mesValido, registrarFinLog } from "@/lib/finanzas";

// Reabrir un mes cerrado (solo admin). Los saldos guardados quedan como borrador.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  try {
    const cierre = await getCierreMes(mes);
    if (!cierre || cierre.estado === "abierto") {
      return NextResponse.json({ error: `El mes ${mes} no está cerrado` }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("fin_cierres_mensuales")
      .update({ estado: "abierto" })
      .eq("id", cierre.id);
    if (error) throw error;

    await registrarFinLog("reabrir_mes", "fin_cierres_mensuales", cierre.id, { mes }, auth.role);
    return NextResponse.json({ ok: true, mes, estado: "abierto" });
  } catch (error) {
    return failResponse(500, "Error reabriendo el mes", {
      logContext: "finanzas reabrir POST",
      error,
    });
  }
}
