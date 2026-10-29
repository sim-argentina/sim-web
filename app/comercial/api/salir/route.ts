import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { logSecurityEvent } from "@/lib/apiError";
import { CRM_COOKIE, opcionesCookieComercialBorrar, verificarTokenComercial } from "@/lib/crmSesion";
import { cerrarSesiones } from "@/lib/crmUsuariosServer";
import { SIN_CACHE } from "@/lib/crmAuth";

// Cierre de sesión comercial (CRM B0). Revoca TODAS las sesiones del usuario en
// el servidor (sube sesion_version: no hay sesiones por dispositivo) y borra la
// cookie de este navegador. No toca la sesión del panel.

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const store = await cookies();
  const sesion = verificarTokenComercial(store.get(CRM_COOKIE)?.value);
  let revocada = true;
  if (sesion) {
    try {
      await cerrarSesiones(sesion.uid, sesion.sv);
    } catch {
      revocada = false;
      logSecurityEvent("crm_cierre_no_confirmado");
    }
  }
  const res = revocada
    ? NextResponse.json({ ok: true }, { headers: SIN_CACHE })
    : NextResponse.json(
        { ok: false, error: "Se cerró la sesión en este dispositivo, pero no se pudo confirmar en el servidor. Probá de nuevo o pedí que la revoquen." },
        { status: 503, headers: SIN_CACHE },
      );
  res.cookies.set(CRM_COOKIE, "", opcionesCookieComercialBorrar());
  return res;
}
