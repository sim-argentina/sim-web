import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { calcularMes, getCierreMes, getMesInicio, mesActual, mesValido, registrarFinLog } from "@/lib/finanzas";

// GET: estado del cierre + saldo teórico general del mes.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || mesActual();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  try {
    const mesInicio = await getMesInicio();
    if (mes < mesInicio) {
      return NextResponse.json({ mes, antes_de_inicio: true, mes_inicio: mesInicio });
    }

    const [{ resumen }, cierre] = await Promise.all([calcularMes(mes), getCierreMes(mes)]);
    const r = resumen;

    return NextResponse.json({
      mes,
      estado: cierre?.estado || "abierto",
      observaciones: cierre?.observaciones || null,
      cerrado_at: cierre?.cerrado_at || null,
      saldo_inicial_general: r.saldoInicialGeneral,
      saldo_teorico_general: r.saldoFinalTeoricoGeneral,
      saldo_real_guardado: cierre && cierre.estado !== "abierto" ? Number(cierre.saldo_real_general) || 0 : null,
      diferencia_guardada: cierre && cierre.estado !== "abierto" ? Number(cierre.diferencia_general) || 0 : null,
      desglose: {
        ingresos: r.ingresos,
        costos: r.costos,
        gastos: r.gastos,
        inversiones: r.inversiones,
        gastos_sueldo: r.gastosSueldo,
        ajustes: r.ajustesNet,
      },
    });
  } catch (error) {
    return failResponse(500, "Error cargando el cierre", { logContext: "finanzas cierre GET", error });
  }
}

// POST: cerrar mes con saldo real GENERAL. body: { mes, saldo_real, observaciones? }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const real = Number(body.saldo_real);
  if (body.saldo_real === undefined || body.saldo_real === null || body.saldo_real === "" || !Number.isFinite(real) || Math.abs(real) > 1e13) {
    return NextResponse.json({ error: "Cargá el saldo real general del mes" }, { status: 400 });
  }

  try {
    const mesInicio = await getMesInicio();
    if (mes < mesInicio) {
      return NextResponse.json({ error: `Finanzas comienza en ${mesInicio}. No se cierran meses anteriores.` }, { status: 400 });
    }

    const existente = await getCierreMes(mes);
    if (existente && existente.estado !== "abierto") {
      return NextResponse.json({ error: `El mes ${mes} ya está cerrado` }, { status: 400 });
    }

    const { resumen } = await calcularMes(mes);
    const teorico = resumen.saldoFinalTeoricoGeneral;
    const diferencia = Math.round((real - teorico) * 100) / 100;
    const estado = Math.abs(diferencia) >= 0.01 ? "cerrado_con_diferencia" : "cerrado";
    const observaciones = body.observaciones ? String(body.observaciones).slice(0, 1000) : null;

    const fila = {
      mes,
      estado,
      observaciones,
      cerrado_at: new Date().toISOString(),
      cerrado_por: auth.role,
      saldo_inicial_general: resumen.saldoInicialGeneral,
      saldo_teorico_general: teorico,
      saldo_real_general: real,
      diferencia_general: diferencia,
    };

    if (existente) {
      const { error } = await supabaseAdmin.from("fin_cierres_mensuales").update(fila).eq("id", existente.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from("fin_cierres_mensuales").insert([fila]);
      if (error) throw error;
    }

    await registrarFinLog("cerrar_mes", "fin_cierres_mensuales", mes, { mes, estado, diferencia }, auth.role);
    return NextResponse.json({ ok: true, mes, estado, saldo_teorico: teorico, saldo_real: real, diferencia });
  } catch (error) {
    return failResponse(500, "Error cerrando el mes", { logContext: "finanzas cierre POST", error });
  }
}
