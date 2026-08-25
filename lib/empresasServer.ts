// Orquestación servidor del módulo Empresas: combina la lógica pura (lib/empresas)
// con la persistencia (supabaseAdmin) y el canje ATÓMICO (RPC consumir_empresa_codigo).
// Solo se importa desde route handlers (server) / tests. No toca reservas ni finanzas.
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  calcularVencimiento, formatearCodigo, estadoEfectivo, estadoCodigoEfectivo,
  metricasCampania, ivaDesglose, inicioValido, type Modalidad,
} from "@/lib/empresas";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import { reservaEstaBloqueada } from "@/lib/bloqueos";

export type Resultado<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Resultado<never> => ({ ok: false, status, error });
const ok = <T>(data: T): Resultado<T> => ({ ok: true, data });
const hoyIso = () => new Date().toISOString().slice(0, 10);

// El estado NO es manual: se deriva (borrador→activa al pagar; programada/vencida por
// fechas; finalizada/cancelada por acción explícita). estado_pago/fecha_pago cambian
// solo vía "Marcar pagada". Por eso no están entre los campos editables del formulario.
const CAMPOS_EDITABLES = [
  "empresa", "nombre_campania", "contacto_nombre", "contacto_telefono", "contacto_email",
  "cuit", "modalidad", "cantidad_contratada", "duracion_minutos", "usos_por_codigo",
  "precio_neto", "iva_porcentaje", "fecha_inicio", "observaciones",
] as const;

function limpiarCampania(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_EDITABLES) {
    if (k in body) out[k] = body[k];
  }
  // Normalizaciones numéricas.
  for (const n of ["cantidad_contratada", "duracion_minutos", "usos_por_codigo", "precio_neto", "iva_porcentaje"]) {
    if (n in out) out[n] = Number(out[n]) || 0;
  }
  if ("modalidad" in out && out.modalidad !== "mensual") out.modalidad = "unica";
  return out;
}

// Recalcula fecha_vencimiento cuando hay inicio + modalidad.
function conVencimiento(row: Record<string, unknown>, modalidad: string, fechaInicio: string | null): Record<string, unknown> {
  return { ...row, fecha_vencimiento: calcularVencimiento(fechaInicio, modalidad) };
}

// ── Campañas ──────────────────────────────────────────────────────────────────

export async function listarCampanias(opts: { q?: string | null; estado?: string | null; incluirArchivadas?: boolean }): Promise<Resultado<unknown>> {
  let query = supabaseAdmin.from("empresa_campanias").select("*").order("created_at", { ascending: false });
  if (!opts.incluirArchivadas) query = query.is("deleted_at", null);
  if (opts.q) query = query.or(`empresa.ilike.%${opts.q}%,nombre_campania.ilike.%${opts.q}%`);
  const { data, error } = await query;
  if (error) return fail(500, "No se pudieron cargar las campañas.");
  const hoy = hoyIso();
  // Conteo de códigos por campaña (barato) para el listado.
  const ids = (data ?? []).map((c) => c.id);
  const conteos = new Map<string, { generados: number; utilizados: number }>();
  if (ids.length) {
    const { data: cods } = await supabaseAdmin.from("empresa_codigos").select("campania_id, estado").in("campania_id", ids);
    for (const c of cods ?? []) {
      const acc = conteos.get(c.campania_id) ?? { generados: 0, utilizados: 0 };
      acc.generados++;
      if (c.estado === "utilizado") acc.utilizados++;
      conteos.set(c.campania_id, acc);
    }
  }
  const rows = (data ?? [])
    .map((c) => {
      const est = estadoEfectivo(c, hoy);
      const cnt = conteos.get(c.id) ?? { generados: 0, utilizados: 0 };
      return { ...c, estado_efectivo: est, ...ivaDesglose(Number(c.precio_neto), Number(c.iva_porcentaje)), generados: cnt.generados, utilizados: cnt.utilizados };
    })
    .filter((c) => !opts.estado || c.estado_efectivo === opts.estado);
  return ok(rows);
}

function validarCampania(row: Record<string, unknown>): string | null {
  if (!String(row.empresa ?? "").trim()) return "La empresa es obligatoria.";
  if (!String(row.nombre_campania ?? "").trim()) return "El nombre de la campaña es obligatorio.";
  const inicio = (row.fecha_inicio as string) || null;
  const pago = (row.fecha_pago as string) || null;
  if (inicio && !inicioValido(pago, inicio)) return "La fecha de inicio debe estar entre el pago y 30 días después.";
  return null;
}

