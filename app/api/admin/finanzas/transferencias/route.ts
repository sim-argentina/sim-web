import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { registrarFinLog } from "@/lib/finanzas";
import { validarMovimiento } from "@/lib/finanzasValidation";

// Una transferencia es un movimiento tipo 'transferencia' con cuenta origen y
// destino en la MISMA fila: resta de origen y suma a destino en los saldos.
// Fila única = sin riesgo de doble carga (no hay dos asientos que desincronizar).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  // Deducción de ámbito: si origen y destino son de distinto ámbito, se registra
  // con el ámbito de la cuenta origen (la trazabilidad queda en la misma fila).
  const cuentaOrigen = body.cuenta_origen_id ? String(body.cuenta_origen_id) : null;
  let ambito = String(body.ambito || "").trim();
  if (!ambito && cuentaOrigen) {
    const { data } = await supabaseAdmin
      .from("fin_cuentas")
      .select("ambito")
      .eq("id", cuentaOrigen)
      .maybeSingle();
    ambito = data?.ambito === "personal" ? "personal" : "sim";
  }

  const val = await validarMovimiento({
    ...body,
    ambito: ambito || "sim",
    tipo: "transferencia",
    clasificacion: "otro",
  });
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("fin_movimientos")
    .insert([{ ...val.row, creado_por: auth.role }])
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error creando transferencia", {
      logContext: "finanzas transferencias POST",
      error,
    });
  }

  await registrarFinLog(
    "crear",
    "fin_movimientos",
    data.id,
    { monto: data.monto, tipo: "transferencia", mes: data.mes_contable },
    auth.role
  );
  return NextResponse.json({ transferencia: data }, { status: 201 });
}
