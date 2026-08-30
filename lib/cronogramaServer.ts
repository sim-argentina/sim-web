import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { EstadoMes, DiaInput } from "@/lib/cronograma";
import { validarDia, calcularHorasMensuales } from "@/lib/cronograma";

// Acceso a datos del Cronograma (server-only, service_role). Crear borrador,
// guardar día y confirmar son ATÓMICOS vía RPC (transacción en la DB). La
// validación pura vive en lib/cronograma.ts.

export type JornadaVista = {
  empleado_id: string;
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  empleado_activo: boolean;
};
export type DiaVista = {
  fecha: string;
  cerrado: boolean;
  apertura: string;
  cierre: string;
  jornadas: JornadaVista[];
};
export type MesVista = {
  estado: EstadoMes;
  anio: number;
  mes: number;
  apertura_default: string;
  cierre_default: string;
  confirmado_at: string | null;
  fallback: { id: string; nombre: string } | null;
  dias: DiaVista[];
};

// "HH:MM:SS" (time de Postgres) → "HH:MM".
function hhmm(t: unknown): string {
  const s = String(t ?? "");
  const m = s.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : s;
}

// Integrante fallback (Ramiro): es_fallback y activo.
export async function getFallback(): Promise<{ id: string; nombre: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("empleados")
    .select("id, nombre_formal")
    .eq("es_fallback", true)
    .eq("activo", true)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, nombre: data.nombre_formal as string } : null;
}

// Vista de un mes. Si no existe la fila → estado 'inexistente' (sin días).
// Devuelve solo jornadas activas. No aplica gating por rol (lo hace el endpoint).
export async function getMesVista(anio: number, mes: number): Promise<MesVista> {
  const fallback = await getFallback();

  const { data: mesRow, error: e1 } = await supabaseAdmin
    .from("cronograma_meses")
    .select("id, anio, mes, estado, apertura_default, cierre_default, confirmado_at")
    .eq("anio", anio)
    .eq("mes", mes)
    .maybeSingle();
  if (e1) throw e1;

  // Un mes 'descartado' es equivalente a "Sin cronograma" para las consultas
  // normales (la fila se conserva solo para auditoría/historial/unicidad).
  if (!mesRow || mesRow.estado === "descartado") {
    return {
      estado: "inexistente",
      anio,
      mes,
      apertura_default: "10:00",
      cierre_default: "22:00",
      confirmado_at: null,
      fallback,
      dias: [],
    };
  }

  const { data: diasRows, error: e2 } = await supabaseAdmin
    .from("cronograma_dias")
    .select(
      "id, fecha, cerrado, apertura, cierre, cronograma_jornadas ( empleado_id, hora_inicio, hora_fin, activo, empleados ( nombre_formal, activo ) )",
    )
    .eq("mes_id", mesRow.id)
    .order("fecha", { ascending: true });
  if (e2) throw e2;

  const dias: DiaVista[] = (diasRows ?? []).map((d) => {
    const rawJor = (d.cronograma_jornadas ?? []) as unknown as Array<{
      empleado_id: string;
      hora_inicio: string;
      hora_fin: string;
      activo: boolean;
      empleados: { nombre_formal: string; activo: boolean } | null;
    }>;
    const jornadas: JornadaVista[] = rawJor
      .filter((j) => j.activo)
      .map((j) => ({
        empleado_id: j.empleado_id,
        nombre: j.empleados?.nombre_formal ?? "—",
        hora_inicio: hhmm(j.hora_inicio),
        hora_fin: hhmm(j.hora_fin),
        empleado_activo: j.empleados?.activo ?? false,
      }))
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    return {
      fecha: String(d.fecha),
      cerrado: d.cerrado as boolean,
      apertura: hhmm(d.apertura),
      cierre: hhmm(d.cierre),
      jornadas,
    };
  });

  return {
    estado: mesRow.estado as EstadoMes,
    anio: mesRow.anio as number,
    mes: mesRow.mes as number,
    apertura_default: hhmm(mesRow.apertura_default),
    cierre_default: hhmm(mesRow.cierre_default),
    confirmado_at: (mesRow.confirmado_at as string) ?? null,
    fallback,
    dias,
  };
}

