import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { FECHA_RE, registrarFinLog } from "@/lib/finanzas";
import { FRECUENCIAS, generarFechasRecurrencia, hoyISO, validarEvento, type Frecuencia } from "@/lib/finanzasEventos";

type Params = { params: Promise<{ id: string }> };

async function getRecurrencia(id: string) {
  const { data, error } = await supabaseAdmin.from("fin_recurrencias").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// PUT: edita la serie completa y regenera las ocurrencias FUTURAS pendientes
// no editadas a mano. Las pagadas/cobradas/canceladas/editadas quedan intactas.
export async function PUT(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Recurrencia no encontrada" }, { status: 404 });

  try {
    const rec = await getRecurrencia(id);
    if (!rec) return NextResponse.json({ error: "Recurrencia no encontrada" }, { status: 404 });

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const merged = { ...rec, ...body };

    const frecuencia = String(merged.frecuencia) as Frecuencia;
    if (!(FRECUENCIAS as readonly string[]).includes(frecuencia)) {
      return NextResponse.json({ error: "Frecuencia inválida" }, { status: 400 });
    }
    const fechaInicio = String(merged.fecha_inicio).slice(0, 10);
    if (!FECHA_RE.test(fechaInicio)) return NextResponse.json({ error: "Fecha de inicio inválida" }, { status: 400 });
    const fechaFin = merged.fecha_fin ? String(merged.fecha_fin).slice(0, 10) : null;
    if (fechaFin && (!FECHA_RE.test(fechaFin) || fechaFin < fechaInicio)) {
      return NextResponse.json({ error: "Fecha de fin inválida" }, { status: 400 });
    }
    let repeticiones: number | null = null;
    if (merged.cantidad_repeticiones !== undefined && merged.cantidad_repeticiones !== null && merged.cantidad_repeticiones !== "") {
      repeticiones = Math.trunc(Number(merged.cantidad_repeticiones));
      if (!Number.isFinite(repeticiones) || repeticiones < 1 || repeticiones > 60) {
        return NextResponse.json({ error: "Cantidad de repeticiones inválida" }, { status: 400 });
      }
    }

    const val = await validarEvento({ ...merged, fecha: fechaInicio, estado: "pendiente" });
    if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });
    const base = val.row;

    const activa = body.activa === undefined ? rec.activa : Boolean(body.activa);

    const { data: recNueva, error: errUp } = await supabaseAdmin
      .from("fin_recurrencias")
      .update({
        frecuencia,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        cantidad_repeticiones: repeticiones,
        monto: base.monto,
        descripcion: base.descripcion,
        categoria_id: base.categoria_id,
        cuenta_estimada: base.cuenta_estimada,
        probabilidad: base.probabilidad,
        proveedor_cliente: base.proveedor_cliente,
        observaciones: base.observaciones,
        activa,
      })
      .eq("id", id)
      .select()
      .single();
    if (errUp) throw errUp;

    // Regenerar solo ocurrencias regenerables: pendientes/estimadas, sin editar
    // a mano, sin movimiento real y con fecha de hoy en adelante.
    const hoy = hoyISO();
    const { error: errDel } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .delete()
      .eq("recurrencia_id", id)
      .in("estado", ["pendiente", "estimado"])
      .eq("editado_manual", false)
      .is("movimiento_id", null)
      .gte("fecha", hoy);
    if (errDel) throw errDel;

    let creadas = 0;
    if (activa) {
      // Fechas que ya tienen ocurrencia intocable (pagada, editada, cancelada...)
      const { data: existentes, error: errEx } = await supabaseAdmin
        .from("fin_eventos_futuros")
        .select("fecha")
        .eq("recurrencia_id", id);
      if (errEx) throw errEx;
      const ocupadas = new Set((existentes || []).map((e) => String(e.fecha)));

      const fechas = generarFechasRecurrencia({
        frecuencia,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        cantidad_repeticiones: repeticiones,
      }).filter((f) => f >= hoy && !ocupadas.has(f));

      if (fechas.length > 0) {
        const eventos = fechas.map((f) => ({
          ...base,
          fecha: f,
          mes_contable: f.slice(0, 7),
          tipo: recNueva.tipo,
          es_recurrente: true,
          recurrencia_id: id,
          creado_por: auth.role,
        }));
        const { error: errIns } = await supabaseAdmin.from("fin_eventos_futuros").insert(eventos);
        if (errIns) throw errIns;
        creadas = fechas.length;
      }
    }

    await registrarFinLog("editar_recurrencia", "fin_recurrencias", id, { regeneradas: creadas, activa }, auth.role);
    return NextResponse.json({ recurrencia: recNueva, ocurrencias_regeneradas: creadas });
  } catch (error) {
    return failResponse(500, "Error actualizando recurrencia", { logContext: "finanzas recurrencias PUT", error });
  }
}

// DELETE: cancela la serie completa (desactiva la recurrencia y cancela las
// ocurrencias pendientes no editadas). Lo pagado/cobrado queda como historial.
export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Recurrencia no encontrada" }, { status: 404 });

  try {
    const rec = await getRecurrencia(id);
    if (!rec) return NextResponse.json({ error: "Recurrencia no encontrada" }, { status: 404 });

    const { error: errRec } = await supabaseAdmin.from("fin_recurrencias").update({ activa: false }).eq("id", id);
    if (errRec) throw errRec;

    const { error: errEv } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .update({ estado: "cancelado" })
      .eq("recurrencia_id", id)
      .in("estado", ["pendiente", "estimado"]);
    if (errEv) throw errEv;

    await registrarFinLog("cancelar_recurrencia", "fin_recurrencias", id, {}, auth.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failResponse(500, "Error cancelando recurrencia", { logContext: "finanzas recurrencias DELETE", error });
  }
}
