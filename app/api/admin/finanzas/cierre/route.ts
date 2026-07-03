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

    // Agrupa egresos manuales por categoría (con fuente y cantidad).
    const agrupar = (pred: (m: FinMovimiento) => boolean) => {
      const acc: Record<string, { categoria: string; total: number; cantidad: number; efectivo: number; mercado_pago: number }> = {};
      for (const m of movimientos) {
        if (m.origen === "ajuste_inicial" || !pred(m)) continue;
        const nombre = m.categoria_id ? catNombre[m.categoria_id] || "Sin categoría" : "Sin categoría";
        const g = (acc[nombre] = acc[nombre] || { categoria: nombre, total: 0, cantidad: 0, efectivo: 0, mercado_pago: 0 });
        g.total += m.monto;
        g.cantidad += 1;
        const ft = m.cuenta_origen_id ? cuentaTipo[m.cuenta_origen_id] : null;
        if (ft) g[ft] += m.monto;
      }
      return Object.values(acc).sort((a, b) => b.total - a.total);
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
      saldo_teorico_general: r.saldoFinalTeoricoGeneral,
      saldo_real_guardado: cierre && cierre.estado !== "abierto" ? Number(cierre.saldo_real_general) || 0 : null,
      diferencia_guardada: cierre && cierre.estado !== "abierto" ? Number(cierre.diferencia_general) || 0 : null,
      desglose: {
        ingresos: r.ingresos,
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
          total: r.ingresos,
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
