import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { FECHA_RE, registrarFinLog } from "@/lib/finanzas";
import { FRECUENCIAS, generarFechasRecurrencia, validarEvento, type Frecuencia } from "@/lib/finanzasEventos";

const TIPOS_RECURRENTES = ["cobro_futuro", "pago_futuro", "gasto_fijo", "ingreso_recurrente", "compromiso_estimado", "vencimiento"];

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("fin_recurrencias")
    .select("*, categoria:fin_categorias(id, nombre)")
    .order("created_at", { ascending: false });

  if (error) {
    return failResponse(500, "Error cargando recurrencias", { logContext: "finanzas recurrencias GET", error });
  }
  return NextResponse.json({ recurrencias: data || [] });
}

// POST: crea la serie y materializa sus ocurrencias como eventos futuros.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const frecuencia = String(body.frecuencia || "").trim() as Frecuencia;
  if (!(FRECUENCIAS as readonly string[]).includes(frecuencia)) {
    return NextResponse.json({ error: "Frecuencia inválida (semanal, mensual o anual)" }, { status: 400 });
  }

  const fechaInicio = String(body.fecha_inicio || "").trim();
  if (!FECHA_RE.test(fechaInicio)) {
    return NextResponse.json({ error: "Fecha de inicio inválida (YYYY-MM-DD)" }, { status: 400 });
  }

  const fechaFin = body.fecha_fin ? String(body.fecha_fin).trim() : null;
  if (fechaFin && (!FECHA_RE.test(fechaFin) || fechaFin < fechaInicio)) {
    return NextResponse.json({ error: "Fecha de fin inválida" }, { status: 400 });
  }

  let repeticiones: number | null = null;
  if (body.cantidad_repeticiones !== undefined && body.cantidad_repeticiones !== null && body.cantidad_repeticiones !== "") {
    repeticiones = Math.trunc(Number(body.cantidad_repeticiones));
    if (!Number.isFinite(repeticiones) || repeticiones < 1 || repeticiones > 60) {
      return NextResponse.json({ error: "Cantidad de repeticiones inválida (1 a 60)" }, { status: 400 });
    }
  }

  const tipo = String(body.tipo || "").trim();
  if (!TIPOS_RECURRENTES.includes(tipo)) {
    return NextResponse.json({ error: "Tipo inválido para una recurrencia" }, { status: 400 });
  }

  // Reutiliza la validación de evento para monto/cuenta/probabilidad/categoría.
  const val = await validarEvento({ ...body, fecha: fechaInicio, tipo, estado: "pendiente" });
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });
  const base = val.row;

  try {
    const { data: rec, error: errRec } = await supabaseAdmin
      .from("fin_recurrencias")
      .insert([
        {
          frecuencia,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          cantidad_repeticiones: repeticiones,
          tipo,
          monto: base.monto,
          descripcion: base.descripcion,
          categoria_id: base.categoria_id,
          cuenta_estimada: base.cuenta_estimada,
          probabilidad: base.probabilidad,
          proveedor_cliente: base.proveedor_cliente,
          observaciones: base.observaciones,
        },
      ])
      .select()
      .single();
    if (errRec) throw errRec;

    const fechas = generarFechasRecurrencia({
      frecuencia,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      cantidad_repeticiones: repeticiones,
    });

    const eventos = fechas.map((f) => ({
      ...base,
      fecha: f,
      mes_contable: f.slice(0, 7),
      es_recurrente: true,
      recurrencia_id: rec.id,
      creado_por: auth.role,
    }));

    const { error: errEv } = await supabaseAdmin.from("fin_eventos_futuros").insert(eventos);
    if (errEv) throw errEv;

    await registrarFinLog("crear_recurrencia", "fin_recurrencias", rec.id, { tipo, frecuencia, ocurrencias: fechas.length }, auth.role);
    return NextResponse.json({ recurrencia: rec, ocurrencias_creadas: fechas.length }, { status: 201 });
  } catch (error) {
    return failResponse(500, "Error creando recurrencia", { logContext: "finanzas recurrencias POST", error });
  }
}
