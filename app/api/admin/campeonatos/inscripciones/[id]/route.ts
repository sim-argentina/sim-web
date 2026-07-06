import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { tiempoToMs } from "@/lib/campeonatos";
import { recalcularCategorias } from "@/lib/campeonatosCategorias";

type PagoLimpio = { metodo_pago: string; monto: number; posnet_pago: string | null };

// Normaliza pagos parciales (igual que el Turnero): descarta montos no positivos.
function limpiarPagos(input: unknown): PagoLimpio[] {
  if (!Array.isArray(input)) return [];
  const out: PagoLimpio[] = [];
  for (const p of input) {
    if (!p || typeof p !== "object") continue;
    const metodo = String((p as Record<string, unknown>).metodo_pago ?? "").trim();
    const monto = Math.round(Number((p as Record<string, unknown>).monto) || 0);
    if (!metodo || !Number.isFinite(monto) || monto <= 0) continue;
    const posnetRaw = (p as Record<string, unknown>).posnet_pago;
    const posnet = typeof posnetRaw === "string" && posnetRaw.trim() ? posnetRaw.trim() : null;
    out.push({ metodo_pago: metodo, monto, posnet_pago: posnet });
  }
  return out;
}

// Columnas operativas nuevas (hora_estimada_subida, pagos_detalle). Si la
// migración todavía no corrió, Postgres devuelve PGRST204: en ese caso se
// reintenta sin esas columnas para no romper la edición.
function faltanColumnasNuevas(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return error.code === "PGRST204" || msg.includes("pagos_detalle") || msg.includes("hora_estimada_subida");
}

// Actualiza una inscripción tolerando que las columnas nuevas aún no existan.
async function actualizarInscripcion(id: string, updates: Record<string, unknown>) {
  let { error } = await supabaseAdmin.from("campeonato_inscripciones").update(updates).eq("id", id);
  if (error && faltanColumnasNuevas(error)) {
    const compat = { ...updates };
    delete compat.hora_estimada_subida;
    delete compat.pagos_detalle;
    ({ error } = await supabaseAdmin.from("campeonato_inscripciones").update(compat).eq("id", id));
  }
  return error;
}

