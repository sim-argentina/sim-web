import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { resenasGooglePublicasHabilitadas } from "@/lib/featureFlags";
import { atenderResenasPublicas } from "@/lib/googleReviews";
import { contadorGooglePlaces } from "@/lib/googlePlacesConsumo";

// Reseñas de Google para la Home, pedidas por el navegador SOLO cuando el
// visitante pulsa «Ver reseñas» (components/ResenasGoogle.tsx, hoy sin montar:
// la Home muestra un resumen estático y no llama a esta ruta).
//
//   · Apagada por defecto (RESENAS_GOOGLE_PUBLICAS): 404 sin consultar a Google
//     ni tocar el contador; la Home muestra solo el enlace a Google Maps.
//   · Prendida: límite por IP y TOPE DIARIO COMPARTIDO (db/google-places-consumo.sql),
//     reservado antes de cada consulta real a Google, incluido el respaldo legacy.
//     Tope alcanzado o contador sin responder → sin consulta, solo el enlace.
//   · SIN CACHÉ en ninguna capa: las políticas de Google Maps Platform no
//     permiten guardar reseñas (ni el Data Cache de Next, ni la CDN, ni el navegador).
//   · No acepta parámetros: Place ID y campos los fija el servidor.
//   · La lógica vive en atenderResenasPublicas (lib/googleReviews.ts), probada
//     con dobles; acá solo se conectan las dependencias reales y los encabezados.

export const dynamic = "force-dynamic";

const SIN_CACHE = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

/** Por IP: una visita pulsa una vez; 6 por minuto cubre reintentos. */
const LIMITE_POR_IP = { cantidad: 6, ventanaMs: 60_000 };

export async function GET(req: Request) {
  const { status, cuerpo } = await atenderResenasPublicas(req, {
    habilitada: resenasGooglePublicasHabilitadas(),
    contador: () => contadorGooglePlaces(),
    limitePorIp: (r) => rateLimit(`resenas:ip:${clientIp(r)}`, LIMITE_POR_IP.cantidad, LIMITE_POR_IP.ventanaMs),
  });
  return NextResponse.json(cuerpo, { status, headers: SIN_CACHE });
}
