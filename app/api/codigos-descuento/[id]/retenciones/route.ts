import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { retencionesDeCodigo } from "@/lib/cuponesRetencionPanel";

// Panel de Códigos · retenciones de un código (solo lectura, admin como el resto
// del panel). Con la compra vinculada, el producto, las fechas y el estado. Sin
// intento, huella ni link de pago.

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  try {
    const retenciones = await retencionesDeCodigo(id);
    return NextResponse.json(
      { instaladas: retenciones !== null, retenciones: retenciones ?? [] },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return failResponse(500, "Error cargando las retenciones", { logContext: "codigos retenciones GET", error });
  }
}
