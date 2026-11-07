import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { diagnosticarResenas } from "@/lib/googleReviews";

// Diagnóstico de las reseñas de Google de la Home. SOLO ADMIN y SOLO LECTURA.
//
// Consulta a Google en el momento (sin caché) y devuelve qué configuración hay
// (la key solo como "presente"/"ausente", nunca su valor), cada intento con su
// HTTP, estado y razón de Google (mensajes redactados), cuántas reseñas llegaron
// y cuántas se mostrarían, y una indicación concreta de qué falta configurar.
// No devuelve el texto de las reseñas ni datos de sus autores. Cada llamada es
// una consulta facturable a Places API: usarlo para verificar, no en un loop.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const diagnostico = await diagnosticarResenas();
  return NextResponse.json(diagnostico, { headers: sinCache });
}
