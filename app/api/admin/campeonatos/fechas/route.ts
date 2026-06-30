import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import { isValidUuid, isValidDateStr, cleanString } from "@/lib/security";

// Fechas/semanas de un campeonato: número, nombre visible, circuito, ventana
// (fecha_inicio/fecha_fin) y estado abierta/cerrada. La gestión (crear/editar)
// es admin+staff; el CIERRE es admin-only (ver ./[id]/cerrar).

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const campeonato_id = new URL(req.url).searchParams.get("campeonato_id");
    let query = supabaseAdmin
      .from("campeonato_fechas")
      .select("*")
      .order("numero_fecha", { ascending: true });
    if (campeonato_id) {
      // ID malformado → lista vacía (no consultar con uuid inválido).
      if (!isValidUuid(campeonato_id)) return NextResponse.json([]);
      query = query.eq("campeonato_id", campeonato_id);
    }
    const { data, error } = await query;
    if (error)
      return failResponse(500, "No se pudo completar la operación", {
        logContext: "admin/campeonatos/fechas GET",
        error,
      });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Crear fecha: solo admin (gestión del calendario).
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const campeonato_id = body?.campeonato_id;
    if (typeof campeonato_id !== "string" || !isValidUuid(campeonato_id)) {
      return NextResponse.json({ error: "Campeonato inválido" }, { status: 400 });
    }
    const numero_fecha = Number(body?.numero_fecha);
    if (!Number.isInteger(numero_fecha) || numero_fecha < 1) {
      return NextResponse.json({ error: "El número de fecha es obligatorio" }, { status: 400 });
    }
    const fecha_inicio = body?.fecha_inicio ? cleanString(body.fecha_inicio, 10) : null;
    const fecha_fin = body?.fecha_fin ? cleanString(body.fecha_fin, 10) : null;
    if (fecha_inicio && !isValidDateStr(fecha_inicio)) {
      return NextResponse.json({ error: "fecha_inicio inválida" }, { status: 400 });
    }
    if (fecha_fin && !isValidDateStr(fecha_fin)) {
      return NextResponse.json({ error: "fecha_fin inválida" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("campeonato_fechas")
      .insert([
        {
          campeonato_id,
          numero_fecha,
          nombre: body?.nombre ? cleanString(body.nombre, 120) : null,
          circuito: body?.circuito ? cleanString(body.circuito, 120) : null,
          fecha_inicio,
          fecha_fin,
          observaciones: body?.observaciones ? cleanString(body.observaciones, 500) : null,
          estado: "abierta",
        },
      ])
      .select()
      .single();

    if (error)
      return failResponse(500, "No se pudo completar la operación", {
        logContext: "admin/campeonatos/fechas POST",
        error,
      });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
