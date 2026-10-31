import { NextResponse } from "next/server";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import { autenticarComercial } from "@/lib/crmIngreso";
import { controlarIp, controlarUsuario, registrarFalloUsuario } from "@/lib/crmLimite";
import { CRM_COOKIE, opcionesCookieComercial } from "@/lib/crmSesion";
import { USUARIO_RE, normalizarUsuario } from "@/lib/crmUsuarios";
import { SIN_CACHE } from "@/lib/crmAuth";

// Ingreso comercial (CRM B0). Público por definición: es el login.
//   · Origen propio (la cookie es SameSite=strict; esto es la segunda cerradura).
//   · Límite por origen y por usuario con lib/crmLimite.ts: si el servicio remoto
//     falla, sigue limitando con el respaldo en memoria (por instancia); nunca
//     deja pasar sin control.
//   · Una sola respuesta para usuario inexistente, desactivado o contraseña
//     incorrecta. Nada de la credencial vuelve en el cuerpo: el token va solo
//     en la cookie HttpOnly.

const MENSAJE_CREDENCIALES = "Usuario o contraseña incorrectos.";
const CUERPO_MAX = 4096;

function demasiados(reintentarEnMs: number) {
  const segundos = Math.max(1, Math.ceil(reintentarEnMs / 1000));
  return NextResponse.json(
    { error: "Demasiados intentos. Esperá un momento e intentá de nuevo." },
    { status: 429, headers: { ...SIN_CACHE, "Retry-After": String(segundos) } },
  );
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const ip = clientIp(req);
  const porIp = await controlarIp(ip);
  if (!porIp.permitido) {
    logSecurityEvent("crm_ingreso_429_ip", { ip, fuente: porIp.fuente });
    return demasiados(porIp.reintentarEnMs);
  }
  if (Number(req.headers.get("content-length") ?? 0) > CUERPO_MAX) {
    return NextResponse.json({ error: MENSAJE_CREDENCIALES }, { status: 401, headers: SIN_CACHE });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const usuario = normalizarUsuario(body?.usuario);
  const usuarioValido = USUARIO_RE.test(usuario);
  if (usuarioValido) {
    const porUsuario = await controlarUsuario(usuario);
    if (!porUsuario.permitido) {
      logSecurityEvent("crm_ingreso_429_usuario", { ip, fuente: porUsuario.fuente });
      return demasiados(porUsuario.reintentarEnMs);
    }
  }

  const r = await autenticarComercial(body?.usuario, body?.contrasena);
  if (!r.ok) {
    if (r.motivo === "no_disponible") {
      logSecurityEvent("crm_ingreso_no_disponible", { ip });
      return NextResponse.json({ error: "El acceso comercial no está disponible en este momento." }, { status: 503, headers: SIN_CACHE });
    }
    if (usuarioValido) await registrarFalloUsuario(usuario);
    logSecurityEvent("crm_ingreso_fallido", { ip });
    return NextResponse.json({ error: MENSAJE_CREDENCIALES }, { status: 401, headers: SIN_CACHE });
  }

  const res = NextResponse.json({ ok: true, nombre: r.nombre }, { headers: SIN_CACHE });
  res.cookies.set(CRM_COOKIE, r.token, opcionesCookieComercial());
  return res;
}
