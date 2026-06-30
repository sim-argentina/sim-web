import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const role = auth.role;

  const { id } = await params;
  // ID malformado (no UUID) → 404 genérico, sin consultar Postgres.
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Inscripción no encontrada" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Body vacío = acción de cancelar (compatibilidad con versión anterior)
    body = { accion: "cancelar" };
  }

  // ── Cancelar: solo admin ────────────────────────────────────────────────────
  if (body.accion === "cancelar") {
    if (role !== "admin") {
      return NextResponse.json(
        { error: "Solo el admin puede cancelar inscripciones" },
        { status: 403 }
      );
    }
    const { error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .update({ estado_pago: "cancelado" })
      .eq("id", id);

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones/[id]", error });
    return NextResponse.json({ ok: true });
  }

  // ── Editar: admin y staff ───────────────────────────────────────────────────
  const camposPermitidos = [
    "nombre", "apellido", "nombre_completo", "telefono", "dni",
    "instagram", "escuderia_favorita", "categoria", "monto",
    "metodo_pago", "estado_pago",
  ];

  const updates: Record<string, unknown> = {};
  for (const campo of camposPermitidos) {
    if (campo in body) updates[campo] = body[campo];
  }

  // Si se actualizan nombre/apellido, recalcular nombre_completo
  if ("nombre" in updates || "apellido" in updates) {
    // Obtener los datos actuales para combinar
    const { data: actual } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .select("nombre, apellido")
      .eq("id", id)
      .single();

    const nombre = (updates.nombre as string) ?? actual?.nombre ?? "";
    const apellido = (updates.apellido as string) ?? actual?.apellido ?? "";
    updates.nombre_completo = `${nombre.trim()} ${apellido.trim()}`.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .update(updates)
      .eq("id", id);

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones/[id]", error });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
