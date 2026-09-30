import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { catalogoReservasVigente } from "@/lib/reservasComercial";

// Catálogo VIGENTE de Reservas (Bloque B3): modalidad, duraciones, precios base,
// paso de agenda, buffer y ventana de fechas. Lo decide el servidor en cada
// request —antes del corte legacy, desde el primer request posterior, v2_10—, así
// que no se cachea en ningún nivel: ni Next, ni la CDN, ni el navegador.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  if (!(await rateLimit(`resv-cat:${clientIp(req)}`, 120, 60_000))) return tooManyResponse();
  try {
    return NextResponse.json(await catalogoReservasVigente(), { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo obtener el catálogo", { logContext: "reservas catalogo", error });
  }
}
