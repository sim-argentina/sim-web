import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getMesInicio, mesEstaCerrado, mesValido, registrarFinLog } from "@/lib/finanzas";

// Saldo inicial GENERAL del mes (no por cuenta). Se guarda en fin_saldos_iniciales;
// solo afecta la caja general del mes, nunca ingresos/costos/gastos/métricas.

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || "";
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_saldos_iniciales")
    .select("monto, monto_efectivo, monto_mercado_pago, observacion")
    .eq("mes", mes)
    .maybeSingle();
  if (error) {
    return failResponse(500, "Error consultando saldo inicial", { logContext: "finanzas inicializar GET", error });
  }

  return NextResponse.json({
    mes,
    inicializado: Boolean(data),
    monto: data ? Number(data.monto) || 0 : null,
    monto_efectivo: data ? Number(data.monto_efectivo) || 0 : null,
    monto_mercado_pago: data ? Number(data.monto_mercado_pago) || 0 : null,
    observacion: data?.observacion || null,
  });
}

// POST { mes, monto, observacion? }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  // Puede venir desglosado por fuente (efectivo / mercado pago). El saldo
  // general (monto) es la suma. Si sólo llega `monto`, se mantiene compat.
  const tieneDesglose = body.monto_efectivo !== undefined || body.monto_mercado_pago !== undefined;
  const montoEfectivo = Number(body.monto_efectivo || 0);
  const montoMp = Number(body.monto_mercado_pago || 0);
  if (tieneDesglose && (!Number.isFinite(montoEfectivo) || !Number.isFinite(montoMp) || Math.abs(montoEfectivo) > 1e13 || Math.abs(montoMp) > 1e13)) {
    return NextResponse.json({ error: "Saldo por fuente inválido" }, { status: 400 });
  }
  const monto = tieneDesglose ? montoEfectivo + montoMp : Number(body.monto);
  if ((!tieneDesglose && (body.monto === undefined || body.monto === null || body.monto === "")) || !Number.isFinite(monto) || Math.abs(monto) > 1e13) {
    return NextResponse.json({ error: "Cargá un saldo inicial válido" }, { status: 400 });
  }

  try {
    const mesInicio = await getMesInicio();
    if (mes < mesInicio) {
      return NextResponse.json({ error: `Finanzas comienza en ${mesInicio}. Inicializá desde ese mes.` }, { status: 400 });
    }
    if (await mesEstaCerrado(mes)) {
      return NextResponse.json({ error: `El mes ${mes} está cerrado. Reabrilo para inicializar.` }, { status: 400 });
    }

    const observacion = body.observacion ? String(body.observacion).slice(0, 500) : null;

    const { error } = await supabaseAdmin
      .from("fin_saldos_iniciales")
      .upsert(
        [{ mes, monto, monto_efectivo: montoEfectivo, monto_mercado_pago: montoMp, observacion }],
        { onConflict: "mes" }
      );
    if (error) throw error;

    await registrarFinLog(
      "inicializar_saldo_general",
      "fin_saldos_iniciales",
      mes,
      { mes, monto, monto_efectivo: montoEfectivo, monto_mercado_pago: montoMp },
      auth.role
    );
    return NextResponse.json({ ok: true, mes, monto, monto_efectivo: montoEfectivo, monto_mercado_pago: montoMp });
  } catch (error) {
    return failResponse(500, "Error inicializando saldo", { logContext: "finanzas inicializar POST", error });
  }
}
