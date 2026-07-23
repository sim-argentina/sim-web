import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";

// Etiqueta legible para el historial de auditoría (#8).
const ACCION_LABEL: Record<string, string> = {
  registrar_uso: "Uso registrado",
  marcar_usada: "Usada",
  marcar_pendiente: "Reactivada",
  marcar_vencida: "Vencida",
  marcar_cancelada: "Cancelada",
  observaciones: "Observaciones editadas",
  renovar: "Renovada",
};

// Registra una acción en la auditoría de la Gift Card. Nunca rompe la operación
// principal (solo agrega historial).
async function registrarGiftCardLog(
  giftCardId: string,
  accion: string,
  rol: string | undefined,
  detalle: Record<string, unknown> = {}
) {
  try {
    await supabaseAdmin.from("gift_card_logs").insert([
      { gift_card_id: giftCardId, accion, rol: rol ?? null, detalle },
    ]);
  } catch {
    /* el log nunca debe romper la acción */
  }
}

// GET: historial de auditoría de la Gift Card (admin/staff).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("gift_card_logs")
    .select("id, accion, rol, detalle, created_at")
    .eq("gift_card_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return failResponse(500, "No se pudo cargar el historial", { logContext: "admin/gift-cards/[id] GET logs", error });
  }
  return NextResponse.json({ logs: data ?? [] });
}

// Actualiza el estado de uso / observaciones de una Gift Card.
// Disponible para admin y staff. No se elimina físicamente: se usan estados.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // ID malformado (no UUID) → 404 genérico, sin consultar Postgres.
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  // Lee la fila una vez: valida existencia (404), estado de archivado y usos.
  type FilaGC = { usos_totales: number; usos_disponibles: number; deleted_at: string | null };
  const { data: filaData } = await supabaseAdmin
    .from("gift_cards")
    .select("usos_totales, usos_disponibles, deleted_at")
    .eq("id", id)
    .maybeSingle();
  const fila = (filaData as FilaGC | null) ?? null;
  if (!fila) return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });

  // ── Restaurar (des-archivar): solo admin. Limpia deleted_at/deleted_by. ──
  if (body.accion === "restaurar") {
    if (auth.role !== "admin") return NextResponse.json({ error: "Solo el admin puede restaurar Gift Cards" }, { status: 403 });
    const { error } = await supabaseAdmin
      .from("gift_cards")
      .update({ deleted_at: null, deleted_by: null, updated_at: nowIso })
      .eq("id", id);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/gift-cards/[id] restaurar", error });
    await registrarGiftCardLog(id, "Restaurada", auth.role, {});
    logSecurityEvent("gift_card_restaurada", { id, role: auth.role });
    return NextResponse.json({ ok: true });
  }

  // Una Gift Card archivada no admite nuevos usos/canjes ni cambios de estado.
  if (fila.deleted_at) return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: nowIso };

  switch (body.accion) {
    case "registrar_uso": {
      // Descuenta un uso; cuando llega a 0, la gift card queda "usada".
      const disponibles = Math.max(0, (fila?.usos_disponibles ?? 1) - 1);
      updates.usos_disponibles = disponibles;
      updates.estado_uso = disponibles <= 0 ? "usada" : "pendiente";
      updates.fecha_uso = disponibles <= 0 ? nowIso : null;
      break;
    }
    case "marcar_usada":
      updates.estado_uso = "usada";
      updates.usos_disponibles = 0;
      updates.fecha_uso = nowIso;
      break;
    case "marcar_pendiente":
      updates.estado_uso = "pendiente";
      updates.usos_disponibles = fila?.usos_totales ?? 1;
      updates.fecha_uso = null;
      break;
    case "marcar_vencida":
      updates.estado_uso = "vencida";
      break;
    case "marcar_cancelada":
      updates.estado_uso = "cancelada";
      break;
    case "observaciones":
      updates.observaciones =
        typeof body.observaciones === "string" ? body.observaciones : null;
      break;
    case "renovar": {
      // Renovar vencimiento (#5): SOLO actualiza fecha_vencimiento. No toca
      // código, comprador, importe, estado ni imagen.
      const fecha = typeof body.fecha_vencimiento === "string" ? body.fecha_vencimiento : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return NextResponse.json({ error: "Fecha de vencimiento inválida (YYYY-MM-DD)" }, { status: 400 });
      }
      updates.fecha_vencimiento = `${fecha}T12:00:00`;
      break;
    }
    default:
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("gift_cards")
    .update(updates)
    .eq("id", id);

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/gift-cards/[id]", error });

  // Auditoría (#8): registra la acción realizada. No modifica la lógica anterior.
  const accion = String(body.accion);
  const label =
    accion === "registrar_uso" && updates.estado_uso === "usada"
      ? "Usada"
      : ACCION_LABEL[accion] ?? accion;
  const detalle: Record<string, unknown> =
    accion === "renovar" ? { fecha_vencimiento: updates.fecha_vencimiento } : {};
  await registrarGiftCardLog(id, label, auth.role, detalle);

  return NextResponse.json({ ok: true });
}

// DELETE: eliminación lógica (archivado). SOLO admin. NO borra la fila ni sus
// logs, NO toca el pago real ni los datos de Mercado Pago ni movimientos de
// Finanzas: solo la oculta del panel e impide nuevos usos/canjes. Se puede
// archivar en cualquier estado (pendiente/usada/vencida/cancelada). El historial
// (pago, uso, reserva, MP, importe) se conserva íntegro.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .update({ deleted_at: new Date().toISOString(), deleted_by: auth.role, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/gift-cards/[id] DELETE", error });
  if (!data) return NextResponse.json({ error: "Gift Card no encontrada" }, { status: 404 });

  await registrarGiftCardLog(id, "Eliminada (archivada)", auth.role, {});
  logSecurityEvent("gift_card_eliminada", { id, role: auth.role });
  return NextResponse.json({ ok: true });
}
