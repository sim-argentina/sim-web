import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken, type AdminRole } from "@/lib/adminSession";

// Guards de autorización para route handlers y server components.
// Validan la sesión firmada en el backend (no se confía en UI ni middleware).

export async function getCurrentAdminRole(): Promise<AdminRole | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token);
}

type GuardOk = { ok: true; role: AdminRole };
type GuardFail = { ok: false; response: NextResponse };

function unauthorized(): GuardFail {
  return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
}
function forbidden(): GuardFail {
  return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
}

// Requiere sesión admin. 401 si no hay sesión, 403 si el rol no alcanza.
export async function requireAdmin(): Promise<GuardOk | GuardFail> {
  const role = await getCurrentAdminRole();
  if (!role) return unauthorized();
  if (role !== "admin") return forbidden();
  return { ok: true, role };
}

// Requiere sesión admin o staff.
export async function requireStaffOrAdmin(): Promise<GuardOk | GuardFail> {
  const role = await getCurrentAdminRole();
  if (!role) return unauthorized();
  return { ok: true, role };
}
