import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Alias, Empleado } from "@/lib/empleados";

// Acceso a datos de integrantes (server-only): usa supabaseAdmin (service_role).
// Crear/editar son ATÓMICOS vía funciones RPC (transacción en la DB). La
// validación/normalización vive en lib/empleados.ts (autoridad server-side).

const SELECT_EMPLEADO =
  "id, nombre_formal, activo, es_fallback, created_at, updated_at, empleado_aliases ( id, alias, alias_normalizado )";

// Integrantes activos (admin + staff). Fallback primero, luego por fecha de alta.
export async function listarActivos(): Promise<Empleado[]> {
  const { data, error } = await supabaseAdmin
    .from("empleados")
    .select(SELECT_EMPLEADO)
    .eq("activo", true)
    .order("es_fallback", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Empleado[];
}

// Integrantes archivados (solo admin). Nunca desaparecen del histórico.
export async function listarArchivados(): Promise<Empleado[]> {
  const { data, error } = await supabaseAdmin
    .from("empleados")
    .select(SELECT_EMPLEADO)
    .eq("activo", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Empleado[];
}

async function traerEmpleado(id: string): Promise<Empleado | null> {
  const { data, error } = await supabaseAdmin
    .from("empleados")
    .select(SELECT_EMPLEADO)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Empleado) ?? null;
}

export type MutacionOk = { ok: true; empleado: Empleado };
export type MutacionFail = { ok: false; status: number; error: string };

// Mapea errores de Postgres/PostgREST a mensajes seguros (sin exponer internals).
function mapPgError(error: unknown): MutacionFail | null {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return { ok: false, status: 409, error: "Ese alias ya pertenece a otro integrante." };
  if (code === "23514") return { ok: false, status: 409, error: "La operación viola una restricción del integrante." };
  if (code === "P0002") return { ok: false, status: 404, error: "Integrante no encontrado." };
  return null;
}

// Crear integrante (atómico vía RPC): inserta empleado + alias en una transacción.
export async function crearEmpleado(nombre: string, aliases: Alias[]): Promise<MutacionOk | MutacionFail> {
  const { data, error } = await supabaseAdmin.rpc("ia_empleado_crear", {
    p_nombre: nombre,
    p_aliases: aliases,
  });
  if (error) return mapPgError(error) ?? { ok: false, status: 500, error: "No se pudo crear el integrante." };
  const creado = await traerEmpleado((data as { id: string }).id);
  if (!creado) return { ok: false, status: 500, error: "No se pudo crear el integrante." };
  return { ok: true, empleado: creado };
}

// Editar nombre + reemplazo completo de alias (atómico vía RPC).
export async function editarEmpleado(id: string, nombre: string, aliases: Alias[]): Promise<MutacionOk | MutacionFail> {
  const { error } = await supabaseAdmin.rpc("ia_empleado_editar", {
    p_id: id,
    p_nombre: nombre,
    p_aliases: aliases,
  });
  if (error) return mapPgError(error) ?? { ok: false, status: 500, error: "No se pudo actualizar el integrante." };
  const actualizado = await traerEmpleado(id);
  if (!actualizado) return { ok: false, status: 404, error: "Integrante no encontrado." };
  return { ok: true, empleado: actualizado };
}

// Archivar: nunca al integrante fallback (además del CHECK en DB). No borra nada.
export async function archivarEmpleado(id: string): Promise<MutacionOk | MutacionFail> {
  const actual = await traerEmpleado(id);
  if (!actual) return { ok: false, status: 404, error: "Integrante no encontrado." };
  if (actual.es_fallback) {
    return { ok: false, status: 409, error: "No se puede archivar al integrante predeterminado (fallback)." };
  }
  const { error } = await supabaseAdmin
    .from("empleados")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return mapPgError(error) ?? { ok: false, status: 500, error: "No se pudo archivar el integrante." };
  const out = await traerEmpleado(id);
  return out ? { ok: true, empleado: out } : { ok: false, status: 500, error: "No se pudo archivar el integrante." };
}

// Reactivar un integrante archivado.
export async function reactivarEmpleado(id: string): Promise<MutacionOk | MutacionFail> {
  const actual = await traerEmpleado(id);
  if (!actual) return { ok: false, status: 404, error: "Integrante no encontrado." };
  const { error } = await supabaseAdmin
    .from("empleados")
    .update({ activo: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return mapPgError(error) ?? { ok: false, status: 500, error: "No se pudo reactivar el integrante." };
  const out = await traerEmpleado(id);
  return out ? { ok: true, empleado: out } : { ok: false, status: 500, error: "No se pudo reactivar el integrante." };
}
