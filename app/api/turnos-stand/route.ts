import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";

function limpiarPagosDetalle(pagos: any[]) {
  if (!Array.isArray(pagos)) return [];

  return pagos
    .map((pago) => ({
      metodo_pago: pago?.metodo_pago || "qr",
      monto: Number(pago?.monto) || 0,
      posnet_pago: pago?.posnet_pago || null,
    }))
    .filter((pago) => pago.monto > 0);
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    // Filtro opcional por fecha/rango: evita traer toda la tabla cuando solo se
    // necesita el día/semana/mes visible. Sin parámetros mantiene el
    // comportamiento anterior (todos los turnos), que usan las métricas.
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get("fecha");
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");

    // Paginación interna: PostgREST corta en 1000 filas por request. Sin este
    // bucle, las métricas veían solo las primeras 1000 (ordenadas por fecha),
    // subestimando ventas/facturación de los meses más recientes. Traemos todas
    // las filas que matchean el filtro en lotes de 1000.
    const pageSize = 1000;
    let from = 0;
    const turnos: unknown[] = [];

    while (true) {
      let query = supabaseAdmin
        .from("turnos_stand")
        .select("*")
        .order("fecha", { ascending: true })
        .order("hora", { ascending: true })
        .range(from, from + pageSize - 1);

      if (fecha && FECHA_RE.test(fecha)) {
        query = query.eq("fecha", fecha);
      } else {
        if (desde && FECHA_RE.test(desde)) query = query.gte("fecha", desde);
        if (hasta && FECHA_RE.test(hasta)) query = query.lte("fecha", hasta);
      }

      const { data, error } = await query;

      if (error) {
        return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-stand", error });
      }

      const lote = data ?? [];
      turnos.push(...lote);
      if (lote.length < pageSize) break;
      from += pageSize;
    }

    return NextResponse.json({ turnos });
  } catch {
    return NextResponse.json(
      { error: "Error cargando turnos" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();

    const pagosDetalle = limpiarPagosDetalle(body.pagos_detalle || []);
    const totalPagos = pagosDetalle.reduce((acc, pago) => acc + pago.monto, 0);
    const posnets = pagosDetalle
      .map((pago) => pago.posnet_pago)
      .filter(Boolean)
      .join(" + ");

    const metodoPago =
      pagosDetalle.length > 1
        ? "mixto"
        : pagosDetalle[0]?.metodo_pago || body.metodo_pago || "qr";

    const total = totalPagos > 0 ? totalPagos : Number(body.total) || 0;

    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .insert([
        {
          nombre: body.nombre,
          telefono: body.telefono,
          fecha: body.fecha,
          hora: body.hora,
          hora_estimada_subida: body.hora_estimada_subida || null,
          hora_subida: body.hora_subida || null,
          hora_bajada: body.hora_bajada || null,
          simuladores: body.simuladores || [],
          cantidad_simuladores: body.simuladores?.length || 0,
          cantidad_personas: Number(body.cantidad_personas) || 1,
          cantidad_minutos: Number(body.cantidad_minutos) || 15,
          cantidad_turnos: Number(body.cantidad_turnos) || 1,
          metodo_pago: metodoPago,
          posnet_pago: posnets || body.posnet_pago || null,
          pagos_detalle: pagosDetalle,
          turno_listo: Boolean(body.turno_listo) || false,
          total,
          estado: "activo",
          observaciones: body.observaciones,
        },
      ])
      .select()
      .single();

    if (error) {
      return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-stand", error });
    }

    return NextResponse.json({ ok: true, turno: data });
  } catch {
    return NextResponse.json({ error: "Error creando turno" }, { status: 500 });
  }
}