export async function crearCampania(body: Record<string, unknown>, createdBy: string): Promise<Resultado<unknown>> {
  const row = limpiarCampania(body);
  const err = validarCampania(row);
  if (err) return fail(400, err);
  const modalidad = (row.modalidad as Modalidad) ?? "unica";
  const conVen = conVencimiento(row, modalidad, (row.fecha_inicio as string) ?? null);
  // Siempre nace en borrador; se confirma (activa) al marcarla pagada.
  const { data, error } = await supabaseAdmin
    .from("empresa_campanias").insert({ ...conVen, estado: "borrador", estado_pago: "pendiente", created_by: createdBy }).select("*").single();
  if (error) return fail(500, "No se pudo crear la campaña.");
  return ok(data);
}

export async function actualizarCampania(id: string, body: Record<string, unknown>): Promise<Resultado<unknown>> {
  const { data: actual } = await supabaseAdmin.from("empresa_campanias").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!actual) return fail(404, "Campaña no encontrada.");
  const row = limpiarCampania(body);
  const merged = { ...actual, ...row };
  const err = validarCampania(merged);
  if (err) return fail(400, err);
  const conVen = conVencimiento(row, (merged.modalidad as string) ?? "unica", (merged.fecha_inicio as string) ?? null);
  const { data, error } = await supabaseAdmin
    .from("empresa_campanias").update({ ...conVen, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) return fail(500, "No se pudo actualizar la campaña.");
  return ok(data);
}

export async function softDeleteCampania(id: string, by: string): Promise<Resultado<unknown>> {
  const { data, error } = await supabaseAdmin
    .from("empresa_campanias").update({ deleted_at: new Date().toISOString(), deleted_by: by, updated_at: new Date().toISOString() })
    .eq("id", id).is("deleted_at", null).select("id").maybeSingle();
  if (error) return fail(500, "No se pudo archivar la campaña.");
  if (!data) return fail(404, "Campaña no encontrada.");
  return ok({ ok: true });
}

// Estado completo de una campaña (para el detalle admin): datos + métricas reales.
export async function getCampania(id: string): Promise<Resultado<unknown>> {
  const { data: campania } = await supabaseAdmin.from("empresa_campanias").select("*").eq("id", id).maybeSingle();
  if (!campania) return fail(404, "Campaña no encontrada.");
  const [{ data: codigos }, { data: usos }] = await Promise.all([
    supabaseAdmin.from("empresa_codigos").select("*").eq("campania_id", id).order("created_at"),
    supabaseAdmin.from("empresa_codigo_usos").select("*").eq("campania_id", id).order("created_at"),
  ]);
  const hoy = hoyIso();
  const metricas = metricasCampania({ campania, codigos: codigos ?? [], usos: usos ?? [], hoy });

  // Enriquecer cada uso con su reserva real (simuladores/fecha/hora/estado/no-show).
  const reservaIds = (usos ?? []).map((u) => u.reserva_id).filter((x): x is number => x != null);
  const reservasById = new Map<number, Record<string, unknown>>();
  if (reservaIds.length) {
    const { data: reservas } = await supabaseAdmin
      .from("reservas").select("id, fecha, hora, duracion_minutos, simuladores, estado, no_show").in("id", reservaIds);
    (reservas ?? []).forEach((r) => reservasById.set(r.id, r));
  }
  const usosDto = (usos ?? []).map((u) => ({ ...u, reserva: u.reserva_id != null ? reservasById.get(u.reserva_id) ?? null : null }));

  // Distribución por simulador (de reservas reales). Fuente real, no hardcodeada.
  const porSimulador: Record<string, number> = {};
  for (const u of usosDto) {
    const sims = Array.isArray((u.reserva as { simuladores?: unknown })?.simuladores) ? (u.reserva as { simuladores: string[] }).simuladores : [];
    for (const s of sims) porSimulador[String(s)] = (porSimulador[String(s)] || 0) + 1;
  }

  return ok({
    campania: { ...campania, ...ivaDesglose(Number(campania.precio_neto), Number(campania.iva_porcentaje)) },
    metricas,
    codigos: (codigos ?? []).map((c) => ({ ...c, estado_efectivo: estadoCodigoEfectivo(c, metricas.estado) })),
    usos: usosDto,
    simuladores: Object.entries(porSimulador).map(([nombre, usos]) => ({ nombre, usos })).sort((a, b) => b.usos - a.usos),
  });
}

