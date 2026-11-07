import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { fichaConfigurada, resenasPublicas } from "@/lib/googleReviews";

// Reseñas de Google para la Home, pedidas por el navegador al llegar a la
// sección (components/ResenasGoogle.tsx). SIN CACHÉ en ninguna capa: las
// políticas de Google Maps Platform no permiten guardar reseñas, así que cada
// respuesta sale de una consulta a Google en el momento y nada la retiene (ni
// el Data Cache de Next, ni la CDN de Vercel, ni el navegador).
//
// No acepta parámetros: la consulta a Google es fija (Place ID y campos del
// servidor), como pide la guía de seguridad de Google para un proxy. Los
// límites protegen la facturación (cada respuesta es una consulta Place
// Details Enterprise + Atmosphere): por IP y uno global por hora. Pasado un
// límite, la Home muestra el enlace a Google Maps (nunca un esqueleto).

export const dynamic = "force-dynamic";

const SIN_CACHE = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

/** Por IP: una visita normal pide 1 vez; 6 por minuto cubre recargas. */
const LIMITE_POR_IP = { cantidad: 6, ventanaMs: 60_000 };
/** Global: tope de consultas a Google por hora para todo el sitio. */
const LIMITE_GLOBAL = { cantidad: 300, ventanaMs: 60 * 60_000 };

export async function GET(req: Request) {
  const porIp = await rateLimit(`resenas:ip:${clientIp(req)}`, LIMITE_POR_IP.cantidad, LIMITE_POR_IP.ventanaMs);
  const global = porIp && (await rateLimit("resenas:global", LIMITE_GLOBAL.cantidad, LIMITE_GLOBAL.ventanaMs));
  if (!porIp || !global) {
    return NextResponse.json(
      { estado: "limitado", reviews: [], resumen: null, fichaUrl: fichaConfigurada() },
      { status: 429, headers: SIN_CACHE },
    );
  }
  return NextResponse.json(await resenasPublicas(), { headers: SIN_CACHE });
}
