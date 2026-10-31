// Usuarios comerciales del CRM (B0) — acceso de SERVIDOR (service_role). Solo lo
// importan las rutas de /api/admin/crm y /comercial/api, y lib/crmAuth.ts.
//
// Toda escritura pasa por las RPCs de db/crm-b0-identidad.sql: service_role no
// tiene INSERT/UPDATE/DELETE sobre crm_usuarios ni SELECT sobre password_hash.
// Las lecturas usan columnas explícitas (un select * falla a propósito). El actor
// que reciben las RPCs lo pone el servidor desde la sesión verificada; nada que
// mande el navegador decide autoridad.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashContrasena } from "@/lib/crmContrasena";
import {
  COLUMNAS_DTO, causaPg, dtoUsuario, errorDeRpcUsuarios,
  type AccionUsuario, type ErrorUsuarios, type UsuarioComercialDto,
} from "@/lib/crmUsuarios";

/** ok · error conocido (e) · error inesperado (e = null: la ruta contesta 500 y registra `causa`). */
export type R<T> = { ok: true; valor: T } | { ok: false; e: ErrorUsuarios | null; causa?: string };

function fallo<T>(error: { code?: string | null; message?: string | null } | null): R<T> {
  const e = errorDeRpcUsuarios(error);
  return e ? { ok: false, e } : { ok: false, e: null, causa: causaPg(error) };
}

// ── Administración (actor: 'admin') ───────────────────────────────────────

export async function listarUsuarios(): Promise<R<UsuarioComercialDto[]>> {
  const { data, error } = await supabaseAdmin
    .from("crm_usuarios").select(COLUMNAS_DTO)
    .order("activo", { ascending: false }).order("nombre", { ascending: true });
  if (error) return fallo(error);
  return { ok: true, valor: (data ?? []).map((f) => dtoUsuario(f as unknown as Record<string, unknown>)) };
}

export async function usuarioPorId(id: string): Promise<R<UsuarioComercialDto | null>> {
  const { data, error } = await supabaseAdmin.from("crm_usuarios").select(COLUMNAS_DTO).eq("id", id).maybeSingle();
  if (error) return fallo(error);
  return { ok: true, valor: data ? dtoUsuario(data as unknown as Record<string, unknown>) : null };
}

export async function crearUsuario(usuario: string, nombre: string, contrasena: string): Promise<R<UsuarioComercialDto>> {
  const hash = await hashContrasena(contrasena);
  const { data, error } = await supabaseAdmin.rpc("crm_usuario_crear", {
    p_usuario: usuario, p_nombre: nombre, p_password_hash: hash, p_actor_rol: "admin",
  });
  if (error) return fallo(error);
  return { ok: true, valor: dtoUsuario(data as Record<string, unknown>) };
}

export async function accionUsuario(id: string, accion: AccionUsuario, contrasena?: string): Promise<R<UsuarioComercialDto>> {
  let resultado;
  if (accion === "restablecer") {
    const hash = await hashContrasena(contrasena ?? "");
    resultado = await supabaseAdmin.rpc("crm_usuario_restablecer_contrasena", { p_id: id, p_password_hash: hash, p_actor_rol: "admin" });
  } else if (accion === "desactivar") {
    resultado = await supabaseAdmin.rpc("crm_usuario_desactivar", { p_id: id, p_actor_rol: "admin" });
  } else if (accion === "reactivar") {
    resultado = await supabaseAdmin.rpc("crm_usuario_reactivar", { p_id: id, p_actor_rol: "admin" });
  } else {
    resultado = await supabaseAdmin.rpc("crm_usuario_revocar_sesiones", { p_id: id, p_actor_rol: "admin" });
  }
  if (resultado.error) return fallo(resultado.error);
  return { ok: true, valor: dtoUsuario(resultado.data as Record<string, unknown>) };
}

// ── Ingreso y sesión (actor: el propio usuario comercial) ─────────────────

export type Credencial = { id: string; password_hash: string; sesion_version: number; activo: boolean };

/** La credencial para verificar una contraseña, o null si el usuario no existe. Lanza ante un error de base. */
export async function credencialParaIngreso(usuario: string): Promise<Credencial | null> {
  const { data, error } = await supabaseAdmin.rpc("crm_login_credencial", { p_usuario: usuario });
  if (error) throw new Error(`crm_login_credencial: ${causaPg(error)}`);
  const fila = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null | undefined;
  if (!fila) return null;
  return {
    id: String(fila.id),
    password_hash: String(fila.password_hash),
    sesion_version: Number(fila.sesion_version),
    activo: fila.activo === true,
  };
}

/**
 * Confirma el ingreso con la MISMA credencial que se verificó. Devuelve la versión
 * con la que se firma la sesión, o null si entre la lectura y la confirmación el
 * usuario cambió (contraseña, desactivación o revocación). Lanza ante un error de base.
 */
export async function confirmarIngreso(c: Credencial): Promise<{ nombre: string; sesion_version: number } | null> {
  const { data, error } = await supabaseAdmin.rpc("crm_login_confirmar", {
    p_id: c.id, p_password_hash: c.password_hash, p_sesion_version: c.sesion_version,
  });
  if (error) throw new Error(`crm_login_confirmar: ${causaPg(error)}`);
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return { nombre: String(d.nombre), sesion_version: Number(d.sesion_version) };
}

/** Cierra (revoca) las sesiones del usuario si la versión es la vigente. Lanza ante un error de base. */
export async function cerrarSesiones(id: string, sesionVersion: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("crm_sesion_cerrar", { p_id: id, p_sesion_version: sesionVersion });
  if (error) throw new Error(`crm_sesion_cerrar: ${causaPg(error)}`);
  return data === true;
}

export type EstadoSesionUsuario = { id: string; nombre: string; activo: boolean; sesion_version: number };

/** Estado vigente del usuario de una sesión, o null si no existe. Lanza ante un error de base. */
export async function estadoUsuarioDeSesion(id: string): Promise<EstadoSesionUsuario | null> {
  const { data, error } = await supabaseAdmin
    .from("crm_usuarios").select("id, nombre, activo, sesion_version").eq("id", id).maybeSingle();
  if (error) throw new Error(`crm_usuarios: ${causaPg(error)}`);
  if (!data) return null;
  return { id: String(data.id), nombre: String(data.nombre), activo: data.activo === true, sesion_version: Number(data.sesion_version) };
}
