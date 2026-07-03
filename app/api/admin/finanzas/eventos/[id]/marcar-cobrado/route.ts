import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidUuid } from "@/lib/security";
import { marcarEvento } from "@/lib/finanzasEventos";

type Params = { params: Promise<{ id: string }> };

// body: { fecha_real?, crear_movimiento? (default true), confirmar_duplicado? }
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  try {
    const res = await marcarEvento({
      eventoId: id,
      accion: "cobrado",
      fechaReal: body.fecha_real ? String(body.fecha_real) : null,
      crearMovimiento: body.crear_movimiento !== false,
      confirmarDuplicado: body.confirmar_duplicado === true,
      rol: auth.role,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error, requiere_confirmacion: res.requiere_confirmacion },
        { status: res.status }
      );
    }
    return NextResponse.json({ ok: true, evento: res.evento, movimiento: res.movimiento });
  } catch (error) {
    return failResponse(500, "Error marcando el cobro", { logContext: "finanzas marcar-cobrado POST", error });
  }
}
