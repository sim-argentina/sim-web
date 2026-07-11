import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { limpiarPagosColectivo, resumirPagos, esFechaValida, fechaDentroDelEvento } from "@/lib/colectivo";

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);

    const { data: venta } = await supabaseAdmin
      .from("colectivo_ventas")
      .select("id, colectivo_eventos(estado, fecha_inicio, fecha_fin)")
      .eq("id", id)
      .maybeSingle();
    if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    const evento = venta.colectivo_eventos as unknown as { estado: string; fecha_inicio: string; fecha_fin: string } | null;

    // ── Anular: solo admin ──────────────────────────────────────────────────────
    if (body.accion === "anular") {
      if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede anular ventas" }, { status: 403 });
      const { error } = await supabaseAdmin
        .from("colectivo_ventas")
        .update({ estado: "anulada", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/ventas/[id] anular", error });
      return NextResponse.json({ ok: true });
    }

    if (evento && (evento.estado === "finalizado" || evento.estado === "cancelado")) {
      return NextResponse.json({ error: "El evento está cerrado. Reabrilo para editar ventas." }, { status: 400 });
    }

    const fecha = esFechaValida(body.fecha) ? body.fecha : null;
    if (!fecha) return NextResponse.json({ error: "Falta la fecha de la venta" }, { status: 400 });
    if (evento && !fechaDentroDelEvento(fecha, evento.fecha_inicio, evento.fecha_fin)) {
      return NextResponse.json({ error: "La fecha de la venta debe estar dentro del evento" }, { status: 400 });
    }

    const producto_nombre = txt(body.producto_nombre);
    if (!producto_nombre) return NextResponse.json({ error: "Elegí un producto" }, { status: 400 });
    const cantidad = Number(body.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) return NextResponse.json({ error: "La cantidad debe ser mayor a 0" }, { status: 400 });
    const precio = Number(body.precio_unitario);
    if (!Number.isFinite(precio) || precio < 0) return NextResponse.json({ error: "Precio unitario inválido" }, { status: 400 });

    const total = Math.round(cantidad * precio);
    const bonificada = body.estado === "bonificada" || body.bonificada === true;

    let pagos: ReturnType<typeof limpiarPagosColectivo> = [];
    let metodo_pago: string | null = null;
    let posnet_pago: string | null = null;
    let estado = "activa";
    if (bonificada) {
      estado = "bonificada";
    } else {
      pagos = limpiarPagosColectivo(body.pagos_detalle);
      const suma = pagos.reduce((a, p) => a + p.monto, 0);
      if (pagos.length === 0) return NextResponse.json({ error: "Cargá el/los pagos de la venta (o marcala como bonificada)" }, { status: 400 });
      if (suma !== total) return NextResponse.json({ error: `Los pagos ($${suma.toLocaleString("es-AR")}) deben sumar el total ($${total.toLocaleString("es-AR")})` }, { status: 400 });
      const r = resumirPagos(pagos);
      metodo_pago = r.metodo_pago;
      posnet_pago = r.posnet_pago;
    }

    const { data, error } = await supabaseAdmin
      .from("colectivo_ventas")
      .update({
        producto_id: isValidUuid(String(body.producto_id || "")) ? String(body.producto_id) : null,
        producto_nombre,
        fecha,
        cantidad,
        precio_unitario: Math.round(precio),
        total,
        cliente: txt(body.cliente),
        telefono: txt(body.telefono),
        observaciones: txt(body.observaciones),
        metodo_pago,
        posnet_pago,
        pagos_detalle: pagos,
        estado,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/ventas/[id] PATCH", error });
    return NextResponse.json({ ok: true, venta: data });
  } catch {
    return NextResponse.json({ error: "Error actualizando venta" }, { status: 500 });
  }
}