// ── Generación de códigos ─────────────────────────────────────────────────────

function nuevoCodigo(): string {
  return formatearCodigo(new Uint8Array(randomBytes(12)));
}

// Genera los códigos contratados. Solo si la campaña está pagada y aún no generó.
// Idempotente por la bandera codigos_generados (§40: generar ≠ exportar).
export async function generarCodigos(id: string): Promise<Resultado<unknown>> {
  const { data: campania } = await supabaseAdmin.from("empresa_campanias").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!campania) return fail(404, "Campaña no encontrada.");
  if (campania.estado === "cancelada") return fail(409, "La campaña está cancelada.");
  if (campania.estado_pago !== "pagado") return fail(409, "La campaña no está paga: no se pueden generar códigos.");
  if (campania.codigos_generados) return fail(409, "Los códigos ya fueron generados para esta campaña.");
  const cantidad = Number(campania.cantidad_contratada) || 0;
  if (cantidad < 1) return fail(400, "La cantidad contratada debe ser al menos 1.");

  const usosMax = Number(campania.usos_por_codigo) || 1;
  // Genera un set localmente único; el UNIQUE de DB cubre colisiones globales.
  for (let intento = 0; intento < 3; intento++) {
    const set = new Set<string>();
    while (set.size < cantidad) set.add(nuevoCodigo());
    const filas = Array.from(set).map((codigo) => ({ campania_id: id, codigo, usos_maximos: usosMax }));
    const { error } = await supabaseAdmin.from("empresa_codigos").insert(filas);
    if (!error) {
      await supabaseAdmin.from("empresa_campanias")
        .update({ codigos_generados: true, updated_at: new Date().toISOString() }).eq("id", id);
      return ok({ generados: cantidad });
    }
    if (!String(error.message || "").toLowerCase().includes("unique") && error.code !== "23505") {
      return fail(500, "No se pudieron generar los códigos.");
    }
    // Colisión (rarísima): reintenta con nuevos códigos.
  }
  return fail(500, "No se pudieron generar los códigos (colisión persistente).");
}

// ── Informe (dataset agregado para PDF/Excel; lo arma el cliente) ─────────────
export async function datosInforme(id: string, tipo: "parcial" | "definitivo"): Promise<Resultado<unknown>> {
  const est = await getCampania(id);
  if (!est.ok) return est;
  const data = est.data as {
    campania: Record<string, unknown>; metricas: Record<string, unknown>;
    codigos: unknown[]; usos: Array<Record<string, unknown> & { reserva?: { fecha?: string } | null }>; simuladores: unknown[];
  };

  // Evolución por día (dato real): fecha de la reserva si existe, si no la del canje.
  const porDia: Record<string, number> = {};
  for (const u of data.usos) {
    const d = String(u.reserva?.fecha ?? u.created_at ?? "").slice(0, 10);
    if (d) porDia[d] = (porDia[d] || 0) + 1;
  }
  const evolucion = Object.entries(porDia).sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, canjes]) => ({ fecha, canjes }));

  // Registrar la generación del informe (sin guardar binarios).
  const patch: Record<string, unknown> = { ultimo_informe_at: new Date().toISOString() };
  if (tipo === "definitivo") patch.informe_definitivo_at = new Date().toISOString();
  await supabaseAdmin.from("empresa_campanias").update(patch).eq("id", id);

  return ok({ tipo, generado_at: new Date().toISOString(), ...data, evolucion });
}

// ── Canje público ─────────────────────────────────────────────────────────────

