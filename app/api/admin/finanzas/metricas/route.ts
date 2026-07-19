import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  calcularMes,
  capacidadYDiasOperativos,
  getConfiguracion,
  getDuracionPromedioTurno,
  getExcepcionesMes,
  getSerieIngresos,
  mesActual,
  mesValido,
  restarMeses,
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
    const config = await getConfiguracion();
    if (mes < config.mes_inicio) {
      return NextResponse.json({ mes, antes_de_inicio: true, mes_inicio: config.mes_inicio });
    }

    const meses: string[] = [];
    for (let i = MESES_SERIE - 1; i >= 0; i--) {
      const m = restarMeses(mes, i);
      if (m >= config.mes_inicio) meses.push(m);
    }
    const desde = meses[0];

    const [{ resumen }, excepciones, duracionTurno, serieIngresos, movsSerieRes, invAcumRes] = await Promise.all([
      calcularMes(mes),
      getExcepcionesMes(mes),
      getDuracionPromedioTurno(mes),
      getSerieIngresos(desde, mes),
      supabaseAdmin
        .from("fin_movimientos")
        .select("mes_contable, tipo, clasificacion, monto")
        .in("mes_contable", meses)
        .limit(20000),
      supabaseAdmin
        .from("fin_movimientos")
        .select("monto")
        .eq("clasificacion", "inversion")
        .lte("mes_contable", mes)
        .limit(20000),
    ]);

    if (movsSerieRes.error) throw movsSerieRes.error;
    if (invAcumRes.error) throw invAcumRes.error;

    // ── Capacidad / ocupación (por día, con excepciones) ──
    const { capacidad: capacidadTeorica, diasOperativos, diasDelMes, diasCerrados } = capacidadYDiasOperativos(
      mes,
      config,
      excepciones,
      duracionTurno
    );

    // ── Serie mensual ──
    const ingresosAutoPorMes: Record<string, number> = {};
    const turnosPorMes: Record<string, number> = {};
    for (const r of serieIngresos) {
      ingresosAutoPorMes[r.mes] = (ingresosAutoPorMes[r.mes] || 0) + r.total;
      if (r.fuente === "turnero") turnosPorMes[r.mes] = (turnosPorMes[r.mes] || 0) + r.turnos;
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
      }
    }
    const serie = meses.map((m) => {
      const ingresos = (ingresosAutoPorMes[m] || 0) + manualPorMes[m].ingresos;
      const egresosOp = manualPorMes[m].costos + manualPorMes[m].gastos;
      return {
        mes: m,
        ingresos,
        costos: manualPorMes[m].costos,
        gastos: manualPorMes[m].gastos,
        resultado_operativo: ingresos - egresosOp,
        turnos: turnosPorMes[m] || 0,
      };
    });
    const actual = serie[serie.length - 1];
    const anterior = serie.length > 1 ? serie[serie.length - 2] : null;

    // ── Bases ──
    const ingresos = resumen.ingresos;
    const costos = resumen.costos;
    const gastos = resumen.gastos;
    const gastosSueldo = resumen.gastosSueldo;
    const inversiones = resumen.inversiones;
    const utilidadBruta = ingresos - costos;
    const resultadoOperativo = resumen.resultadoOperativo;
    // Flujo neto de caja: incluye financiamiento recibido (entra caja) y pagos de
    // deuda (sale caja), además de los egresos operativos.
    const flujoNeto =
      ingresos + resumen.financiamiento - (costos + gastos + inversiones + gastosSueldo + resumen.otros + resumen.pagosDeuda);
    const turnos = resumen.turnosDelMes;

    const inversionAcumulada =
      config.inversion_inicial +
      ((invAcumRes.data || []) as Array<{ monto: unknown }>).reduce((a, r) => a + (Number(r.monto) || 0), 0);

    const horasSimuladorMes = config.cantidad_simuladores * config.horas_operativas_dia * diasOperativos;

    const mesesConEgresos = serie.filter((s) => s.costos + s.gastos > 0);
    const egresosPromedio = mesesConEgresos.length
      ? mesesConEgresos.reduce((a, s) => a + s.costos + s.gastos, 0) / mesesConEgresos.length
      : 0;
    const flujoPromedio = serie.length ? serie.reduce((a, s) => a + s.resultado_operativo, 0) / serie.length : 0;
    const cajaDisponible = resumen.saldoFinalTeoricoGeneral;

    const metricas = {
      revenue: ingresos, // NETO (bruto − comisiones de cobro)
      ingresos_bruto: resumen.ingresosBruto,
      comisiones_cobro: resumen.comisionesCobro,
      tasa_comision: resumen.comisiones ? resumen.comisiones.tasaEfectiva : 0,
      gross_profit: utilidadBruta,
      gross_margin: ratio(utilidadBruta, ingresos),
      operating_profit: resultadoOperativo,
      operating_margin: ratio(resultadoOperativo, ingresos),
      ebitda_aprox: resultadoOperativo,
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
      revenue_per_simulator_hour: ratio(ingresos, horasSimuladorMes),
      roi: ratio(resultadoOperativo, inversionAcumulada),
      roa: ratio(resultadoOperativo, config.valor_activos > 0 ? config.valor_activos : inversionAcumulada),
      payback_meses:
        flujoPromedio > 0 && inversionAcumulada > 0 ? Math.round((inversionAcumulada / flujoPromedio) * 10) / 10 : null,
      cash_burn: resultadoOperativo < 0 ? costos + gastos : null,
      runway_meses: egresosPromedio > 0 ? Math.round((cajaDisponible / egresosPromedio) * 10) / 10 : null,
      mom_growth: anterior && anterior.ingresos > 0 ? ratio(actual.ingresos - anterior.ingresos, anterior.ingresos) : null,
      estructura_costos: {
        costos: ratio(costos, ingresos),
        gastos: ratio(gastos, ingresos),
        inversiones: ratio(inversiones, ingresos),
        sueldo: ratio(gastosSueldo, ingresos),
      },
    };

    return NextResponse.json({
      mes,
      metricas,
      serie,
      contexto: {
        ingresos,
        ingresos_automaticos: resumen.ingresosAutomaticos,
        ingresos_manuales: resumen.ingresosManuales,
        costos,
        gastos,
        inversiones,
        gastos_sueldo: gastosSueldo,
        resultado_operativo: resultadoOperativo,
        turnos,
        capacidad_teorica: capacidadTeorica,
        dias_del_mes: diasDelMes,
        dias_operativos: diasOperativos,
        dias_cerrados: diasCerrados,
        duracion_turno_min: duracionTurno,
        simuladores: config.cantidad_simuladores,
        horas_dia: config.horas_operativas_dia,
        inversion_acumulada: inversionAcumulada,
        valor_activos: config.valor_activos,
        caja_disponible: cajaDisponible,
        egresos_promedio: Math.round(egresosPromedio),
        flujo_promedio: Math.round(flujoPromedio),
        ingresos_mes_anterior: anterior ? anterior.ingresos : null,
        hay_costos: costos > 0,
        hay_gastos: gastos > 0,
        hay_inversion_config: inversionAcumulada > 0,
        hay_activos_config: config.valor_activos > 0,
      },
    });
  } catch (error) {
    return failResponse(500, "Error calculando métricas", { logContext: "finanzas metricas GET", error });
  }
}
