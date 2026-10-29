import { NextResponse } from "next/server";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import { autenticarComercial } from "@/lib/crmIngreso";
import { CRM_COOKIE, opcionesCookieComercial } from "@/lib/crmSesion";
import { normalizarUsuario } from "@/lib/crmUsuarios";
import { SIN_CACHE } from "@/lib/crmAuth";

// Ingreso comercial (CRM B0). Público por definición: es el login.
//   · Origen propio (la cookie es SameSite=strict; esto es la segunda cerradura).
//   · Límite por IP y por usuario (lib/rateLimit.ts: durable solo con Upstash).
//   · Una sola respuesta para usuario inexistente, desactivado o contraseña
//     incorrecta. Nada de la credencial vuelve en el cuerpo: el token va solo
//     en la cookie HttpOnly.

const MENSAJE_CREDENCIALES = "Usuario o contraseña incorrectos.";
const CUERPO_MAX = 4096;

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const ip = clientIp(req);
  if (!(await rateLimit(`crm-ingreso-ip:${ip}`, 8, 60_000))) {
    logSecurityEvent("crm_ingreso_429_ip", { ip });
    return tooManyResponse();
  }
  if (Number(req.headers.get("content-length") ?? 0) > CUERPO_MAX) {
    return NextResponse.json({ error: MENSAJE_CREDENCIALES }, { status: 401, headers: SIN_CACHE });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const usuario = normalizarUsuario(body?.usuario).slice(0, 64);
  if (usuario && !(await rateLimit(`crm-ingreso-usuario:${usuario}`, 10, 15 * 60_000))) {
    logSecurityEvent("crm_ingreso_429_usuario", { ip });
    return tooManyResponse();
  }

  const r = await autenticarComercial(body?.usuario, body?.contrasena);
  if (!r.ok) {
    if (r.motivo === "no_disponible") {
      logSecurityEvent("crm_ingreso_no_disponible", { ip });
      return NextResponse.json({ error: "El acceso comercial no está disponible en este momento." }, { status: 503, headers: SIN_CACHE });
    }
    logSecurityEvent("crm_ingreso_fallido", { ip });
    return NextResponse.json({ error: MENSAJE_CREDENCIALES }, { status: 401, headers: SIN_CACHE });
  }

  const res = NextResponse.json({ ok: true, nombre: r.nombre }, { headers: SIN_CACHE });
  res.cookies.set(CRM_COOKIE, r.token, opcionesCookieComercial());
  return res;
}
