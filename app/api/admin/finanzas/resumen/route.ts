import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { calcularMes, getCierreMes, getMesInicio, mesActual, mesValido } from "@/lib/finanzas";

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

    const [{ resumen, ingresosAuto }, cierre] = await Promise.all([calcularMes(mes), getCierreMes(mes)]);

    const cerrado = Boolean(cierre && cierre.estado !== "abierto");

    return NextResponse.json({
      mes,
      resumen,
      ingresosAutomaticos: ingresosAuto,
      cierre: cierre
        ? {
            estado: cierre.estado,
            observaciones: cierre.observaciones,
            cerrado_at: cierre.cerrado_at,
            saldo_real_general: cerrado ? Number(cierre.saldo_real_general) || 0 : null,
            diferencia_general: cerrado ? Number(cierre.diferencia_general) || 0 : null,
          }
        : { estado: "abierto", saldo_real_general: null, diferencia_general: null },
    });
  } catch (error) {
    return failResponse(500, "Error calculando el resumen", { logContext: "finanzas resumen GET", error });
  }
}
