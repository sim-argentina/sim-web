import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getCuentas, mesEstaCerrado, mesValido, registrarFinLog } from "@/lib/finanzas";

// Inicialización de saldos: crea un movimiento tipo 'ajuste' con
// origen='ajuste_inicial' por cuenta. Solo afecta saldos de caja; queda
// excluido del resumen operativo y de todas las métricas (no es venta,
// costo ni gasto). Positivo = suma a la cuenta, negativo = resta.

// GET ?mes=YYYY-MM → inicialización existente de ese mes (para prefill/edición).
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || "";
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_movimientos")
    .select("id, cuenta_origen_id, cuenta_destino_id, monto, observaciones")
    .eq("mes_contable", mes)
    .eq("origen", "ajuste_inicial");

  if (error) {
    return failResponse(500, "Error consultando inicialización", {
      logContext: "finanzas inicializar GET",
      error,
    });
  }

  const saldos: Record<string, number> = {};
  let observacion: string | null = null;
  for (const m of data || []) {
    const cuentaId = (m.cuenta_destino_id || m.cuenta_origen_id) as string;
    const monto = Number(m.monto) || 0;
    saldos[cuentaId] = m.cuenta_destino_id ? monto : -monto;
    if (m.observaciones) observacion = m.observaciones;
  }

  return NextResponse.json({ mes, inicializado: (data || []).length > 0, saldos, observacion });
}

// POST { mes, saldos: { [cuenta_id]: monto }, observacion?, reemplazar? }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const mes = String(body.mes || "").trim();
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }

  const saldosRaw = body.saldos;
  if (!saldosRaw || typeof saldosRaw !== "object" || Array.isArray(saldosRaw)) {
    return NextResponse.json({ error: "Saldos inválidos" }, { status: 400 });
  }
  const saldos = saldosRaw as Record<string, unknown>;

  try {
    if (await mesEstaCerrado(mes)) {
      return NextResponse.json(
        { error: `El mes ${mes} está cerrado. Reabrilo para inicializar.` },
        { status: 400 }
      );
    }

    // Validar cuentas existentes y montos
    const cuentas = await getCuentas();
    const cuentasPorId = new Map(cuentas.map((c) => [c.id, c]));
    const filas: Array<{ cuentaId: string; monto: number; nombre: string }> = [];

    for (const [cuentaId, raw] of Object.entries(saldos)) {
      const cuenta = cuentasPorId.get(cuentaId);
      if (!cuenta) {
        return NextResponse.json({ error: "Cuenta inexistente" }, { status: 400 });
      }
      if (raw === null || raw === undefined || raw === "") continue; // sin dato → se omite
      const monto = Number(raw);
      if (!Number.isFinite(monto) || Math.abs(monto) > 1e13) {
        return NextResponse.json(
          { error: `Saldo inválido para la cuenta "${cuenta.nombre}"` },
          { status: 400 }
        );
      }
      if (monto === 0) continue; // 0 no genera movimiento
      filas.push({ cuentaId, monto, nombre: cuenta.nombre });
    }

    if (filas.length === 0) {
      return NextResponse.json({ error: "Cargá al menos un saldo distinto de 0" }, { status: 400 });
    }

    // Anti-duplicado: si ya hay inicialización para ese mes, exigir reemplazar=true
    const { data: previos, error: errPrev } = await supabaseAdmin
      .from("fin_movimientos")
      .select("id")
      .eq("mes_contable", mes)
      .eq("origen", "ajuste_inicial");
    if (errPrev) throw errPrev;

    if ((previos || []).length > 0 && body.reemplazar !== true) {
      return NextResponse.json(
        {
          error: `Ya existe una inicialización para ${mes}. Confirmá para reemplazarla.`,
          requiere_reemplazo: true,
        },
        { status: 409 }
      );
    }

    if ((previos || []).length > 0) {
      const { error: errDel } = await supabaseAdmin
        .from("fin_movimientos")
        .delete()
        .eq("mes_contable", mes)
        .eq("origen", "ajuste_inicial");
      if (errDel) throw errDel;
    }

    const observacion = body.observacion ? String(body.observacion).slice(0, 500) : null;
    const fecha = `${mes}-01`;

    const inserts = filas.map((f) => ({
      fecha,
      mes_contable: mes,
      ambito: cuentasPorId.get(f.cuentaId)!.ambito === "personal" ? "personal" : "sim",
      tipo: "ajuste",
      clasificacion: "ajuste",
      // positivo suma (destino), negativo resta (origen)
      cuenta_origen_id: f.monto < 0 ? f.cuentaId : null,
      cuenta_destino_id: f.monto > 0 ? f.cuentaId : null,
      categoria_id: null,
      descripcion: `Ajuste inicial · ${f.nombre}`,
      monto: Math.abs(f.monto),
      observaciones: observacion,
      origen: "ajuste_inicial",
      creado_por: auth.role,
    }));

    const { data, error } = await supabaseAdmin.from("fin_movimientos").insert(inserts).select("id");
    if (error) throw error;

    await registrarFinLog(
      "inicializar_saldos",
      "fin_movimientos",
      null,
      { mes, cuentas: filas.map((f) => f.nombre), reemplazo: (previos || []).length > 0 },
      auth.role
    );

    return NextResponse.json(
      { ok: true, mes, movimientos_creados: (data || []).length },
      { status: 201 }
    );
  } catch (error) {
    return failResponse(500, "Error inicializando saldos", {
      logContext: "finanzas inicializar POST",
      error,
    });
  }
}
