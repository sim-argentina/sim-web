import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { pickFields, isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

function tiempoASegundos(tiempo: string): number {
  if (!tiempo?.trim()) return 999999;
  const t = tiempo.trim();
  if (t.includes(":")) {
    const [mins, secs] = t.split(":");
    return parseFloat(mins) * 60 + parseFloat(secs || "0");
  }
  return parseFloat(t) || 999999;
}

const CAMPOS = [
  "fecha",
  "hora",
  "hora_estimada_subida",
  "hora_subida",
  "hora_bajada",
  "nombre",
  "apellido",
  "telefono",
  "categoria",
  "campeonato_id",
  "campeonato_fecha_id",
  "circuito",
  "tiempo",
  "escuderia_favorita",
  "observaciones",
  "estado",
  "cantidad_minutos",
  "cantidad_turnos",
  "turno_listo",
  "pagos_detalle",
  "total",
] as const;

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = pickFields(body, CAMPOS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
    }

    if ("nombre" in updates || "apellido" in updates) {
      updates.nombre_completo = `${body.nombre || ""} ${body.apellido || ""}`.trim();
    }
    if ("tiempo" in updates) {
      updates.tiempo_segundos = tiempoASegundos(String(body.tiempo || ""));
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("campeonato_registros")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/registros/[id]", error });
    if (!data) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
