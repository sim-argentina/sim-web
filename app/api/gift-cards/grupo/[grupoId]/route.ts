import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// GET público de todas las Gift Cards de una compra (grupo_compra_id).
// Los códigos únicos solo se revelan si el pago está aprobado.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ grupoId: string }> }
) {
  const { grupoId } = await params;

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select(
      "id, codigo_unico, comprador_nombre, destinatario_nombre, duracion_minutos, monto, cantidad, modo_uso, usos_totales, usos_disponibles, estado_pago, estado_uso, fecha_pago, created_at"
    )
    .eq("grupo_compra_id", grupoId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  }

  const pagado = data.every((d) => d.estado_pago === "pagado");

  const cards = data.map((d) => ({
    id: d.id,
    estado_pago: d.estado_pago,
    estado_uso: d.estado_uso,
    duracion_minutos: d.duracion_minutos,
    monto: d.monto,
    cantidad: d.cantidad,
    modo_uso: d.modo_uso,
    usos_totales: d.usos_totales,
    usos_disponibles: d.usos_disponibles,
    comprador_nombre: d.comprador_nombre,
    destinatario_nombre: d.destinatario_nombre,
    fecha_pago: d.fecha_pago,
    created_at: d.created_at,
    // Solo se entrega el código si el pago está aprobado.
    codigo_unico: d.estado_pago === "pagado" ? d.codigo_unico : null,
  }));

  return NextResponse.json({
    grupo_compra_id: grupoId,
    pagado,
    modo_uso: data[0].modo_uso,
    cards,
  });
}
