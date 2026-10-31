import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { normalizarNombre, normalizarUsuario, problemaContrasenaNueva, problemaNombre, problemaUsuario } from "@/lib/crmUsuarios";
import { crearUsuario, listarUsuarios } from "@/lib/crmUsuariosServer";

// Usuarios comerciales del CRM (B0). Solo admin, lectura y escritura.
//   GET  → listado (DTO explícito: sin hash, sal, versión ni tokens).
//   POST → alta { usuario, nombre, contrasena }. La contraseña la define la
//          administración; se guarda solo su hash y no vuelve en la respuesta.
// La autoridad es server-side (requireAdmin); la UI no decide nada.

const SIN_CACHE = { "Cache-Control": "no-store, private" };
const CUERPO_MAX = 4096;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const r = await listarUsuarios();
  if (!r.ok) return failResponse(500, "No se pudieron cargar los usuarios.", { logContext: `crm usuarios GET ${r.causa ?? ""}` });
  return NextResponse.json({ usuarios: r.valor }, { headers: SIN_CACHE });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`crm-usuarios-write:${clientIp(req)}`, 30, 60_000))) return tooManyResponse();
  if (Number(req.headers.get("content-length") ?? 0) > CUERPO_MAX) {
    return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413, headers: SIN_CACHE });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Body inválido" }, { status: 400, headers: SIN_CACHE });
  const usuario = normalizarUsuario(body.usuario);
  const nombre = normalizarNombre(body.nombre);
  const problema = problemaUsuario(usuario) ?? problemaNombre(nombre) ?? problemaContrasenaNueva(body.contrasena, usuario);
  if (problema) return NextResponse.json({ error: problema }, { status: 400, headers: SIN_CACHE });

  const r = await crearUsuario(usuario, nombre, body.contrasena as string);
  if (!r.ok) {
    if (r.e) return NextResponse.json({ error: r.e.error, codigo: r.e.codigo }, { status: r.e.status, headers: SIN_CACHE });
    return failResponse(500, "No se pudo crear el usuario.", { logContext: `crm usuarios POST ${r.causa ?? ""}` });
  }
  logSecurityEvent("crm_usuario_creado", { role: auth.role });
  return NextResponse.json({ usuario: r.valor }, { status: 201, headers: SIN_CACHE });
}