// Validación READ-ONLY (para la web). Respuesta genérica: no revela por qué falla
// (evita enumeración). Devuelve el beneficio si el código es canjeable ahora.
export async function validarCodigo(codigo: string): Promise<Resultado<unknown>> {
  const cod = String(codigo ?? "").trim().toUpperCase();
  if (!cod) return fail(400, "Código inválido o no disponible.");
  const { data: c } = await supabaseAdmin.from("empresa_codigos").select("*").eq("codigo", cod).maybeSingle();
  if (!c) return fail(404, "Código inválido o no disponible.");
  const { data: camp } = await supabaseAdmin.from("empresa_campanias").select("*").eq("id", c.campania_id).maybeSingle();
  const hoy = hoyIso();
  const canjeable = camp && estadoEfectivo(camp, hoy) === "activa" && c.estado === "disponible" && c.usos_actuales < c.usos_maximos;
  if (!canjeable) return fail(409, "Código inválido o no disponible.");
  return ok({
    valido: true,
    beneficio: { duracion_minutos: Number(camp!.duracion_minutos) || 15, experiencia: 1 },
    vence: camp!.fecha_vencimiento,
  });
}

// Reserva + canje ATÓMICO (Fase 2). Valida el código (read-only), computa los slots
// con la MISMA lógica de Reservas, chequea bloqueos y ejecuta la transacción
// crear_reserva_empresa (reserva + slots + consumo + uso vinculado, todo o nada).
// La duración la manda el servidor (la del código), no el cliente.
export async function reservarConCodigo(
  codigo: string,
  beneficiario: { nombre?: string; apellido?: string; telefono?: string; email?: string },
  fecha: string,
  hora: string,
  simuladores: string[],
  idempotencyKey?: string | null,
): Promise<Resultado<unknown>> {
  const cod = String(codigo ?? "").trim().toUpperCase();

  // Idempotencia primero: si esta key ya creó una reserva, devolverla (retry/refresh),
  // sin re-validar el código (que ya estaría 'utilizado').
  if (idempotencyKey) {
    const { data: uso } = await supabaseAdmin.from("empresa_codigo_usos").select("reserva_id").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (uso?.reserva_id) return ok({ reserva_id: uso.reserva_id, idempotente: true });
  }

  const val = await validarCodigo(cod);
  if (!val.ok) return fail(val.status, "Código inválido o no disponible.");
  const duracion = (val.data as { beneficio: { duracion_minutos: number } }).beneficio.duracion_minutos;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return fail(400, "Fecha u hora inválida.");
  const sims = (Array.isArray(simuladores) ? simuladores : []).map((s) => String(s).trim()).filter(Boolean);
  if (sims.length < 1) return fail(400, "Elegí un simulador.");

  const slots = getOccupiedSlots(fecha, hora, duracion);
  if (await reservaEstaBloqueada(fecha, slots, sims)) return fail(409, "Ese horario no está disponible.");

  const { data, error } = await supabaseAdmin.rpc("crear_reserva_empresa", {
    p_codigo: cod,
    p_nombre: beneficiario.nombre ?? null,
    p_apellido: beneficiario.apellido ?? null,
    p_telefono: beneficiario.telefono ?? null,
    p_email: beneficiario.email ?? null,
    p_fecha: fecha, p_hora: hora, p_duracion: duracion,
    p_simuladores: sims, p_slots: slots,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) return fail(500, "No se pudo crear la reserva.");
  const filas = (data ?? []) as Array<{ reserva_id: number }>;
  if (filas.length) return ok({ reserva_id: filas[0].reserva_id, duracion, fecha, hora, simuladores: sims });

  // Sin filas: puede ser conflicto de slot o carrera de idempotencia. Si la key ya
  // creó una reserva, devolverla (idempotente); si no, es que el turno se ocupó.
  if (idempotencyKey) {
    const { data: uso } = await supabaseAdmin.from("empresa_codigo_usos").select("reserva_id").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (uso?.reserva_id) return ok({ reserva_id: uso.reserva_id, idempotente: true });
  }
  return fail(409, "Ese horario ya no está disponible.");
}

// ── Acciones admin (Fase 2) ───────────────────────────────────────────────────

// Marcar campaña como pagada: exige fecha de pago + medio. Idempotente (el ingreso
// de Finanzas se DERIVA de la campaña, no se inserta una fila → marcar dos veces no
// duplica). No permite activa con pago pendiente (se deriva por estado_pago).
export async function marcarPagada(id: string, fechaPago: string, medioPago: string): Promise<Resultado<unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaPago || ""))) return fail(400, "La fecha de pago es obligatoria.");
  if (!["efectivo", "mercadopago", "transferencia"].includes(medioPago)) return fail(400, "Medio de pago inválido.");
  const { data: c } = await supabaseAdmin.from("empresa_campanias").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!c) return fail(404, "Campaña no encontrada.");
  if (c.fecha_inicio && !inicioValido(fechaPago, c.fecha_inicio)) {
    return fail(400, "La fecha de inicio debe estar entre el pago y 30 días después. Corregí el inicio antes de marcar pagada.");
  }
  // Confirma la campaña (borrador → activa; el estado efectivo se deriva por fechas).
  const nuevoEstado = c.estado === "cancelada" || c.estado === "finalizada" ? c.estado : "activa";
  const { data, error } = await supabaseAdmin.from("empresa_campanias")
    .update({ estado_pago: "pagado", fecha_pago: fechaPago, medio_pago: medioPago, estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq("id", id).select("*").single();
  if (error) return fail(500, "No se pudo marcar como pagada.");
  return ok(data);
}

// Finalizar / cancelar campaña (acciones explícitas admin).
export async function setEstadoCampania(id: string, estado: "finalizada" | "cancelada"): Promise<Resultado<unknown>> {
  const { data, error } = await supabaseAdmin.from("empresa_campanias")
    .update({ estado, updated_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
  if (error) return fail(500, "No se pudo actualizar la campaña.");
  if (!data) return fail(404, "Campaña no encontrada.");
  return ok({ ok: true });
}

// Bloquear / cancelar un código individual (admin).
export async function setEstadoCodigo(campaniaId: string, codigoId: string, estado: "bloqueado" | "cancelado" | "disponible"): Promise<Resultado<unknown>> {
  const { data, error } = await supabaseAdmin.from("empresa_codigos")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", codigoId).eq("campania_id", campaniaId).eq("usos_actuales", 0).select("id").maybeSingle();
  if (error) return fail(500, "No se pudo actualizar el código.");
  if (!data) return fail(409, "El código no existe o ya fue utilizado.");
  return ok({ ok: true });
}

// Cancelar una reserva empresarial (admin). Atómico vía RPC; opción de liberar el código.
export async function cancelarReservaEmpresa(reservaId: number, liberarCodigo: boolean): Promise<Resultado<unknown>> {
  const { data, error } = await supabaseAdmin.rpc("cancelar_reserva_empresa", { p_reserva_id: reservaId, p_liberar_codigo: liberarCodigo });
  if (error) return fail(500, "No se pudo cancelar la reserva.");
  if (!data) return fail(404, "Reserva empresarial no encontrada.");
  return ok({ ok: true });
}

// Reprogramar una reserva empresarial (admin). NO consume otro uso. Atómico vía RPC.
export async function reprogramarReservaEmpresa(reservaId: number, fecha: string, hora: string, simuladores: string[]): Promise<Resultado<unknown>> {
  const { data: res } = await supabaseAdmin.from("reservas").select("duracion_minutos, origen").eq("id", reservaId).maybeSingle();
  if (!res || res.origen !== "empresa") return fail(404, "Reserva empresarial no encontrada.");
  const sims = (Array.isArray(simuladores) ? simuladores : []).map((s) => String(s).trim()).filter(Boolean);
  if (sims.length < 1) return fail(400, "Elegí un simulador.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return fail(400, "Fecha u hora inválida.");
  const slots = getOccupiedSlots(fecha, hora, Number(res.duracion_minutos) || 15);
  if (await reservaEstaBloqueada(fecha, slots, sims)) return fail(409, "Ese horario no está disponible.");
  const { data, error } = await supabaseAdmin.rpc("reprogramar_reserva_empresa", { p_reserva_id: reservaId, p_fecha: fecha, p_hora: hora, p_simuladores: sims, p_slots: slots });
  if (error) return fail(500, "No se pudo reprogramar.");
  if (!data) return fail(409, "No se pudo reprogramar (¿turno ocupado?).");
  return ok({ ok: true });
}

// Marcar/desmarcar no-show de una reserva empresarial (dato explícito para informes).
export async function setNoShowEmpresa(reservaId: number, noShow: boolean): Promise<Resultado<unknown>> {
  const { data, error } = await supabaseAdmin.from("reservas")
    .update({ no_show: noShow }).eq("id", reservaId).eq("origen", "empresa").select("id").maybeSingle();
  if (error) return fail(500, "No se pudo actualizar.");
  if (!data) return fail(404, "Reserva empresarial no encontrada.");
  return ok({ ok: true });
}
