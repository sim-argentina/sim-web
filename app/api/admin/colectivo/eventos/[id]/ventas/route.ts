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

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const fecha = new URL(req.url).searchParams.get("fecha");
  let query = supabaseAdmin
    .from("colectivo_ventas")
    .select(COLUMNAS_VENTA_COLECTIVO)
    .eq("evento_id", id)
    .order("fecha_hora", { ascending: false });
  if (fecha && FECHA_RE.test(fecha)) query = query.eq("fecha", fecha);

  const { data, error } = await query;
  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/ventas GET", error });
  return NextResponse.json({ ventas: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  try {
    const body = await req.json();

    const { data: evento } = await supabaseAdmin
      .from("colectivo_eventos")
      .select("id, estado, fecha_inicio, fecha_fin")
      .eq("id", id)
      .maybeSingle();
    if (!evento) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
    if (evento.estado === "finalizado") return NextResponse.json({ error: "El evento está finalizado. Reabrilo para cargar ventas." }, { status: 400 });
    if (evento.estado === "cancelado") return NextResponse.json({ error: "El evento está cancelado." }, { status: 400 });

    const fecha = esFechaValida(body.fecha) ? body.fecha : null;
    if (!fecha) return NextResponse.json({ error: "Falta la fecha de la venta" }, { status: 400 });
    if (!fechaDentroDelEvento(fecha, evento.fecha_inicio, evento.fecha_fin)) {
      return NextResponse.json({ error: "La fecha de la venta debe estar dentro del evento" }, { status: 400 });
    }

    // El producto sale del catálogo y tiene que estar activo y habilitado en este
    // evento. El nombre que queda en la venta es el del catálogo, no el que mande el navegador.
    const producto_id = String(body.producto_id || "");
    if (!isValidUuid(producto_id)) return NextResponse.json({ error: "Elegí un producto" }, { status: 400 });
    const vendible = await productoVendibleEnEvento(id, producto_id);
    if (!vendible.ok) {
      if (vendible.status === 500) return failResponse(500, vendible.error, { logContext: "colectivo/ventas POST producto", error: vendible.detalle });
      return NextResponse.json({ error: vendible.error }, { status: vendible.status });
    }
    const producto_nombre = vendible.valor.nombre;

    const cantidad = normalizarCantidadVentaColectivo(body.cantidad);
    if (cantidad === null) return NextResponse.json({ error: "Elegí una cantidad entre 1 y 20" }, { status: 400 });
    // Precio de ESTA venta: el que cargó el operador; si no mandó ninguno, el
    // predeterminado del catálogo. Cambiar el catálogo después no lo altera.
    const sinPrecio = body.precio_unitario === undefined || body.precio_unitario === null || body.precio_unitario === "";
    const precio = sinPrecio ? vendible.valor.precio_predeterminado : Number(body.precio_unitario);
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

    const nowIso = new Date().toISOString();
    const fecha_hora = typeof body.fecha_hora === "string" && body.fecha_hora ? body.fecha_hora : nowIso;

    const { data, error } = await supabaseAdmin
      .from("colectivo_ventas")
      .insert([{
        evento_id: id,
        producto_id,
        producto_nombre,
        fecha,
        fecha_hora,
        cantidad,
        precio_unitario: Math.round(precio),
        total,
        observaciones: txt(body.observaciones),
        metodo_pago,
        posnet_pago,
        pagos_detalle: pagos,
        estado,
        created_by: auth.role,
      }])
      .select(COLUMNAS_VENTA_COLECTIVO)
      .single();
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "colectivo/ventas POST", error });

    if (evento.estado === "proximo") {
      await supabaseAdmin.from("colectivo_eventos").update({ estado: "activo", updated_at: nowIso }).eq("id", id);
    }
    return NextResponse.json({ ok: true, venta: data });
  } catch {
    return NextResponse.json({ error: "Error registrando venta" }, { status: 500 });
  }
}
