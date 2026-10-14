import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import {
  limpiarPagosColectivo, resumirPagos, esFechaValida, fechaDentroDelEvento, COLUMNAS_VENTA_COLECTIVO,
  normalizarCantidadVentaColectivo,
} from "@/lib/colectivo";
import { productoVendibleEnEvento } from "@/lib/colectivoProductos";

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
      .select("id, evento_id, producto_id, cantidad, colectivo_eventos(estado, fecha_inicio, fecha_fin)")
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

    // Mismo producto: la venta conserva el suyo aunque hoy ya no esté disponible
    // (deshabilitado en el evento o inactivo en el catálogo). Cambiarlo por otro
    // exige que ese otro sea vendible en el evento, y toma su nombre del catálogo.
    const productoPedido = String(body.producto_id || "");
    let cambioProducto: { producto_id: string; producto_nombre: string } | null = null;
    if (productoPedido && productoPedido !== venta.producto_id) {
      if (!isValidUuid(productoPedido)) return NextResponse.json({ error: "Elegí un producto" }, { status: 400 });
      const vendible = await productoVendibleEnEvento(venta.evento_id as string, productoPedido);
      if (!vendible.ok) {
        if (vendible.status === 500) return failResponse(500, vendible.error, { logContext: "colectivo/ventas/[id] producto", error: vendible.detalle });
        return NextResponse.json({ error: vendible.error }, { status: vendible.status });
      }
      cambioProducto = { producto_id: vendible.valor.id, producto_nombre: vendible.valor.nombre };
    }

    // Una venta histórica con más de 20 unidades se puede editar si no cambia la cantidad.
    const cantidad = normalizarCantidadVentaColectivo(body.cantidad, Number(venta.cantidad) || null);
    if (cantidad === null) return NextResponse.json({ error: "Elegí una cantidad entre 1 y 20" }, { status: 400 });
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
        ...cambioProducto,
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
      .select(COLUMNAS_VENTA_COLECTIVO)
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/ventas/[id] PATCH", error });
    return NextResponse.json({ ok: true, venta: data });
  } catch {
    return NextResponse.json({ error: "Error actualizando venta" }, { status: 500 });
  }
}
