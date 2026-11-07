import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { resenasGooglePublicasHabilitadas } from "@/lib/featureFlags";
import { diagnosticarResenas } from "@/lib/googleReviews";
import { contadorGooglePlaces } from "@/lib/googlePlacesConsumo";

// Diagnóstico de las reseñas de Google de la Home. SOLO ADMIN (staff 403).
//
// Es la CONSULTA CONTROLADA con la key que ya existe en Producción: no depende
// de RESENAS_GOOGLE_PUBLICAS (sirve con la consulta pública apagada) y el tope
// diario no lo frena, pero cada llamada real a Google queda contada en el
// contador compartido (forzado). Si el contador no responde (p. ej. falta
// db/google-places-consumo.sql), consulta igual y lo marca: "contada": false.
//
// Devuelve la configuración (la key solo como "presente"/"ausente", nunca su
// valor), cada intento con su HTTP, estado y razón de Google (mensajes
// redactados), cuántas reseñas llegaron y cuántas se mostrarían, el contador del
// día y una indicación concreta. No devuelve el texto de las reseñas ni datos de
// sus autores. Cada apertura es 1 consulta facturable (2 si cae al respaldo).

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const diagnostico = await diagnosticarResenas(contadorGooglePlaces(), resenasGooglePublicasHabilitadas());
  return NextResponse.json(diagnostico, { headers: sinCache });
}
