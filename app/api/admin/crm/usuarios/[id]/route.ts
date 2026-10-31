import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { esAccionUsuario, esUuid, problemaContrasenaNueva } from "@/lib/crmUsuarios";
import { accionUsuario, usuarioPorId } from "@/lib/crmUsuariosServer";

// Acciones sobre un usuario comercial (CRM B0). Solo admin.
//   PATCH { accion: "restablecer", contrasena } → contraseña nueva + revoca sesiones
//   PATCH { accion: "desactivar" }              → no ingresa más + revoca sesiones
//   PATCH { accion: "reactivar" }               → vuelve a ingresar (las sesiones viejas siguen revocadas)
//   PATCH { accion: "revocar" }                 → cierra todas sus sesiones
// Cada acción queda en crm_auditoria dentro de la misma transacción (RPC).

type RouteContext = { params: Promise<{ id: string }> };
const SIN_CACHE = { "Cache-Control": "no-store, private" };
const CUERPO_MAX = 4096;

export async function PATCH(req: Request, { params }: RouteContext) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`crm-usuarios-write:${clientIp(req)}`, 30, 60_000))) return tooManyResponse();
  if (Number(req.headers.get("content-length") ?? 0) > CUERPO_MAX) {
    return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413, headers: SIN_CACHE });
  }

  const { id } = await params;
  if (!esUuid(id)) return NextResponse.json({ error: "El usuario no existe." }, { status: 404, headers: SIN_CACHE });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const accion = body?.accion;
  if (!esAccionUsuario(accion)) return NextResponse.json({ error: "Acción inválida." }, { status: 400, headers: SIN_CACHE });

  let contrasena: string | undefined;
  if (accion === "restablecer") {
    const actual = await usuarioPorId(id);
    if (!actual.ok) return failResponse(500, "No se pudo restablecer la contraseña.", { logContext: `crm usuario PATCH ${actual.causa ?? ""}` });
    if (!actual.valor) return NextResponse.json({ error: "El usuario no existe." }, { status: 404, headers: SIN_CACHE });
    const problema = problemaContrasenaNueva(body?.contrasena, actual.valor.usuario);
    if (problema) return NextResponse.json({ error: problema }, { status: 400, headers: SIN_CACHE });
    contrasena = body?.contrasena as string;
  }

  const r = await accionUsuario(id, accion, contrasena);
  if (!r.ok) {
    if (r.e) return NextResponse.json({ error: r.e.error, codigo: r.e.codigo }, { status: r.e.status, headers: SIN_CACHE });
    return failResponse(500, "No se pudo completar la acción.", { logContext: `crm usuario PATCH ${accion} ${r.causa ?? ""}` });
  }
  logSecurityEvent("crm_usuario_accion", { accion, role: auth.role });
  return NextResponse.json({ usuario: r.valor }, { headers: SIN_CACHE });
}
