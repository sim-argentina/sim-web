import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { CLASIFICACIONES, TIPOS_MOVIMIENTO, registrarFinLog } from "@/lib/finanzas";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("fin_reglas_clasificacion")
    .select("*, categoria:fin_categorias(id, nombre, tipo), cuenta:fin_cuentas(id, nombre)")
    .order("prioridad", { ascending: true });

  if (error) {
    return failResponse(500, "Error cargando reglas", {
      logContext: "finanzas reglas GET",
      error,
    });
  }
  return NextResponse.json({ reglas: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const keyword = String(body.keyword || "").trim().toLowerCase().slice(0, 60);
  if (keyword.length < 2) {
    return NextResponse.json({ error: "Keyword requerida (mínimo 2 caracteres)" }, { status: 400 });
  }

  const ambito = body.ambito ? String(body.ambito).trim() : null;
  if (ambito && !["sim", "personal"].includes(ambito)) {
    return NextResponse.json({ error: "Ámbito inválido" }, { status: 400 });
  }

  const tipo = body.tipo_sugerido ? String(body.tipo_sugerido).trim() : null;
  if (tipo && !(TIPOS_MOVIMIENTO as readonly string[]).includes(tipo)) {
    return NextResponse.json({ error: "Tipo sugerido inválido" }, { status: 400 });
  }

  const clasif = body.clasificacion_sugerida ? String(body.clasificacion_sugerida).trim() : null;
  if (clasif && !(CLASIFICACIONES as readonly string[]).includes(clasif)) {
    return NextResponse.json({ error: "Clasificación sugerida inválida" }, { status: 400 });
  }

  const categoriaId = body.categoria_id ? String(body.categoria_id) : null;
  if (categoriaId && !isValidUuid(categoriaId)) {
    return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
  }
  const cuentaId = body.cuenta_id ? String(body.cuenta_id) : null;
  if (cuentaId && !isValidUuid(cuentaId)) {
    return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_reglas_clasificacion")
    .insert([
      {
        ambito,
        keyword,
        tipo_sugerido: tipo,
        clasificacion_sugerida: clasif,
        categoria_id: categoriaId,
        cuenta_id: cuentaId,
        prioridad: Number(body.prioridad) || 100,
        activa: body.activa !== false,
      },
    ])
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error creando regla", {
      logContext: "finanzas reglas POST",
      error,
    });
  }

  await registrarFinLog("crear", "fin_reglas_clasificacion", data.id, { keyword }, auth.role);
  return NextResponse.json({ regla: data }, { status: 201 });
}
