import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { reservaPostpayHabilitada } from "@/lib/featureFlags";
import { eventoPorToken } from "@/lib/reservaPostpay";
import { archivoIcs } from "@/lib/reservaPostpayCalendario";

// Archivo .ics de una Reserva confirmada (experiencia post-pago, EXPERIMENTAL).
// Se arma con los datos ACTUALES de la reserva en cada descarga (una
// reprogramación sale con la fecha nueva), UID estable y un recordatorio 24 h
// antes. Solo con el enlace firmado y solo si la reserva está activa; si no, 404.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };

export async function GET(req: Request) {
  if (!reservaPostpayHabilitada()) return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  if (!(await rateLimit(`resv-ics:${clientIp(req)}`, 30, 60_000))) return tooManyResponse();
  try {
    const evento = await eventoPorToken(new URL(req.url).searchParams.get("t"));
    if (!evento) return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
    return new NextResponse(archivoIcs(evento), {
      headers: {
        ...sinCache,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="reserva-sim-${evento.fecha}.ics"`,
      },
    });
  } catch (error) {
    return failResponse(500, "No se pudo generar el archivo de calendario", { logContext: "reserva ics", error });
  }
}
