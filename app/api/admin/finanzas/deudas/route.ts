import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { FECHA_RE, registrarFinLog } from "@/lib/finanzas";
import { hoyISO, sumarMesesFecha } from "@/lib/finanzasEventos";

// GET: deudas con agregados (pendiente, pagada, cuotas vencidas, próxima cuota).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const [{ data: deudas, error: e1 }, { data: cuotas, error: e2 }] = await Promise.all([
      supabaseAdmin.from("fin_deudas").select("*").order("created_at", { ascending: false }),
      supabaseAdmin
        .from("fin_eventos_futuros")
        .select("id, deuda_id, fecha, monto, estado, cuota_numero")
        .not("deuda_id", "is", null)
        .order("fecha", { ascending: true }),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    const hoy = hoyISO();
    const porDeuda: Record<string, Array<{ fecha: string; monto: number; estado: string; cuota_numero: number | null }>> = {};
    for (const c of cuotas || []) {
      const k = String(c.deuda_id);
      (porDeuda[k] = porDeuda[k] || []).push({
        fecha: String(c.fecha),
        monto: Number(c.monto) || 0,
        estado: String(c.estado),
        cuota_numero: c.cuota_numero === null ? null : Number(c.cuota_numero),
      });
    }

    const out = (deudas || []).map((d) => {
      const cs = porDeuda[String(d.id)] || [];
      const pendientes = cs.filter((c) => c.estado === "pendiente" || c.estado === "estimado");
      const pagadas = cs.filter((c) => c.estado === "pagado");
      const vencidas = pendientes.filter((c) => c.fecha < hoy);
      const proxima = pendientes.find((c) => c.fecha >= hoy) || null;
      return {
        ...d,
        monto_total: Number(d.monto_total) || 0,
        pendiente: pendientes.reduce((a, c) => a + c.monto, 0),
        pagado: pagadas.reduce((a, c) => a + c.monto, 0),
        cuotas_pagadas: pagadas.length,
        cuotas_pendientes: pendientes.length,
        cuotas_vencidas: vencidas.length,
        proxima_cuota: proxima,
      };
    });

    return NextResponse.json({ deudas: out, hoy });
  } catch (error) {
    return failResponse(500, "Error cargando deudas", { logContext: "finanzas deudas GET", error });
  }
}

// POST: crea la deuda y genera sus cuotas como eventos.
// body: { descripcion, proveedor?, monto_total, cuotas (1 = simple), monto_cuota?,
//         fecha_primera_cuota, cuenta_estimada?, categoria_id?, observaciones? }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const descripcion = String(body.descripcion || "").trim().slice(0, 200);
  if (!descripcion) return NextResponse.json({ error: "Descripción requerida" }, { status: 400 });

  const montoTotal = Number(body.monto_total);
  if (!Number.isFinite(montoTotal) || montoTotal <= 0 || montoTotal > 1e12) {
    return NextResponse.json({ error: "Monto total inválido" }, { status: 400 });
  }

  const cuotas = Math.trunc(Number(body.cuotas ?? 1));
  if (!Number.isFinite(cuotas) || cuotas < 1 || cuotas > 120) {
    return NextResponse.json({ error: "Cantidad de cuotas inválida (1 a 120)" }, { status: 400 });
  }

  const primeraCuota = String(body.fecha_primera_cuota || "").trim();
  if (!FECHA_RE.test(primeraCuota)) {
    return NextResponse.json({ error: "Fecha de primera cuota / vencimiento inválida" }, { status: 400 });
  }

  let montoCuota = cuotas === 1 ? montoTotal : Number(body.monto_cuota);
  if (!Number.isFinite(montoCuota) || montoCuota <= 0) {
    montoCuota = Math.round((montoTotal / cuotas) * 100) / 100;
  }

  const cuenta = String(body.cuenta_estimada || "mercado_pago").trim();
  if (!["efectivo", "mercado_pago"].includes(cuenta)) {
    return NextResponse.json({ error: "Cuenta estimada inválida" }, { status: 400 });
  }

  const categoriaId = body.categoria_id ? String(body.categoria_id) : null;
  if (categoriaId) {
    const { data } = await supabaseAdmin.from("fin_categorias").select("id").eq("id", categoriaId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Categoría inexistente" }, { status: 400 });
  }

  const proveedor = body.proveedor ? String(body.proveedor).slice(0, 150) : null;
  const observaciones = body.observaciones ? String(body.observaciones).slice(0, 500) : null;

  try {
    const { data: deuda, error: errDeuda } = await supabaseAdmin
      .from("fin_deudas")
      .insert([{ descripcion, proveedor, monto_total: montoTotal, cuotas_total: cuotas, observaciones }])
      .select()
      .single();
    if (errDeuda) throw errDeuda;

    const eventos: Array<Record<string, unknown>> = [];
    for (let i = 0; i < cuotas; i++) {
      const fecha = i === 0 ? primeraCuota : sumarMesesFecha(primeraCuota, i);
      eventos.push({
        fecha,
        mes_contable: fecha.slice(0, 7),
        tipo: cuotas === 1 ? "deuda" : "cuota_deuda",
        estado: "pendiente",
        descripcion: cuotas === 1 ? descripcion : `${descripcion} · cuota ${i + 1}/${cuotas}`,
        categoria_id: categoriaId,
        monto: montoCuota,
        cuenta_estimada: cuenta,
        probabilidad: 100,
        proveedor_cliente: proveedor,
        observaciones,
        deuda_id: deuda.id,
        cuota_numero: i + 1,
        creado_por: auth.role,
      });
    }

    const { error: errEv } = await supabaseAdmin.from("fin_eventos_futuros").insert(eventos);
    if (errEv) throw errEv;

    await registrarFinLog("crear_deuda", "fin_deudas", deuda.id, { monto_total: montoTotal, cuotas }, auth.role);
    return NextResponse.json({ deuda, cuotas_creadas: eventos.length }, { status: 201 });
  } catch (error) {
    return failResponse(500, "Error creando deuda", { logContext: "finanzas deudas POST", error });
  }
}
