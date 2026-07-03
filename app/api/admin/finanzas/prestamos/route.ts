import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { FECHA_RE, getCuentas, registrarFinLog } from "@/lib/finanzas";
import { validarMovimiento } from "@/lib/finanzasValidation";
import { sumarDias, sumarMesesFecha } from "@/lib/finanzasEventos";

// Préstamo / deuda tomada: entra plata AHORA (financiamiento, no revenue) y se
// genera una deuda con cuotas futuras. Todo vinculado para trazabilidad.
//
// body: {
//   fecha_recepcion, monto_recibido, cuenta_destino (efectivo|mercado_pago),
//   acreedor, descripcion?, monto_total_a_devolver?, cuotas, monto_cuota?,
//   fecha_primera_cuota, frecuencia (mensual|semanal|unica), observaciones?
// }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const fechaRecepcion = String(body.fecha_recepcion || "").trim();
  if (!FECHA_RE.test(fechaRecepcion)) {
    return NextResponse.json({ error: "Fecha de recepción inválida (YYYY-MM-DD)" }, { status: 400 });
  }

  const montoRecibido = Number(body.monto_recibido);
  if (!Number.isFinite(montoRecibido) || montoRecibido <= 0 || montoRecibido > 1e12) {
    return NextResponse.json({ error: "Monto recibido inválido" }, { status: 400 });
  }

  const cuentaDestino = String(body.cuenta_destino || "").trim();
  if (!["efectivo", "mercado_pago"].includes(cuentaDestino)) {
    return NextResponse.json({ error: "Elegí dónde entra la plata (Efectivo o Mercado Pago)" }, { status: 400 });
  }

  const acreedor = String(body.acreedor || "").trim().slice(0, 150);
  if (!acreedor) return NextResponse.json({ error: "Indicá el acreedor / entidad" }, { status: 400 });

  const cuotas = Math.trunc(Number(body.cuotas ?? 1));
  if (!Number.isFinite(cuotas) || cuotas < 1 || cuotas > 120) {
    return NextResponse.json({ error: "Cantidad de cuotas inválida (1 a 120)" }, { status: 400 });
  }

  // Total a devolver: por defecto = monto recibido (sin interés).
  let montoTotal = Number(body.monto_total_a_devolver);
  if (!Number.isFinite(montoTotal) || montoTotal <= 0) montoTotal = montoRecibido;
  if (montoTotal < montoRecibido) {
    return NextResponse.json({ error: "El total a devolver no puede ser menor al monto recibido" }, { status: 400 });
  }

  const primeraCuota = String(body.fecha_primera_cuota || "").trim();
  if (!FECHA_RE.test(primeraCuota)) {
    return NextResponse.json({ error: "Fecha de primera cuota inválida" }, { status: 400 });
  }

  const frecuencia = String(body.frecuencia || "mensual").trim();
  if (!["mensual", "semanal", "unica"].includes(frecuencia)) {
    return NextResponse.json({ error: "Frecuencia inválida" }, { status: 400 });
  }

  let montoCuota = cuotas === 1 ? montoTotal : Number(body.monto_cuota);
  if (!Number.isFinite(montoCuota) || montoCuota <= 0) {
    montoCuota = Math.round((montoTotal / cuotas) * 100) / 100;
  }

  const observaciones = body.observaciones ? String(body.observaciones).slice(0, 500) : null;
  const descripcion = String(body.descripcion || `Préstamo de ${acreedor}`).slice(0, 200);

  try {
    const cuentas = await getCuentas();
    const cuenta = cuentas.find((c) => c.tipo === cuentaDestino);
    if (!cuenta) return NextResponse.json({ error: "No hay cuenta activa para esa fuente" }, { status: 400 });

    // 1) Entrada de financiamiento (ingreso clasificado como financiamiento, no revenue).
    const val = await validarMovimiento({
      fecha: fechaRecepcion,
      tipo: "ingreso",
      clasificacion: "financiamiento",
      cuenta_origen_id: cuenta.id,
      descripcion: `Préstamo recibido: ${acreedor}`,
      monto: montoRecibido,
      observaciones,
    });
    if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

    const { data: mov, error: errMov } = await supabaseAdmin
      .from("fin_movimientos")
      .insert([{ ...val.row, creado_por: auth.role }])
      .select()
      .single();
    if (errMov) throw errMov;

    // 2) Deuda / pasivo
    const { data: deuda, error: errDeuda } = await supabaseAdmin
      .from("fin_deudas")
      .insert([
        {
          descripcion,
          proveedor: acreedor,
          acreedor,
          monto_total: montoTotal,
          cuotas_total: cuotas,
          observaciones,
          es_prestamo: true,
          monto_recibido: montoRecibido,
          cuenta_destino: cuentaDestino,
          movimiento_financiamiento_id: mov.id,
        },
      ])
      .select()
      .single();
    if (errDeuda) throw errDeuda;

    // 3) Cuotas futuras (pasivo → pago_deuda al pagarse)
    const eventos: Array<Record<string, unknown>> = [];
    for (let i = 0; i < cuotas; i++) {
      let fecha: string;
      if (i === 0) fecha = primeraCuota;
      else if (frecuencia === "semanal") fecha = sumarDias(primeraCuota, i * 7);
      else fecha = sumarMesesFecha(primeraCuota, i);
      eventos.push({
        fecha,
        mes_contable: fecha.slice(0, 7),
        tipo: cuotas === 1 ? "deuda" : "cuota_deuda",
        estado: "pendiente",
        descripcion: cuotas === 1 ? `Devolución préstamo ${acreedor}` : `Cuota ${i + 1}/${cuotas} préstamo ${acreedor}`,
        monto: montoCuota,
        cuenta_estimada: cuentaDestino,
        probabilidad: 100,
        proveedor_cliente: acreedor,
        observaciones,
        deuda_id: deuda.id,
        cuota_numero: i + 1,
        creado_por: auth.role,
      });
    }
    if (frecuencia === "unica") eventos.length = 1;

    const { error: errEv } = await supabaseAdmin.from("fin_eventos_futuros").insert(eventos);
    if (errEv) throw errEv;

    await registrarFinLog(
      "crear_prestamo",
      "fin_deudas",
      deuda.id,
      { monto_recibido: montoRecibido, monto_total: montoTotal, cuotas, cuenta: cuentaDestino },
      auth.role
    );

    return NextResponse.json(
      {
        deuda,
        movimiento: mov,
        cuotas_creadas: eventos.length,
        interes_estimado: Math.round((montoTotal - montoRecibido) * 100) / 100,
      },
      { status: 201 }
    );
  } catch (error) {
    return failResponse(500, "Error creando el préstamo", { logContext: "finanzas prestamos POST", error });
  }
}
