import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  calcularMes,
  getMesInicio,
  getSerieIngresos,
  mesActual,
  mesValido,
  restarMeses,
} from "@/lib/finanzas";
import {
  TIPOS_COBRO,
  TIPOS_PASIVO,
  calcularVentanas,
  diasHastaDeficit,
  esPendiente,
  getEventosRango,
  hoyISO,
  montoPonderado,
  sumarDias,
} from "@/lib/finanzasEventos";

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
    const mesInicio = await getMesInicio();
    if (mes < mesInicio) {
      return NextResponse.json({ mes, antes_de_inicio: true, mes_inicio: mesInicio });
    }

    const hoy = hoyISO();
    const finMes = `${mes}-31`;
    const desdeSerie = restarMeses(mes, 2) < mesInicio ? mesInicio : restarMeses(mes, 2);

    const [{ resumen }, eventos, serieIngresos] = await Promise.all([
      calcularMes(mes),
      // Incluye vencidos pasados y obligaciones lejanas (cuotas a +2 años):
      // la deuda total pendiente no se corta a 90 días.
      getEventosRango(sumarDias(hoy, -365), sumarDias(hoy, 730)),
      getSerieIngresos(desdeSerie, mes),
    ]);

    const caja = resumen.saldoFinalTeoricoGeneral;

    // Ingresos promedio (últimos hasta 3 meses con datos, incluye el actual)
    const ingresosPorMes: Record<string, number> = {};
    for (const r of serieIngresos) ingresosPorMes[r.mes] = (ingresosPorMes[r.mes] || 0) + r.total;
    const mesesConIngresos = Object.values(ingresosPorMes).filter((v) => v > 0);
    const ingresosPromedio = mesesConIngresos.length
      ? mesesConIngresos.reduce((a, b) => a + b, 0) / mesesConIngresos.length
      : resumen.ingresos;

    // Eventos pendientes (incluye vencidos: fecha pasada + pendiente)
    const pendientes = eventos.filter((e) => esPendiente(e));
    const vencidos = pendientes.filter((e) => e.fecha < hoy);
    const futuros = pendientes.filter((e) => e.fecha >= hoy);

    // Ventanas 7/30/60/90
    const ventanas = calcularVentanas(eventos, hoy, [7, 30, 60, 90]);
    const v30 = ventanas[1];
    const v60 = ventanas[2];
    const v90 = ventanas[3];

    // Dentro del mes seleccionado (para caja proyectada a fin de mes)
    let cobrosMes = 0;
    let cobrosMesPond = 0;
    let pagosMes = 0;
    for (const e of futuros) {
      if (e.fecha > finMes) continue;
      if (TIPOS_COBRO.includes(e.tipo)) {
        cobrosMes += e.monto;
        cobrosMesPond += montoPonderado(e);
      } else {
        pagosMes += e.monto;
      }
    }

    // Pasivos (deudas + cuotas pendientes, incl. vencidas)
    const eventosPasivo = pendientes.filter((e) => TIPOS_PASIVO.includes(e.tipo));
    const deudaPendiente = eventosPasivo.reduce((a, e) => a + e.monto, 0);
    const deudaVencida = eventosPasivo.filter((e) => e.fecha < hoy).reduce((a, e) => a + e.monto, 0);
    const pasivo = (dias: number) => {
      const hasta = sumarDias(hoy, dias);
      return pendientes
        .filter((e) => !TIPOS_COBRO.includes(e.tipo) && e.fecha <= hasta)
        .reduce((a, e) => a + e.monto, 0); // incluye vencidos (obligación viva)
    };

    // Pagos fijos recurrentes mensuales (ocurrencias recurrentes de pago próximos 30 días)
    const pagosFijosMensuales = futuros
      .filter((e) => e.es_recurrente && !TIPOS_COBRO.includes(e.tipo) && e.fecha <= sumarDias(hoy, 30))
      .reduce((a, e) => a + e.monto, 0);

    // Pagos de deuda próximos 30 días
    const pagosDeuda30 = pendientes
      .filter((e) => TIPOS_PASIVO.includes(e.tipo) && e.fecha <= sumarDias(hoy, 30))
      .reduce((a, e) => a + e.monto, 0);

    // Egresos promedio del mes actual (costos+gastos reales)
    const egresosOperativos = resumen.costos + resumen.gastos;

    const cajaProyectadaFinMes = caja + cobrosMesPond - pagosMes - deudaVencida;
    const dias_deficit = diasHastaDeficit(eventos, caja - deudaVencida, hoy, 90);

    // Concentración de vencimientos: % de obligaciones (90d + vencidas) que cae en 7/15/30 días
    const obligacionesTotales = pendientes.filter((e) => !TIPOS_COBRO.includes(e.tipo)).reduce((a, e) => a + e.monto, 0);
    const conc = (dias: number) => ratio(pasivo(dias), obligacionesTotales);

    // Riesgo de caja (semáforo)
    let riesgo: "verde" | "ambar" | "rojo" = "verde";
    if (cajaProyectadaFinMes < 0 || (v30.pagos > 0 && caja < v30.pagos * 0.5)) riesgo = "rojo";
    else if (v30.neto_ponderado < 0 || (v30.pagos > 0 && caja < v30.pagos)) riesgo = "ambar";

    const metricas = {
      caja_proyectada_fin_mes: Math.round(cajaProyectadaFinMes),
      flujo_30: v30.neto_ponderado,
      flujo_60: v60.neto_ponderado,
      flujo_90: v90.neto_ponderado,
      deuda_pendiente: deudaPendiente,
      pasivo_30: pasivo(30),
      pasivo_60: pasivo(60),
      pasivo_90: pasivo(90),
      deuda_sobre_ingresos: ratio(deudaPendiente, ingresosPromedio),
      pagos_fijos_sobre_ingresos: ratio(pagosFijosMensuales, ingresosPromedio),
      dscr: ratio(resumen.resultadoOperativo, pagosDeuda30),
      cobertura_30: ratio(caja, v30.pagos),
      runway_ajustado:
        egresosOperativos + pagosDeuda30 > 0
          ? Math.round((caja / (egresosOperativos + pagosDeuda30)) * 10) / 10
          : null,
      break_even_proyectado: Math.round(resumen.costos + resumen.gastos + pagosFijosMensuales),
      riesgo_caja: riesgo,
      dias_hasta_deficit: dias_deficit,
      cobros_ponderados_30: v30.cobros_ponderados,
      gap_proximo_mes: Math.round(cajaProyectadaFinMes + v30.cobros_ponderados - v30.pagos),
      concentracion_7: conc(7),
      concentracion_15: conc(15),
      concentracion_30: conc(30),
      presion_deuda_mensual: ratio(
        pendientes
          .filter((e) => TIPOS_PASIVO.includes(e.tipo) && e.mes_contable === mes)
          .reduce((a, e) => a + e.monto, 0),
        resumen.ingresos > 0 ? resumen.ingresos : ingresosPromedio
      ),
    };

    // Listas para la UI
    const proximosPagos = futuros
      .filter((e) => !TIPOS_COBRO.includes(e.tipo))
      .slice(0, 12)
      .map((e) => ({ id: e.id, fecha: e.fecha, descripcion: e.descripcion, monto: e.monto, tipo: e.tipo }));
    const proximosCobros = futuros
      .filter((e) => TIPOS_COBRO.includes(e.tipo))
      .slice(0, 12)
      .map((e) => ({ id: e.id, fecha: e.fecha, descripcion: e.descripcion, monto: e.monto, probabilidad: e.probabilidad }));
    const listaVencidos = vencidos
      .slice(0, 12)
      .map((e) => ({ id: e.id, fecha: e.fecha, descripcion: e.descripcion, monto: e.monto, tipo: e.tipo }));

    return NextResponse.json({
      mes,
      hoy,
      metricas,
      ventanas,
      contexto: {
        caja,
        ingresos_mes: resumen.ingresos,
        ingresos_promedio: Math.round(ingresosPromedio),
        egresos_operativos: egresosOperativos,
        resultado_operativo: resumen.resultadoOperativo,
        cobros_mes: cobrosMes,
        cobros_mes_ponderados: Math.round(cobrosMesPond),
        pagos_mes: pagosMes,
        deuda_vencida: deudaVencida,
        pagos_deuda_30: pagosDeuda30,
        pagos_fijos_mensuales: pagosFijosMensuales,
        obligaciones_totales: obligacionesTotales,
        eventos_pendientes: pendientes.length,
        eventos_vencidos: vencidos.length,
        hay_deudas: deudaPendiente > 0,
        hay_cobros_futuros: futuros.some((e) => TIPOS_COBRO.includes(e.tipo)),
        hay_eventos: pendientes.length > 0,
      },
      listas: { proximos_pagos: proximosPagos, proximos_cobros: proximosCobros, vencidos: listaVencidos },
    });
  } catch (error) {
    return failResponse(500, "Error calculando salud financiera", { logContext: "finanzas salud GET", error });
  }
}
