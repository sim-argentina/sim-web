import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { leerInstante } from "@/lib/modalidadComercial";
import { diagnosticoModalidad } from "@/lib/modalidadComercialDiagnostico";

// Diagnóstico de la modalidad comercial (Bloque B0). SOLO ADMIN y SOLO LECTURA.
//
// Devuelve la modalidad programada por calendario, el override, la efectiva, el
// corte, la hora del servidor y los dos catálogos. `?at=<ISO con zona>` simula
// el calendario en otro instante para comprobar el corte antes de que llegue.
//
// Simular NO cambia nada: no escribe en la base, no toca el override y ningún
// flujo comercial lee este endpoint. staff recibe 403: es material interno de
// contingencia, no información operativa del día.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const crudo = new URL(req.url).searchParams.get("at");
  let simularEn: Date | null = null;
  if (crudo !== null) {
    simularEn = leerInstante(crudo);
    if (!simularEn) {
      return NextResponse.json(
        { error: "Parámetro at inválido: usá un instante ISO 8601 con zona (AAAA-MM-DDTHH:MM:SS.sssZ o …-03:00)." },
        { status: 400, headers: sinCache },
      );
    }
  }

  try {
    const diagnostico = await diagnosticoModalidad({ simularEn });
    return NextResponse.json(diagnostico, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo generar el diagnóstico", {
      logContext: "admin-modalidad-diagnostico", error,
    });
  }
}
