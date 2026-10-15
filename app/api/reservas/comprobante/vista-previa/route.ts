import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { reservaPostpayHabilitada } from "@/lib/featureFlags";
import { RUTA_CONFIRMACION, firmarComprobante, leerVuelta } from "@/lib/reservaPostpay";

// Vista previa de la experiencia post-pago (EXPERIMENTAL), SOLO ADMIN: abre
// /reservas/confirmacion para una reserva existente sin pasar por Mercado Pago.
//   /api/reservas/comprobante/vista-previa?id=<id>&vuelta=exito|pendiente|error
// No escribe nada: firma el enlace y redirige. Lo que se ve sale de la base,
// igual que para el cliente. Con la variable apagada: 404.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!reservaPostpayHabilitada()) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Indicá el número de reserva: ?id=123" }, { status: 400 });
  }
  const token = firmarComprobante(id);
  if (!token) return NextResponse.json({ error: "Firma no disponible" }, { status: 503 });
  const vuelta = leerVuelta(url.searchParams.get("vuelta")) ?? "exito";
  return NextResponse.redirect(new URL(`${RUTA_CONFIRMACION}?t=${token}&vuelta=${vuelta}`, url.origin), 307);
}