// ── Resumen de horas mensuales por integrante (ADMIN-only) ────────────────────
export type HorasIntegrante = { empleado_id: string; nombre: string; minutos: number; archivado: boolean };
export type HorasResumen = { estado: "borrador" | "confirmado"; label: string; integrantes: HorasIntegrante[] };

// null si el mes no existe / está descartado (no hay resumen). El fallback (Ramiro)
// no se hardcodea: se toma de la DB (getFallback vía getMesVista).
export async function getHorasMensuales(anio: number, mes: number): Promise<HorasResumen | null> {
  const vista = await getMesVista(anio, mes);
  if (vista.estado !== "borrador" && vista.estado !== "confirmado") return null;

  const map = calcularHorasMensuales(
    vista.dias.map((d) => ({
      cerrado: d.cerrado,
      apertura: d.apertura,
      cierre: d.cierre,
      jornadas: d.jornadas.map((j) => ({ empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })),
    })),
    vista.fallback?.id ?? "",
  );

  // Integrantes activos (incluye 0 h). Orden: fallback primero, luego por alta.
  const { data: activos, error } = await supabaseAdmin
    .from("empleados")
    .select("id, nombre_formal")
    .eq("activo", true)
    .order("es_fallback", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const integrantes: HorasIntegrante[] = [];
  const vistos = new Set<string>();
  for (const e of (activos ?? []) as Array<{ id: string; nombre_formal: string }>) {
    integrantes.push({ empleado_id: e.id, nombre: e.nombre_formal, minutos: map[e.id] ?? 0, archivado: false });
    vistos.add(e.id);
  }
  // Archivados con horas históricas en el mes → incluidos y marcados como archivados.
  const nombrePorId = new Map<string, string>();
  for (const d of vista.dias) for (const j of d.jornadas) if (!j.empleado_activo) nombrePorId.set(j.empleado_id, j.nombre);
  for (const [id, min] of Object.entries(map)) {
    if (!vistos.has(id) && min > 0) integrantes.push({ empleado_id: id, nombre: nombrePorId.get(id) ?? "—", minutos: min, archivado: true });
  }

  const label =
    vista.estado === "confirmado"
      ? "Horas efectivas del cronograma confirmado"
      : "Proyección de horas si confirmaras este borrador ahora";
  return { estado: vista.estado, label, integrantes };
}

// ── Datos para el PDF del cronograma CONFIRMADO ───────────────────────────────
export type PdfJornada = { nombre: string; hora_inicio: string; hora_fin: string };
export type PdfDia = { fecha: string; cerrado: boolean; apertura: string; cierre: string; jornadas: PdfJornada[] };
export type PdfData = {
  anio: number;
  mes: number;
  generado_at: string;
  apertura_default: string;
  cierre_default: string;
  dias: PdfDia[];
};

// Solo jornadas manuales del mes CONFIRMADO (sin cobertura de Ramiro, sin horas, sin
// auditoría). Devuelve null si el mes NO está confirmado (el endpoint responde 409).
export async function getDatosPdf(anio: number, mes: number): Promise<PdfData | null> {
  const vista = await getMesVista(anio, mes);
  if (vista.estado !== "confirmado") return null;
  return {
    anio: vista.anio,
    mes: vista.mes,
    generado_at: new Date().toISOString(),
    apertura_default: vista.apertura_default,
    cierre_default: vista.cierre_default,
    dias: vista.dias.map((d) => ({
      fecha: d.fecha,
      cerrado: d.cerrado,
      apertura: d.apertura,
      cierre: d.cierre,
      jornadas: d.jornadas.map((j) => ({ nombre: j.nombre, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })),
    })),
  };
}

export type HistorialEvento = {
  id: string;
  fecha: string | null;
  tipo: string;
  actor: string;
  antes: unknown;
  despues: unknown;
  created_at: string;
};

// Historial de un mes (append-only). Solo admin (gating en el endpoint).
export async function getHistorial(anio: number, mes: number, fecha?: string): Promise<HistorialEvento[]> {
  const { data: mesRow, error: e1 } = await supabaseAdmin
    .from("cronograma_meses")
    .select("id")
    .eq("anio", anio)
    .eq("mes", mes)
    .maybeSingle();
  if (e1) throw e1;
  if (!mesRow) return [];

  let q = supabaseAdmin
    .from("cronograma_historial")
    .select("id, fecha, tipo, actor, antes, despues, created_at")
    .eq("mes_id", mesRow.id)
    .order("created_at", { ascending: false });
  if (fecha) q = q.eq("fecha", fecha);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as HistorialEvento[];
}

export type MutOk<T> = { ok: true; data: T };
export type MutFail = { ok: false; status: number; error: string };

function mapPgError(error: unknown): MutFail {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P0002") return { ok: false, status: 404, error: "El mes no existe. Creá primero un borrador." };
  if (code === "22023") return { ok: false, status: 409, error: "La transición de estado no está permitida para este mes." };
  if (code === "22007") return { ok: false, status: 400, error: "La fecha no pertenece al mes indicado." };
  if (code === "23514") return { ok: false, status: 409, error: "Solo se pueden asignar integrantes activos a una jornada." };
  if (code === "23P01") return { ok: false, status: 409, error: "Un integrante no puede tener jornadas superpuestas en el mismo día." };
  if (code === "23505") return { ok: false, status: 409, error: "Conflicto: el registro ya existe." };
  if (code === "23503") return { ok: false, status: 409, error: "Integrante inexistente." };
  return { ok: false, status: 500, error: "No se pudo completar la operación." };
}

// Crear borrador del mes (atómico + historial). Idempotente.
export async function crearBorrador(anio: number, mes: number): Promise<MutOk<MesVista> | MutFail> {
  const { error } = await supabaseAdmin.rpc("cronograma_crear_borrador", { p_anio: anio, p_mes: mes });
  if (error) return mapPgError(error);
  return { ok: true, data: await getMesVista(anio, mes) };
}

// Guardado atómico de un día. Valida en puro antes de tocar la DB; la RPC
// re-valida integrante activo, fecha-en-mes y superposición (constraint).
export async function guardarDia(
  anio: number,
  mes: number,
  fecha: string,
  dia: DiaInput,
): Promise<MutOk<MesVista> | MutFail> {
  const val = validarDia(dia);
  if (!val.ok) return { ok: false, status: 400, error: val.error };

  const { error } = await supabaseAdmin.rpc("cronograma_guardar_dia", {
    p_anio: anio,
    p_mes: mes,
    p_fecha: fecha,
    p_cerrado: val.dia.cerrado,
    p_apertura: val.dia.apertura,
    p_cierre: val.dia.cierre,
    p_jornadas: val.dia.jornadas,
  });
  if (error) return mapPgError(error);
  return { ok: true, data: await getMesVista(anio, mes) };
}

// Confirmar el mes (borrador → confirmado, atómico + historial). Idempotente.
export async function confirmarMes(anio: number, mes: number): Promise<MutOk<MesVista> | MutFail> {
  const { error } = await supabaseAdmin.rpc("cronograma_confirmar", { p_anio: anio, p_mes: mes });
  if (error) return mapPgError(error);
  return { ok: true, data: await getMesVista(anio, mes) };
}

// Reabrir un mes confirmado como borrador (atómico + historial). Conserva datos.
export async function reabrirMes(anio: number, mes: number): Promise<MutOk<MesVista> | MutFail> {
  const { error } = await supabaseAdmin.rpc("cronograma_reabrir", { p_anio: anio, p_mes: mes });
  if (error) return mapPgError(error);
  return { ok: true, data: await getMesVista(anio, mes) };
}

// Descartar un borrador → "Sin cronograma" (atómico; desactiva días/jornadas y
// descarta importaciones pendientes vinculadas; conserva auditoría).
export async function descartarBorrador(anio: number, mes: number): Promise<MutOk<MesVista> | MutFail> {
  const { error } = await supabaseAdmin.rpc("cronograma_descartar_borrador", { p_anio: anio, p_mes: mes });
  if (error) return mapPgError(error);
  return { ok: true, data: await getMesVista(anio, mes) };
}
