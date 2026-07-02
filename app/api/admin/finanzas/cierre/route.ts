import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  calcularSaldosMes,
  getCierreMes,
  mesActual,
  mesValido,
  registrarFinLog,
} from "@/lib/finanzas";

// GET: estado del cierre del mes + saldos teóricos calculados por cuenta.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || mesActual();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  try {
    const [{ saldos }, cierre] = await Promise.all([calcularSaldosMes(mes), getCierreMes(mes)]);

    const cierreCtas = ((cierre?.cuentas || []) as Array<{
      cuenta_id: string;
      saldo_inicial: unknown;
      saldo_teorico: unknown;
      saldo_real: unknown;
      diferencia: unknown;
    }>).reduce((acc, c) => {
      acc[c.cuenta_id] = {
        saldo_inicial: Number(c.saldo_inicial) || 0,
        saldo_teorico: Number(c.saldo_teorico) || 0,
        saldo_real: Number(c.saldo_real) || 0,
        diferencia: Number(c.diferencia) || 0,
      };
      return acc;
    }, {} as Record<string, { saldo_inicial: number; saldo_teorico: number; saldo_real: number; diferencia: number }>);

    return NextResponse.json({
      mes,
      estado: cierre?.estado || "abierto",
      observaciones: cierre?.observaciones || null,
      cerrado_at: cierre?.cerrado_at || null,
      cuentas: saldos
        .filter((s) => s.cuenta.activa)
        .map((s) => ({
          cuenta: s.cuenta,
          saldo_inicial: s.saldoInicial,
          saldo_teorico: s.saldoTeorico,
          saldo_real_guardado: cierreCtas[s.cuenta.id]?.saldo_real ?? null,
          diferencia_guardada: cierreCtas[s.cuenta.id]?.diferencia ?? null,
        })),
    });
  } catch (error) {
    return failResponse(500, "Error cargando el cierre", {
      logContext: "finanzas cierre GET",
      error,
    });
  }
}

// POST: cerrar el mes con los saldos reales por cuenta.
// body: { mes, saldos_reales: { [cuenta_id]: monto }, observaciones? }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const saldosReales = (body.saldos_reales || {}) as Record<string, unknown>;
  if (typeof saldosReales !== "object" || Array.isArray(saldosReales)) {
    return NextResponse.json({ error: "Saldos reales inválidos" }, { status: 400 });
  }

  try {
    const existente = await getCierreMes(mes);
    if (existente && existente.estado !== "abierto") {
      return NextResponse.json({ error: `El mes ${mes} ya está cerrado` }, { status: 400 });
    }

    const { saldos } = await calcularSaldosMes(mes);
    const activos = saldos.filter((s) => s.cuenta.activa);

    // Validar montos recibidos (deben venir para todas las cuentas activas)
    const filas: Array<{
      cuenta_id: string;
      saldo_inicial: number;
      saldo_teorico: number;
      saldo_real: number;
      diferencia: number;
    }> = [];
    let hayDiferencia = false;

    for (const s of activos) {
      const raw = saldosReales[s.cuenta.id];
      const real = Number(raw);
      if (raw === undefined || raw === null || raw === "" || !Number.isFinite(real) || Math.abs(real) > 1e13) {
        return NextResponse.json(
          { error: `Falta el saldo real de la cuenta "${s.cuenta.nombre}"` },
          { status: 400 }
        );
      }
      const diferencia = Math.round((real - s.saldoTeorico) * 100) / 100;
      if (Math.abs(diferencia) >= 0.01) hayDiferencia = true;
      filas.push({
        cuenta_id: s.cuenta.id,
        saldo_inicial: s.saldoInicial,
        saldo_teorico: s.saldoTeorico,
        saldo_real: real,
        diferencia,
      });
    }

    const estado = hayDiferencia ? "cerrado_con_diferencia" : "cerrado";
    const observaciones = body.observaciones ? String(body.observaciones).slice(0, 1000) : null;

    // Upsert del header
    let cierreId: string;
    if (existente) {
      const { data, error } = await supabaseAdmin
        .from("fin_cierres_mensuales")
        .update({ estado, observaciones, cerrado_at: new Date().toISOString(), cerrado_por: auth.role })
        .eq("id", existente.id)
        .select("id")
        .single();
      if (error) throw error;
      cierreId = data.id;
      await supabaseAdmin.from("fin_cierres_cuentas").delete().eq("cierre_id", cierreId);
    } else {
      const { data, error } = await supabaseAdmin
        .from("fin_cierres_mensuales")
        .insert([{ mes, estado, observaciones, cerrado_at: new Date().toISOString(), cerrado_por: auth.role }])
        .select("id")
        .single();
      if (error) throw error;
      cierreId = data.id;
    }

    const { error: errCtas } = await supabaseAdmin
      .from("fin_cierres_cuentas")
      .insert(filas.map((f) => ({ ...f, cierre_id: cierreId })));
    if (errCtas) throw errCtas;

    await registrarFinLog("cerrar_mes", "fin_cierres_mensuales", cierreId, { mes, estado }, auth.role);
    return NextResponse.json({ ok: true, mes, estado, cuentas: filas });
  } catch (error) {
    return failResponse(500, "Error cerrando el mes", {
      logContext: "finanzas cierre POST",
      error,
    });
  }
}
