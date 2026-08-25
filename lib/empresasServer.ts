// Orquestación servidor del módulo Empresas: combina la lógica pura (lib/empresas)
// con la persistencia (supabaseAdmin) y el canje ATÓMICO (RPC consumir_empresa_codigo).
// Solo se importa desde route handlers (server) / tests. No toca reservas ni finanzas.
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  calcularVencimiento, formatearCodigo, estadoEfectivo, estadoCodigoEfectivo,
  metricasCampania, ivaDesglose, inicioValido, type Modalidad,
} from "@/lib/empresas";

export type Resultado<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Resultado<never> => ({ ok: false, status, error });
const ok = <T>(data: T): Resultado<T> => ({ ok: true, data });
const hoyIso = () => new Date().toISOString().slice(0, 10);

const CAMPOS_EDITABLES = [
  "empresa", "nombre_campania", "contacto_nombre", "contacto_telefono", "contacto_email",
  "cuit", "modalidad", "cantidad_contratada", "duracion_minutos", "usos_por_codigo",
  "precio_neto", "iva_porcentaje", "fecha_pago", "estado_pago", "fecha_inicio",
  "estado", "observaciones",
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
  const { data, error } = await supabaseAdmin
    .from("empresa_campanias").insert({ ...conVen, created_by: createdBy }).select("*").single();
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
  return ok({
    campania: { ...campania, ...ivaDesglose(Number(campania.precio_neto), Number(campania.iva_porcentaje)) },
    metricas,
    codigos: (codigos ?? []).map((c) => ({ ...c, estado_efectivo: estadoCodigoEfectivo(c, metricas.estado) })),
    usos: usos ?? [],
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
  const data = est.data as { campania: Record<string, unknown>; metricas: Record<string, unknown>; codigos: unknown[]; usos: Record<string, unknown>[] };

  // Evolución de canjes por día (dato real: created_at de los usos).
  const porDia: Record<string, number> = {};
  for (const u of data.usos) {
    const d = String(u.created_at ?? "").slice(0, 10);
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

// Canje ATÓMICO vía RPC. Registra el beneficiario y consume un uso. (Fase 1: no
// crea la reserva todavía — la integración Reservas es Fase 2.)
export async function canjearCodigo(
  codigo: string,
  beneficiario: { nombre?: string; apellido?: string; telefono?: string; email?: string },
): Promise<Resultado<unknown>> {
  const cod = String(codigo ?? "").trim().toUpperCase();
  if (!cod) return fail(400, "Código inválido o no disponible.");
  const { data, error } = await supabaseAdmin.rpc("consumir_empresa_codigo", {
    p_codigo: cod,
    p_nombre: beneficiario.nombre ?? null,
    p_apellido: beneficiario.apellido ?? null,
    p_telefono: beneficiario.telefono ?? null,
    p_email: beneficiario.email ?? null,
  });
  if (error) return fail(500, "No se pudo canjear el código.");
  const filas = (data ?? []) as Array<{ uso_id: string; codigo_id: string; campania_id: string }>;
  if (!filas.length) return fail(409, "Código inválido o no disponible.");
  return ok({ canjeado: true, uso_id: filas[0].uso_id });
}
