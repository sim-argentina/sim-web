import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { mesEstaCerrado, registrarFinLog } from "@/lib/finanzas";
import { validarMovimiento } from "@/lib/finanzasValidation";

type Params = { params: Promise<{ id: string }> };

async function buscarMovimiento(id: string) {
  const { data, error } = await supabaseAdmin
    .from("fin_movimientos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  }

  try {
    const existente = await buscarMovimiento(id);
    if (!existente) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }
    if (existente.origen === "automatico") {
      return NextResponse.json({ error: "Los ingresos automáticos no se pueden editar" }, { status: 400 });
    }
    if (existente.origen === "ajuste_inicial") {
      return NextResponse.json(
        { error: "Los ajustes iniciales se editan desde Config → Inicializar saldos" },
        { status: 400 }
      );
    }
    // No editar movimientos de un mes cerrado
    if (await mesEstaCerrado(existente.mes_contable)) {
      return NextResponse.json(
        { error: `El mes ${existente.mes_contable} está cerrado. Reabrilo para modificarlo.` },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const val = await validarMovimiento(body);
    if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("fin_movimientos")
      .update(val.row)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return failResponse(500, "Error actualizando movimiento", {
        logContext: "finanzas movimientos PUT",
        error,
      });
    }

    await registrarFinLog("editar", "fin_movimientos", id, { monto: data.monto, tipo: data.tipo }, auth.role);
    return NextResponse.json({ movimiento: data });
  } catch (error) {
    return failResponse(500, "Error actualizando movimiento", {
      logContext: "finanzas movimientos PUT",
      error,
    });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  }

  try {
    const existente = await buscarMovimiento(id);
    if (!existente) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }
    if (await mesEstaCerrado(existente.mes_contable)) {
      return NextResponse.json(
        { error: `El mes ${existente.mes_contable} está cerrado. Reabrilo para modificarlo.` },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from("fin_movimientos").delete().eq("id", id);
    if (error) {
      return failResponse(500, "Error eliminando movimiento", {
        logContext: "finanzas movimientos DELETE",
        error,
      });
    }

    await registrarFinLog(
      "eliminar",
      "fin_movimientos",
      id,
      { monto: existente.monto, tipo: existente.tipo, mes: existente.mes_contable },
      auth.role
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failResponse(500, "Error eliminando movimiento", {
      logContext: "finanzas movimientos DELETE",
      error,
    });
  }
}
