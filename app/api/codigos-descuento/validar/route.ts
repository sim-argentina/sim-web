import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json();

  const codigoBuscado = String(body.codigo || "").trim().toUpperCase();
  const totalOriginal = Number(body.total || 0);

  if (!codigoBuscado || totalOriginal <= 0) {
    return NextResponse.json(
      { valido: false, error: "Código o total inválido" },
      { status: 400 }
    );
  }

  const { data: codigo, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("*")
    .eq("codigo", codigoBuscado)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { valido: false, error: "Error validando código" },
      { status: 500 }
    );
  }

  if (!codigo) {
    return NextResponse.json({
      valido: false,
      error: "El código no existe",
    });
  }

  if (!codigo.activo) {
    return NextResponse.json({
      valido: false,
      error: "El código no está activo",
    });
  }

  const hoy = new Date().toISOString().slice(0, 10);

  if (codigo.fecha_inicio && hoy < codigo.fecha_inicio) {
    return NextResponse.json({
      valido: false,
      error: "El código todavía no está vigente",
    });
  }

  if (codigo.fecha_fin && hoy > codigo.fecha_fin) {
    return NextResponse.json({
      valido: false,
      error: "El código está vencido",
    });
  }

  if (
    codigo.usos_maximos !== null &&
    Number(codigo.usos_actuales || 0) >= Number(codigo.usos_maximos)
  ) {
    return NextResponse.json({
      valido: false,
      error: "El código ya alcanzó el máximo de usos",
    });
  }

  let descuento = 0;

  if (codigo.tipo_descuento === "porcentaje") {
    descuento = totalOriginal * (Number(codigo.valor_descuento) / 100);
  }

  if (codigo.tipo_descuento === "monto_fijo") {
    descuento = Number(codigo.valor_descuento);
  }

  if (codigo.tipo_descuento === "turno_gratis") {
    descuento = Number(codigo.valor_descuento);
  }

  descuento = Math.min(descuento, totalOriginal);

  const totalFinal = Math.max(totalOriginal - descuento, 0);

  return NextResponse.json({
    valido: true,
    codigo: codigo.codigo,
    tipo_descuento: codigo.tipo_descuento,
    valor_descuento: Number(codigo.valor_descuento),
    descuento,
    totalOriginal,
    totalFinal,
  });
}