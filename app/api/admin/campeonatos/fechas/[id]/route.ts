import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid, isValidDateStr, cleanString } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

// Editar una fecha: nombre, circuito, fecha_inicio, fecha_fin, observaciones.
// Solo admin. El estado (abierta/cerrada) NO se cambia acá: el cierre va por ./cerrar.
export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Fecha no encontrada" }, { status: 404 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if ("nombre" in body) updates.nombre = body.nombre ? cleanString(body.nombre, 120) : null;
    if ("circuito" in body) updates.circuito = body.circuito ? cleanString(body.circuito, 120) : null;
    if ("observaciones" in body)
      updates.observaciones = body.observaciones ? cleanString(body.observaciones, 500) : null;
    if ("numero_fecha" in body) {
      const n = Number(body.numero_fecha);
      if (!Number.isInteger(n) || n < 0)
        return NextResponse.json({ error: "Número de fecha inválido" }, { status: 400 });
      updates.numero_fecha = n;
    }
    if ("fecha_inicio" in body) {
      const v = body.fecha_inicio ? cleanString(body.fecha_inicio, 10) : null;
      if (v && !isValidDateStr(v))
        return NextResponse.json({ error: "fecha_inicio inválida" }, { status: 400 });
      updates.fecha_inicio = v;
    }
    if ("fecha_fin" in body) {
      const v = body.fecha_fin ? cleanString(body.fecha_fin, 10) : null;
      if (v && !isValidDateStr(v))
        return NextResponse.json({ error: "fecha_fin inválida" }, { status: 400 });
      updates.fecha_fin = v;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("campeonato_fechas")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error)
      return failResponse(500, "No se pudo completar la operación", {
        logContext: "admin/campeonatos/fechas/[id] PATCH",
        error,
      });
    if (!data) return NextResponse.json({ error: "Fecha no encontrada" }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
