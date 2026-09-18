import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getDetalleMensualidad } from "@/lib/mensualidadesAdmin";
import { getAuditoria } from "@/lib/mensualidadesAdminAcciones";

// Detalle administrativo de UNA mensualidad (Bloque M7).
//
// Lo abren admin y staff, pero NO ven lo mismo, y la diferencia la hace el
// servidor:
//   · el código de acceso viaja solo para admin (para staff, null);
//   · el rastro administrativo —quién bloqueó, quién cambió un teléfono, quién
//     rotó un código— viaja solo para admin.
// Staff sí ve todo lo operativo: titular, estado, saldo, vencimiento, plan,
// reservas y los movimientos que explican por qué el saldo es el que es.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    // Un id con otra forma no existe: se responde igual que si no estuviera.
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
    }

    const detalle = await getDetalleMensualidad(id, auth.role);
    if (!detalle) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
    }

    const auditoria = auth.role === "admin" ? await getAuditoria(id) : [];

    return NextResponse.json({ ...detalle, auditoria, rol: auth.role }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo cargar la mensualidad", {
      logContext: "admin-mensualidades-detalle", error,
    });
  }
}
