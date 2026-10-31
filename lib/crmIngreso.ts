// Ingreso comercial (CRM B0): verifica usuario y contraseña y emite la sesión.
//
// Orden y por qué:
//   1. Lee la credencial (hash, versión, activo) con crm_login_credencial.
//   2. Verifica la contraseña con scrypt FUERA de la base. Si el usuario no existe,
//      verifica igual contra un hash simulado: mismo costo y misma respuesta, así
//      no se distingue "no existe" de "contraseña incorrecta" ni de "desactivado".
//   3. Confirma con crm_login_confirmar, que bloquea la fila y exige que el hash
//      verificado y la versión leída sigan vigentes. Si en el medio hubo un
//      restablecimiento, una desactivación o una revocación, no hay sesión: una
//      contraseña anterior nunca produce una sesión con la versión nueva.
//   4. Firma la sesión con la versión que devolvió la confirmación.
// Un error de base falla cerrado (no_disponible): nunca emite una sesión a ciegas.

import { crearTokenComercial, sesionComercialConfigurada } from "@/lib/crmSesion";
import { hashSimulado, verificarContrasena } from "@/lib/crmContrasena";
import { CONTRASENA_MAX, USUARIO_RE, normalizarUsuario } from "@/lib/crmUsuarios";
import { confirmarIngreso, credencialParaIngreso, type Credencial } from "@/lib/crmUsuariosServer";

export type ResultadoIngreso =
  | { ok: true; token: string; nombre: string }
  | { ok: false; motivo: "credenciales" | "no_disponible" };

export type DepsIngreso = {
  credencial: (usuario: string) => Promise<Credencial | null>;
  confirmar: (c: Credencial) => Promise<{ nombre: string; sesion_version: number } | null>;
  /** Solo pruebas: corre entre la verificación de la contraseña y la confirmación. */
  entreVerificacionYConfirmacion?: () => Promise<void>;
};

const DEPS_REALES: DepsIngreso = { credencial: credencialParaIngreso, confirmar: confirmarIngreso };

export async function autenticarComercial(
  usuarioCrudo: unknown,
  contrasenaCruda: unknown,
  deps: DepsIngreso = DEPS_REALES,
): Promise<ResultadoIngreso> {
  if (!sesionComercialConfigurada()) return { ok: false, motivo: "no_disponible" };
  const usuario = normalizarUsuario(usuarioCrudo);
  const contrasena = typeof contrasenaCruda === "string" ? contrasenaCruda : "";
  const formatoOk = USUARIO_RE.test(usuario) && contrasena.length >= 1 && contrasena.length <= CONTRASENA_MAX;

  let credencial: Credencial | null = null;
  if (formatoOk) {
    try {
      credencial = await deps.credencial(usuario);
    } catch {
      return { ok: false, motivo: "no_disponible" };
    }
  }
  const hash = credencial?.password_hash ?? (await hashSimulado());
  const coincide = await verificarContrasena(formatoOk ? contrasena : "-", hash);
  if (!credencial || !coincide || !credencial.activo) return { ok: false, motivo: "credenciales" };

  if (deps.entreVerificacionYConfirmacion) await deps.entreVerificacionYConfirmacion();

  let confirmado: { nombre: string; sesion_version: number } | null;
  try {
    confirmado = await deps.confirmar(credencial);
  } catch {
    return { ok: false, motivo: "no_disponible" };
  }
  if (!confirmado) return { ok: false, motivo: "credenciales" };
  return { ok: true, token: crearTokenComercial(credencial.id, confirmado.sesion_version), nombre: confirmado.nombre };
}