// Carga (o vuelve a cargar) un tiempo de clasificación para una inscripción:
// crea un registro en la Fecha 0 y recalcula categorías. Reutiliza la lógica del
// alta; el recálculo toma el MEJOR tiempo, así un segundo turno mejora el tiempo
// y la categoría automáticamente. No borra el historial de registros.
async function cargarTiempoInscripcion(inscripcionId: string, tiempoRaw: string): Promise<void> {
  const tiempo = tiempoRaw.trim();
  const crudoMs = tiempoToMs(tiempo);
  if (crudoMs == null) return;

  const { data: ins } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("campeonato_id, nombre, apellido, nombre_completo, telefono, escuderia_favorita")
    .eq("id", inscripcionId)
    .maybeSingle();
  if (!ins?.campeonato_id) return;

  const { data: fecha0 } = await supabaseAdmin
    .from("campeonato_fechas")
    .select("id, circuito")
    .eq("campeonato_id", ins.campeonato_id)
    .eq("numero_fecha", 0)
    .maybeSingle();
  if (!fecha0) return;

  await supabaseAdmin.from("campeonato_registros").insert([{
    campeonato_id: ins.campeonato_id,
    campeonato_fecha_id: fecha0.id,
    inscripcion_id: inscripcionId,
    categoria: "sin_clasificar",
    nombre: ins.nombre,
    apellido: ins.apellido,
    nombre_completo: ins.nombre_completo,
    telefono: ins.telefono,
    escuderia_favorita: ins.escuderia_favorita || null,
    circuito: fecha0.circuito || null,
    tiempo,
    tiempo_crudo_ms: crudoMs,
    penalizacion_ms: 0,
    estado: "valido",
    fecha: new Date().toISOString().slice(0, 10),
  }]);
  await recalcularCategorias(ins.campeonato_id);
}

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

  // ── Eliminar (soft-delete): solo admin. Oculta la inscripción del panel sin
  //    borrar datos (preserva contabilidad). NO toca los registros de tiempos.
  if (body.accion === "eliminar") {
    if (role !== "admin") {
      return NextResponse.json(
        { error: "Solo el admin puede eliminar inscripciones" },
        { status: 403 }
      );
    }
    const { error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .update({ eliminada_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones/[id] eliminar", error });
    return NextResponse.json({ ok: true });
  }

  // ── Cobrar en stand: marca la inscripción como pagada (admin y staff). Acepta
  //    un método simple o pagos parciales múltiples. No exige pago si ya estaba
  //    pagada online: simplemente registra el cobro que corresponda.
  if (body.accion === "cobrar_stand") {
    const pagos = limpiarPagos(body.pagos_detalle);
    const metodo = pagos.length > 0
      ? (pagos.length === 1 ? pagos[0].metodo_pago : "multiple")
      : (typeof body.metodo_pago === "string" && body.metodo_pago.trim() ? body.metodo_pago.trim() : "efectivo");
    const upd: Record<string, unknown> = { estado_pago: "pagado", metodo_pago: metodo };
    if (pagos.length > 0) {
      upd.pagos_detalle = pagos;
      upd.monto = pagos.reduce((s, p) => s + p.monto, 0);
    }
    const error = await actualizarInscripcion(id, upd);
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones/[id] cobrar", error });
    return NextResponse.json({ ok: true });
  }

  // ── Editar: admin y staff ───────────────────────────────────────────────────
  const camposPermitidos = [
    "nombre", "apellido", "nombre_completo", "telefono", "dni",
    "instagram", "escuderia_favorita", "categoria", "monto",
    "metodo_pago", "estado_pago", "observaciones",
    // Datos operativos del turno de la inscripción (como el Turnero).
    "hora_toma", "hora_estimada_subida", "hora_subida", "hora_bajada", "cantidad_minutos",
  ];

  const updates: Record<string, unknown> = {};
  for (const campo of camposPermitidos) {
    if (campo in body) updates[campo] = body[campo];
  }

  // La escudería es NOT NULL en la base: si viene vacía, se guarda cadena vacía.
  if ("escuderia_favorita" in updates && !updates.escuderia_favorita) {
    updates.escuderia_favorita = "";
  }

  // Pagos parciales múltiples: si vienen, definen el total y el método resumen.
  if ("pagos_detalle" in body) {
    const pagos = limpiarPagos(body.pagos_detalle);
    if (pagos.length > 0) {
      updates.pagos_detalle = pagos;
      updates.monto = pagos.reduce((s, p) => s + p.monto, 0);
      updates.metodo_pago = pagos.length === 1 ? pagos[0].metodo_pago : "multiple";
      if (!("estado_pago" in updates)) updates.estado_pago = "pagado";
    } else {
      updates.pagos_detalle = null;
    }
  }

  // Editar la categoría a mano = override manual: SOLO el admin la marca como
  // manual, así la auto-clasificación de Fecha 0 no la vuelve a pisar. (Staff puede
  // editarla puntualmente pero el recálculo la puede revertir.)
  if ("categoria" in updates) {
    updates.categoria_manual = role === "admin";
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

  // Tiempo (mejor tiempo / segundo turno): opcional. Se procesa aparte del update.
  const tiempoClasif = typeof body.tiempo_clasificacion === "string" ? body.tiempo_clasificacion.trim() : "";

  if (Object.keys(updates).length === 0 && !tiempoClasif) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 });
  }

  try {
    if (Object.keys(updates).length > 0) {
      const error = await actualizarInscripcion(id, updates);
      if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones/[id]", error });
    }

    // Cargar/mejorar tiempo: crea el registro en Fecha 0 y recalcula categorías.
    if (tiempoClasif) {
      await cargarTiempoInscripcion(id, tiempoClasif);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
