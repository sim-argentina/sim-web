import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// GET público de una Gift Card para la pantalla de éxito / descarga.
// El código único solo se revela si el pago está aprobado.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select(
      "id, codigo_unico, destinatario_nombre, duracion_minutos, monto, estado_pago, estado_uso, fecha_pago, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("gift-cards/[id]:", error.message);
    return NextResponse.json({ error: "Error al obtener la Gift Card" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });
  }

  const pagada = data.estado_pago === "pagado";

  return NextResponse.json({
    id: data.id,
    estado_pago: data.estado_pago,
    estado_uso: data.estado_uso,
    duracion_minutos: data.duracion_minutos,
    monto: data.monto,
    destinatario_nombre: data.destinatario_nombre,
    fecha_pago: data.fecha_pago,
    created_at: data.created_at,
    // Solo se entrega el código si está pagada.
    codigo_unico: pagada ? data.codigo_unico : null,
  });
}
