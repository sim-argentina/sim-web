// Autorización del CRM (B0): quién es el actor de una petición a la interfaz
// comercial. La autoridad es SIEMPRE del servidor: la identidad sale de cookies
// firmadas verificadas acá, nunca de un formulario.
//
// Actores:
//   · comercial: sesión comercial válida (firma, tipo, versión y vencimiento) Y,
//     en la base, usuario activo con esa misma sesion_version.
//   · admin ("Administración"): sesión del panel con rol admin. Es la credencial
//     compartida del panel: no identifica a una persona.
//   · staff sin sesión comercial válida: denegado (403). El rol staff no da acceso
//     al CRM.
//   · nada válido: no autenticado (401).
//
// Si conviven cookies, gana la sesión COMERCIAL válida: solo se obtiene
// ingresando con usuario y contraseña en /comercial/ingresar desde ese
// navegador, y la interfaz comercial atribuye a esa persona. Una cookie comercial
// inválida, vencida o revocada se ignora: no anula una sesión admin legítima.
// Si la base no responde al verificar una cookie comercial, falla cerrado
// (no_disponible) en vez de caer a admin: no se sabe quién es.
//
// La sesión del panel no cambia: verifySessionToken sigue aceptando solo
// admin|staff, y requireAdmin / requireStaffOrAdmin no conocen la sesión
// comercial (otra cookie, que además el navegador solo manda bajo /comercial).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken, type AdminRole } from "@/lib/adminSession";
import { CRM_COOKIE, sesionComercialConfigurada, verificarTokenComercial, type SesionComercial } from "@/lib/crmSesion";
import { estadoUsuarioDeSesion, type EstadoSesionUsuario } from "@/lib/crmUsuariosServer";
import { logSecurityEvent } from "@/lib/apiError";

export type ActorCrm =
  | { tipo: "admin"; nombre: "Administración" }
  | { tipo: "comercial"; usuarioId: string; nombre: string; sesionVersion: number };

export type ResolucionActor =
  | { estado: "ok"; actor: ActorCrm }
  | { estado: "no_autenticado" }
  | { estado: "denegado" }
  | { estado: "no_disponible" };

export type DepsActor = {
  verificarPanel: (token: string | undefined) => Promise<AdminRole | null>;
  comercialConfigurado: () => boolean;
  verificarComercial: (token: string | undefined) => SesionComercial | null;
  estadoUsuario: (id: string) => Promise<EstadoSesionUsuario | null>;
};

const DEPS_REALES: DepsActor = {
  verificarPanel: (t) => verifySessionToken(t),
  comercialConfigurado: sesionComercialConfigurada,
  verificarComercial: (t) => verificarTokenComercial(t),
  estadoUsuario: estadoUsuarioDeSesion,
};

export const ACTOR_ADMIN: ActorCrm = { tipo: "admin", nombre: "Administración" };

/** Resolución pura (con dependencias inyectables) de las cookies de una petición. */
export async function resolverActorCrm(
  c: { panel?: string; comercial?: string },
  deps: DepsActor = DEPS_REALES,
): Promise<ResolucionActor> {
  let comercialSinVerificar = false;
  if (c.comercial) {
    if (!deps.comercialConfigurado()) {
      comercialSinVerificar = true;
    } else {
      const s = deps.verificarComercial(c.comercial);
      if (s) {
        let u: EstadoSesionUsuario | null;
        try {
          u = await deps.estadoUsuario(s.uid);
        } catch {
          return { estado: "no_disponible" };
        }
        if (u && u.id === s.uid && u.activo && u.sesion_version === s.sv) {
          return { estado: "ok", actor: { tipo: "comercial", usuarioId: u.id, nombre: u.nombre, sesionVersion: u.sesion_version } };
        }
      }
    }
  }
  const rol = await deps.verificarPanel(c.panel);
  if (rol === "admin") return { estado: "ok", actor: ACTOR_ADMIN };
  if (comercialSinVerificar) return { estado: "no_disponible" };
  if (rol === "staff") return { estado: "denegado" };
  return { estado: "no_autenticado" };
}

/** Actor de la petición actual (páginas y rutas). */
export async function actorCrmActual(deps: DepsActor = DEPS_REALES): Promise<ResolucionActor> {
  const store = await cookies();
  return resolverActorCrm({ panel: store.get(ADMIN_COOKIE)?.value, comercial: store.get(CRM_COOKIE)?.value }, deps);
}

export const SIN_CACHE = { "Cache-Control": "no-store, private" } as const;

/** Guard de rutas: 401 sin credenciales válidas, 403 staff, 503 si no se pudo verificar. */
export async function requireCrmActor(): Promise<{ ok: true; actor: ActorCrm } | { ok: false; response: NextResponse }> {
  const r = await actorCrmActual();
  if (r.estado === "ok") return { ok: true, actor: r.actor };
  if (r.estado === "no_autenticado") {
    logSecurityEvent("crm_401_sin_sesion");
    return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401, headers: SIN_CACHE }) };
  }
  if (r.estado === "denegado") {
    logSecurityEvent("crm_403_sin_acceso_comercial");
    return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 403, headers: SIN_CACHE }) };
  }
  logSecurityEvent("crm_503_sesion_no_verificable");
  return { ok: false, response: NextResponse.json({ error: "No se pudo verificar la sesión. Probá de nuevo en un momento." }, { status: 503, headers: SIN_CACHE }) };
}
