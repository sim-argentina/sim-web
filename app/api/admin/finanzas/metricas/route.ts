import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  calcularSaldosMes,
  getCategorias,
  getConfiguracion,
  getSerieIngresos,
  mesActual,
  mesValido,
  restarMeses,
  resumirMovimientos,
  type FinMovimiento,
} from "@/lib/finanzas";

const MESES_SERIE = 6;

function ratio(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 10000) / 10000;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || mesActual();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  try {
    const desde = restarMeses(mes, MESES_SERIE - 1);
    const meses: string[] = [];
    for (let i = MESES_SERIE - 1; i >= 0; i--) meses.push(restarMeses(mes, i));

    const [{ saldos, ingresosAuto, movimientos }, categorias, config, serieIngresos, movsSerieRes, invAcumRes] =
      await Promise.all([
        calcularSaldosMes(mes),
        getCategorias(),
        getConfiguracion(),
        getSerieIngresos(desde, mes),
        // movimientos SIM de los últimos meses para serie de egresos
        supabaseAdmin
          .from("fin_movimientos")
          .select("mes_contable, ambito, tipo, clasificacion, monto, cuenta_origen_id, cuenta_destino_id")
          .in("mes_contable", meses)
          .eq("ambito", "sim")
          .limit(20000),
        // inversión acumulada (todas las inversiones cargadas hasta este mes inclusive)
        supabaseAdmin
          .from("fin_movimientos")
          .select("monto")
          .eq("ambito", "sim")
          .eq("clasificacion", "inversion")
          .lte("mes_contable", mes)
          .limit(20000),
      ]);

    if (movsSerieRes.error) throw movsSerieRes.error;
    if (invAcumRes.error) throw invAcumRes.error;

    const resumen = resumirMovimientos(mes, movimientos, ingresosAuto, categorias);

    // ── Serie mensual: ingresos (auto + manuales), egresos operativos, turnos ──
    const ingresosAutoPorMes: Record<string, number> = {};
    const turnosPorMes: Record<string, number> = {};
    for (const r of serieIngresos) {
      ingresosAutoPorMes[r.mes] = (ingresosAutoPorMes[r.mes] || 0) + r.total;
      if (r.fuente === "turnero" || r.fuente === "turnos_historicos") {
        turnosPorMes[r.mes] = (turnosPorMes[r.mes] || 0) + r.turnos;
      }
    }

    const manualPorMes: Record<string, { ingresos: number; costos: number; gastos: number }> = {};
    for (const m of meses) manualPorMes[m] = { ingresos: 0, costos: 0, gastos: 0 };
    for (const raw of (movsSerieRes.data || []) as Array<Partial<FinMovimiento>>) {
      const bucket = manualPorMes[String(raw.mes_contable)];
      if (!bucket) continue;
      const monto = Number(raw.monto) || 0;
      if (raw.tipo === "ingreso") bucket.ingresos += monto;
      else if (raw.tipo === "egreso") {
        if (raw.clasificacion === "costo") bucket.costos += monto;
        else if (raw.clasificacion === "gasto") bucket.gastos += monto;
        else if (raw.clasificacion !== "inversion" && raw.clasificacion !== "retiro") bucket.gastos += monto;
      }
    }

    const serie = meses.map((m) => {
      const ingresos = (ingresosAutoPorMes[m] || 0) + manualPorMes[m].ingresos;
      const egresosOperativos = manualPorMes[m].costos + manualPorMes[m].gastos;
      return {
        mes: m,
        ingresos,
        costos: manualPorMes[m].costos,
        gastos: manualPorMes[m].gastos,
        resultado_operativo: ingresos - egresosOperativos,
        turnos: turnosPorMes[m] || 0,
      };
    });

    const actual = serie[serie.length - 1];
    const anterior = serie.length > 1 ? serie[serie.length - 2] : null;

    // ── Bases ──
    const ingresos = resumen.ingresosSim;
    const costos = resumen.costos;
    const gastos = resumen.gastos;
    const utilidadBruta = ingresos - costos;
    const resultadoOperativo = resumen.resultadoOperativo;
    const flujoNeto = ingresos - (costos + gastos + resumen.inversiones + resumen.retiros);
    const turnos = resumen.turnosDelMes;

    const inversionAcumulada =
      config.inversion_inicial +
      ((invAcumRes.data || []) as Array<{ monto: unknown }>).reduce((a, r) => a + (Number(r.monto) || 0), 0);

    // capacidad teórica
    const slotsPorDia = config.duracion_turno_min > 0
      ? Math.floor((config.horas_operativas_dia * 60) / config.duracion_turno_min)
      : 0;
    const capacidadTeorica = config.cantidad_simuladores * slotsPorDia * config.dias_operativos_mes;

    // egresos operativos promedio (meses con datos) para runway / payback
    const mesesConEgresos = serie.filter((s) => s.costos + s.gastos > 0);
    const egresosPromedio = mesesConEgresos.length
      ? mesesConEgresos.reduce((a, s) => a + s.costos + s.gastos, 0) / mesesConEgresos.length
      : 0;
    const flujoPromedio = serie.length
      ? serie.reduce((a, s) => a + s.resultado_operativo, 0) / serie.length
      : 0;

    const saldosSim = saldos.filter((s) => s.cuenta.activa && s.cuenta.ambito === "sim");
    const cajaDisponible = saldosSim.reduce((a, s) => a + s.saldoTeorico, 0);

    const horasSimulador = config.cantidad_simuladores * config.horas_operativas_dia * config.dias_operativos_mes;

    const metricas = {
      revenue: ingresos,
      gross_profit: utilidadBruta,
      gross_margin: ratio(utilidadBruta, ingresos),
      operating_profit: resultadoOperativo,
      operating_margin: ratio(resultadoOperativo, ingresos),
      net_cash_flow: flujoNeto,
      expense_ratio: ratio(gastos, ingresos),
      cost_ratio: ratio(costos, ingresos),
      break_even: costos + gastos,
      revenue_per_turn: ratio(ingresos, turnos),
      cost_per_turn: ratio(costos, turnos),
      profit_per_turn: ratio(resultadoOperativo, turnos),
      average_ticket: ratio(resumen.ingresosAutomaticos, turnos),
      occupancy_rate: ratio(turnos, capacidadTeorica),
      revenue_per_simulator: ratio(ingresos, config.cantidad_simuladores),
      revenue_per_simulator_hour: ratio(ingresos, horasSimulador),
      roi: ratio(resultadoOperativo, inversionAcumulada),
      roa: ratio(resultadoOperativo, config.valor_activos > 0 ? config.valor_activos : inversionAcumulada),
      payback_meses: flujoPromedio > 0 && inversionAcumulada > 0 ? Math.round((inversionAcumulada / flujoPromedio) * 10) / 10 : null,
      ebitda_aprox: resultadoOperativo,
      cash_burn: resultadoOperativo < 0 ? costos + gastos : null,
      runway_meses: egresosPromedio > 0 ? Math.round((cajaDisponible / egresosPromedio) * 10) / 10 : null,
      mom_growth: anterior && anterior.ingresos > 0 ? ratio(actual.ingresos - anterior.ingresos, anterior.ingresos) : null,
      estructura_costos: {
        costos: ratio(costos, ingresos),
        gastos: ratio(gastos, ingresos),
        inversiones: ratio(resumen.inversiones, ingresos),
        retiros: ratio(resumen.retiros, ingresos),
      },
      retiros_ratio: ratio(resumen.retiros, ingresos),
    };

    return NextResponse.json({
      mes,
      metricas,
      serie,
      contexto: {
        turnos,
        capacidad_teorica: capacidadTeorica,
        inversion_acumulada: inversionAcumulada,
        caja_disponible: cajaDisponible,
        egresos_promedio: Math.round(egresosPromedio),
        inversiones_mes: resumen.inversiones,
        retiros_mes: resumen.retiros,
        config,
      },
    });
  } catch (error) {
    return failResponse(500, "Error calculando métricas", {
      logContext: "finanzas metricas GET",
      error,
    });
  }
}
