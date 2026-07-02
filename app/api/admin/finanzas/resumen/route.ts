import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  calcularSaldosMes,
  getCategorias,
  getCierreMes,
  mesActual,
  mesValido,
  resumirMovimientos,
} from "@/lib/finanzas";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || mesActual();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  try {
    const [{ saldos, ingresosAuto, movimientos }, categorias, cierre] = await Promise.all([
      calcularSaldosMes(mes),
      getCategorias(),
      getCierreMes(mes),
    ]);

    const resumen = resumirMovimientos(mes, movimientos, ingresosAuto, categorias);

    // Saldos globales (solo cuentas activas)
    const activos = saldos.filter((s) => s.cuenta.activa);
    const saldoInicialTotal = activos.reduce((a, s) => a + s.saldoInicial, 0);
    const saldoTeoricoTotal = activos.reduce((a, s) => a + s.saldoTeorico, 0);

    // Saldo real y diferencia si hay cierre
    let saldoRealTotal: number | null = null;
    let diferenciaCierre: number | null = null;
    if (cierre && cierre.estado !== "abierto") {
      const cierreCtas = (cierre.cuentas || []) as Array<{ saldo_real: unknown; diferencia: unknown }>;
      saldoRealTotal = cierreCtas.reduce((a, c) => a + (Number(c.saldo_real) || 0), 0);
      diferenciaCierre = cierreCtas.reduce((a, c) => a + (Number(c.diferencia) || 0), 0);
    }

    return NextResponse.json({
      mes,
      resumen,
      ingresosAutomaticos: ingresosAuto.items,
      saldos: activos.map((s) => ({
        cuenta: s.cuenta,
        saldo_inicial: s.saldoInicial,
        ingresos: s.ingresos,
        egresos: s.egresos,
        transferencias_entrantes: s.transferenciasEntrantes,
        transferencias_salientes: s.transferenciasSalientes,
        saldo_teorico: s.saldoTeorico,
      })),
      totales: {
        saldo_inicial: saldoInicialTotal,
        saldo_teorico: saldoTeoricoTotal,
        saldo_real: saldoRealTotal,
        diferencia_cierre: diferenciaCierre,
      },
      cierre: cierre
        ? { estado: cierre.estado, observaciones: cierre.observaciones, cerrado_at: cierre.cerrado_at }
        : { estado: "abierto" },
    });
  } catch (error) {
    return failResponse(500, "Error calculando el resumen", {
      logContext: "finanzas resumen GET",
      error,
    });
  }
}
