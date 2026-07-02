import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getConfiguracion, registrarFinLog } from "@/lib/finanzas";

const CAMPOS_NUM = [
  "cantidad_simuladores",
  "horas_operativas_dia",
  "duracion_turno_min",
  "dias_operativos_mes",
  "valor_activos",
  "inversion_inicial",
  "meta_facturacion",
  "meta_margen_operativo",
  "meta_ocupacion",
] as const;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const configuracion = await getConfiguracion();
    return NextResponse.json({ configuracion });
  } catch (error) {
    return failResponse(500, "Error cargando configuración", {
      logContext: "finanzas configuracion GET",
      error,
    });
  }
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const patch: Record<string, number> = {};

  for (const campo of CAMPOS_NUM) {
    if (body[campo] === undefined) continue;
    const n = Number(body[campo]);
    if (!Number.isFinite(n) || n < 0 || n > 1e13) {
      return NextResponse.json({ error: `Valor inválido en ${campo}` }, { status: 400 });
    }
    patch[campo] = n;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("fin_configuracion")
    .upsert([{ id: 1, ...patch }], { onConflict: "id" });

  if (error) {
    return failResponse(500, "Error guardando configuración", {
      logContext: "finanzas configuracion PUT",
      error,
    });
  }

  await registrarFinLog("editar", "fin_configuracion", "1", patch, auth.role);
  const configuracion = await getConfiguracion();
  return NextResponse.json({ configuracion });
}
