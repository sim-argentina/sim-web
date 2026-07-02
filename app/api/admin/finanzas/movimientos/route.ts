import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getMovimientosMes, mesActual, mesValido, registrarFinLog } from "@/lib/finanzas";
import { validarMovimiento } from "@/lib/finanzasValidation";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || mesActual();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  try {
    const movimientos = await getMovimientosMes(mes);
    return NextResponse.json({ mes, movimientos });
  } catch (error) {
    return failResponse(500, "Error cargando movimientos", {
      logContext: "finanzas movimientos GET",
      error,
    });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const val = await validarMovimiento(body);
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("fin_movimientos")
    .insert([{ ...val.row, creado_por: auth.role }])
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error creando movimiento", {
      logContext: "finanzas movimientos POST",
      error,
    });
  }

  await registrarFinLog(
    "crear",
    "fin_movimientos",
    data.id,
    { monto: data.monto, tipo: data.tipo, mes: data.mes_contable },
    auth.role
  );
  return NextResponse.json({ movimiento: data }, { status: 201 });
}
