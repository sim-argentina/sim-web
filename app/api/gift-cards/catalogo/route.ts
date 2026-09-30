import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { catalogoGiftCardsVigente } from "@/lib/giftCardsComercial";

// Catálogo VIGENTE de Gift Cards (Bloque B5): modalidad, productos (duración,
// monto y textos), vigencia y tope de cantidad. Lo usan la compra web y el
// alta del panel: un solo catálogo para los dos. Sin datos personales.
//
// Lo decide el servidor en cada request —antes del corte legacy 15/30, desde
// el primer request posterior v2_10 10/20/30—, así que no se cachea en ningún
// nivel: ni Next, ni la CDN, ni el navegador.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  if (!(await rateLimit(`gift-cat:${clientIp(req)}`, 120, 60_000))) return tooManyResponse();
  try {
    return NextResponse.json(await catalogoGiftCardsVigente(), { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo obtener el catálogo de Gift Cards", { logContext: "gift-cards catalogo", error });
  }
}
