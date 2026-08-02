import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  calcularMes,
  getCategorias,
  getCierreMes,
  getCuentas,
  getMesInicio,
  mesActual,
  mesValido,
  registrarFinLog,
  type FinMovimiento,
} from "@/lib/finanzas";

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

    const [{ resumen, ingresosAuto, movimientos }, cierre, categorias, cuentas] = await Promise.all([
      calcularMes(mes),
      getCierreMes(mes),
      getCategorias(),
      getCuentas(),
    ]);
    const r = resumen;

    const catNombre: Record<string, string> = {};
    for (const c of categorias) catNombre[c.id] = c.nombre;
    const cuentaTipo: Record<string, "efectivo" | "mercado_pago"> = {};
    for (const c of cuentas) cuentaTipo[c.id] = c.tipo === "efectivo" ? "efectivo" : "mercado_pago";

    // Agrupa egresos manuales por categoría (con fuente y cantidad) + el detalle
    // de cada movimiento que compone el total (para el detalle expandible por rubro).
    type MovDetalle = {
      id: string; fecha: string; descripcion: string; monto: number;
      fuente: "efectivo" | "mercado_pago" | null; observaciones: string | null; origen: string; subcategoria: string | null;
    };
    type GrupoRubro = { categoria: string; total: number; cantidad: number; efectivo: number; mercado_pago: number; movimientos: MovDetalle[] };
    const agrupar = (pred: (m: FinMovimiento) => boolean) => {
      const acc: Record<string, GrupoRubro> = {};
      for (const m of movimientos) {
        if (m.origen === "ajuste_inicial" || !pred(m)) continue;
        const nombre = m.categoria_id ? catNombre[m.categoria_id] || "Sin categoría" : "Sin categoría";
        const g = (acc[nombre] = acc[nombre] || { categoria: nombre, total: 0, cantidad: 0, efectivo: 0, mercado_pago: 0, movimientos: [] });
        g.total += m.monto;
        g.cantidad += 1;
        const ft = m.cuenta_origen_id ? cuentaTipo[m.cuenta_origen_id] : null;
        if (ft === "efectivo") g.efectivo += m.monto;
        else if (ft === "mercado_pago") g.mercado_pago += m.monto;
        g.movimientos.push({
          id: m.id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto,
          fuente: ft, observaciones: m.observaciones, origen: m.origen, subcategoria: m.subcategoria,
        });
      }
      return Object.values(acc)
        .map((g) => ({ ...g, movimientos: g.movimientos.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) }))
        .sort((a, b) => b.total - a.total);
    };

    const egreso = (clasif: string) => (m: FinMovimiento) => m.tipo === "egreso" && m.clasificacion === clasif;

    // Ingresos automáticos por fuente (rubro)
    const autoPorFuente: Record<string, { fuente: string; total: number; cantidad: number }> = {};
    for (const i of ingresosAuto) {
      const g = (autoPorFuente[i.fuenteLabel] = autoPorFuente[i.fuenteLabel] || { fuente: i.fuenteLabel, total: 0, cantidad: 0 });
      g.total += i.total;
      g.cantidad = Math.max(g.cantidad, i.cantidad);
    }

    // Financiamiento (préstamos recibidos) del mes
    const financiamientoItems = movimientos
      .filter((m) => m.tipo === "ingreso" && m.clasificacion === "financiamiento")
      .map((m) => ({
        id: m.id,
        fecha: m.fecha,
        descripcion: m.descripcion,
        monto: m.monto,
        fuente: m.cuenta_origen_id ? cuentaTipo[m.cuenta_origen_id] : null,
      }));

    return NextResponse.json({
      mes,
      estado: cierre?.estado || "abierto",
      observaciones: cierre?.observaciones || null,
      cerrado_at: cierre?.cerrado_at || null,
      saldo_inicial_general: r.saldoInicialGeneral,
      saldo_inicial_efectivo: r.saldoInicialEfectivo,
      saldo_inicial_mp: r.saldoInicialMp,
      saldo_teorico_general: r.saldoFinalTeoricoGeneral,
      saldo_teorico_efectivo: r.saldoTeoricoEfectivo,
      saldo_teorico_mp: r.saldoTeoricoMp,
      saldo_real_guardado: cierre && cierre.estado !== "abierto" ? Number(cierre.saldo_real_general) || 0 : null,
      saldo_real_efectivo: cierre && cierre.estado !== "abierto" ? Number(cierre.saldo_real_efectivo) || 0 : null,
      saldo_real_mp: cierre && cierre.estado !== "abierto" ? Number(cierre.saldo_real_mp) || 0 : null,
      diferencia_guardada: cierre && cierre.estado !== "abierto" ? Number(cierre.diferencia_general) || 0 : null,
      diferencia_efectivo: cierre && cierre.estado !== "abierto" ? Number(cierre.diferencia_efectivo) || 0 : null,
      diferencia_mp: cierre && cierre.estado !== "abierto" ? Number(cierre.diferencia_mp) || 0 : null,
      informe_generado_at: cierre?.informe_generado_at ?? null,
      // Comisiones de cobro del stand: informativas + línea que baja el saldo.
      // El saldo teórico ya está NETO (no se resta dos veces).
      comisiones: r.comisiones,
      desglose: {
        ingresos: r.ingresosBruto,
        comisiones_cobro: r.comisionesCobro,
        ingresos_netos: r.ingresos,
        financiamiento: r.financiamiento,
        costos: r.costos,
        gastos: r.gastos,
        inversiones: r.inversiones,
        gastos_sueldo: r.gastosSueldo,
        pagos_deuda: r.pagosDeuda,
        otros: r.otros,
        ajustes: r.ajustesNet,
      },
      por_fuente: r.porFuente,
      detalle: {
        ingresos: {
          total: r.ingresosBruto,
          automaticos: Object.values(autoPorFuente).sort((a, b) => b.total - a.total),
          automaticos_total: r.ingresosAutomaticos,
          manuales_por_categoria: agrupar((m) => m.tipo === "ingreso" && m.clasificacion !== "financiamiento"),
          manuales_total: r.ingresosManuales,
        },
        costos_por_categoria: agrupar(egreso("costo")),
        gastos_por_categoria: agrupar(egreso("gasto")),
        inversiones_por_categoria: agrupar(egreso("inversion")),
        otros_por_categoria: agrupar(egreso("otro")),
        sueldo_por_categoria: agrupar((m) => m.tipo === "egreso" && (m.clasificacion === "sueldo_personal" || m.clasificacion === "retiro")),
        sueldo_total: r.gastosSueldo,
        sueldo_asignado: r.sueldoAsignado,
        financiamiento: { total: r.financiamiento, items: financiamientoItems },
        pagos_deuda_por_categoria: agrupar(egreso("pago_deuda")),
      },
    });
  } catch (error) {
    return failResponse(500, "Error cargando el cierre", { logContext: "finanzas cierre GET", error });
  }
}

