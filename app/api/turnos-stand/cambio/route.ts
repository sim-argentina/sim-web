import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { guardarCambio, vistaCambio } from "@/lib/turneroCambio";

// Turnero del Stand — cambio que queda en la caja al cierre (nota operativa, no
// Finanzas). Staff o admin.
//
//   GET   el día de hoy (fecha comercial de Argentina, la resuelve el servidor)
//         y el cierre anterior. ?fecha=AAAA-MM-DD solo para admin.
//   POST  { monto } guarda el de hoy: crea la fila o actualiza la existente.
//         { monto, fecha } corrige otro día: solo admin, nunca un día futuro.
//
// El navegador no decide la fecha ni quién guarda: el actor es el rol firmado
// en la sesión. Sin caché.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const fecha = new URL(req.url).searchParams.get("fecha");
    const r = await vistaCambio({ rol: auth.role, fecha });
    if (!r.ok) return NextResponse.json({ error: r.error, codigo: r.codigo }, { status: r.status, headers: sinCache });
    return NextResponse.json(r.data, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo leer el cambio en caja", { logContext: "turnero cambio GET", error });
  }
}

export async function POST(req: Request) {
  // La cookie administrativa es SameSite=strict: esto es la segunda cerradura.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  try {
    const r = await guardarCambio(body, { rol: auth.role });
    if (!r.ok) return NextResponse.json({ error: r.error, codigo: r.codigo }, { status: r.status, headers: sinCache });
    return NextResponse.json(r.data, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo guardar el cambio en caja", { logContext: "turnero cambio POST", error });
  }
}
