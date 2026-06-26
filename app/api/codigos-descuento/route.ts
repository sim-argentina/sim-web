import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";

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
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return failResponse(500, "Error cargando códigos", {
      logContext: "codigos-descuento GET",
      error,
    });
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
    solo_dias_habiles,
    dias_permitidos,
    fechas_bloqueadas,
    duraciones_permitidas,
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
        solo_dias_habiles: solo_dias_habiles === true,
        dias_permitidos:
          Array.isArray(dias_permitidos) && dias_permitidos.length > 0
            ? dias_permitidos
                .map(Number)
                .filter((n: number) => n >= 0 && n <= 6)
            : null,
        fechas_bloqueadas:
          Array.isArray(fechas_bloqueadas) && fechas_bloqueadas.length > 0
            ? fechas_bloqueadas
                .map((f: unknown) => String(f).slice(0, 10))
                .filter((f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f))
            : null,
        duraciones_permitidas:
          Array.isArray(duraciones_permitidas) &&
          duraciones_permitidas.length > 0
            ? duraciones_permitidas
                .map(Number)
                .filter((n: number) => n === 15 || n === 30)
            : null,
        activo: true,
      },
    ])
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error creando código", {
      logContext: "codigos-descuento POST",
      error,
    });
  }

  return NextResponse.json({ codigo: data }, { status: 201 });
}