import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";

function generarCodigo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "SIM-";

  for (let i = 0; i < 6; i++) {
    codigo += chars[randomInt(0, chars.length)];
  }

  return codigo;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Error cargando códigos", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ codigos: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json();

  const {
    codigo,
    descripcion,
    tipo_descuento,
    valor_descuento,
    usos_maximos,
    fecha_inicio,
    fecha_fin,
    creado_para,
  } = body;

  const codigoFinal = codigo?.trim().toUpperCase() || generarCodigo();

  if (!tipo_descuento || !valor_descuento) {
    return NextResponse.json(
      { error: "Falta tipo o valor de descuento" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("codigos_descuento")
    .insert([
      {
        codigo: codigoFinal,
        descripcion: descripcion || null,
        tipo_descuento,
        valor_descuento: Number(valor_descuento),
        usos_maximos: usos_maximos ? Number(usos_maximos) : null,
        fecha_inicio: fecha_inicio || null,
        fecha_fin: fecha_fin || null,
        creado_para: creado_para || null,
        activo: true,
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Error creando código", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ codigo: data }, { status: 201 });
}