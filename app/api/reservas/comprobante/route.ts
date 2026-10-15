import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { reservaPostpayHabilitada } from "@/lib/featureFlags";
import { comprobantePorToken } from "@/lib/reservaPostpay";

// Estado del comprobante de una Reserva pagada (experiencia post-pago,
// EXPERIMENTAL). Lo consulta /reservas/confirmacion mientras el webhook todavía
// no confirmó el pago. Solo con el enlace firmado (?t=); "pagada" sale de la
// base, nunca de lo que Mercado Pago agrega a la URL. Con la variable apagada,
// o con un enlace que no es auténtico: 404. Sin caché.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };
const noEncontrado = () => NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

export async function GET(req: Request) {
  if (!reservaPostpayHabilitada()) return noEncontrado();
  if (!(await rateLimit(`resv-comp:${clientIp(req)}`, 60, 60_000))) return tooManyResponse();
  try {
    const url = new URL(req.url);
    const comprobante = await comprobantePorToken(url.searchParams.get("t"), url.searchParams.get("vuelta"));
    if (!comprobante) return noEncontrado();
    return NextResponse.json(comprobante, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo consultar la reserva", { logContext: "reserva comprobante", error });
  }
}