// POST: cerrar mes con saldo real por fuente. body:
//   { mes, saldo_real_efectivo, saldo_real_mp, observaciones? }
// Compatibilidad: acepta { saldo_real } (general) si no viene el desglose.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const realEfectivo = Number(body.saldo_real_efectivo);
  const realMp = Number(body.saldo_real_mp);
  const tieneDesglose =
    body.saldo_real_efectivo !== undefined && body.saldo_real_efectivo !== null && body.saldo_real_efectivo !== "" &&
    body.saldo_real_mp !== undefined && body.saldo_real_mp !== null && body.saldo_real_mp !== "" &&
    Number.isFinite(realEfectivo) && Number.isFinite(realMp);

  let real: number;
  if (tieneDesglose) {
    if (Math.abs(realEfectivo) > 1e13 || Math.abs(realMp) > 1e13) {
      return NextResponse.json({ error: "Saldo real fuera de rango" }, { status: 400 });
    }
    real = Math.round((realEfectivo + realMp) * 100) / 100;
  } else {
    real = Number(body.saldo_real);
    if (body.saldo_real === undefined || body.saldo_real === null || body.saldo_real === "" || !Number.isFinite(real) || Math.abs(real) > 1e13) {
      return NextResponse.json({ error: "Cargá el saldo real de Efectivo y de Mercado Pago del mes" }, { status: 400 });
    }
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
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const teorico = resumen.saldoFinalTeoricoGeneral;
    const teoricoEf = resumen.saldoTeoricoEfectivo;
    const teoricoMp = resumen.saldoTeoricoMp;
    const diferencia = round2(real - teorico);
    const difEf = tieneDesglose ? round2(realEfectivo - teoricoEf) : 0;
    const difMp = tieneDesglose ? round2(realMp - teoricoMp) : 0;
    const estado = Math.abs(diferencia) >= 0.01 ? "cerrado_con_diferencia" : "cerrado";
    const observaciones = body.observaciones ? String(body.observaciones).slice(0, 1000) : null;

    const fila = {
      mes,
      estado,
      observaciones,
      cerrado_at: new Date().toISOString(),
      cerrado_por: auth.role,
      saldo_inicial_general: resumen.saldoInicialGeneral,
      saldo_inicial_efectivo: resumen.saldoInicialEfectivo,
      saldo_inicial_mp: resumen.saldoInicialMp,
      saldo_teorico_general: teorico,
      saldo_teorico_efectivo: teoricoEf,
      saldo_teorico_mp: teoricoMp,
      saldo_real_general: real,
      saldo_real_efectivo: tieneDesglose ? realEfectivo : real,
      saldo_real_mp: tieneDesglose ? realMp : 0,
      diferencia_general: diferencia,
      diferencia_efectivo: difEf,
      diferencia_mp: difMp,
      informe_generado_at: new Date().toISOString(),
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
