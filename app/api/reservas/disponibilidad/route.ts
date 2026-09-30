import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { disponibilidadReservas } from "@/lib/reservasComercial";

// Disponibilidad de Reservas para la página /reservas (Bloque B3). El navegador
// pide fecha y duración (sin ellas: primer día reservable y primera duración);
// el servidor resuelve la modalidad vigente, calcula con el motor por intervalos
// y devuelve el catálogo, los precios del día y, por cada inicio, cuántos
// simuladores —y cuáles— están libres durante TODO el turno. El navegador no
// calcula disponibilidad.
//
// Sin PII: ni nombres de clientes ni datos de reservas; solo horarios y qué
// simuladores (recursos) están libres. Sin caché: el corte tiene que verse en el
// primer request posterior.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  if (!(await rateLimit(`resv-disp:${clientIp(req)}`, 120, 60_000))) return tooManyResponse();

  const url = new URL(req.url);
  const fecha = url.searchParams.get("fecha") ?? "";
  const duracion = url.searchParams.get("duracion");
  if (duracion !== null && !/^\d{1,3}$/.test(duracion)) {
    return NextResponse.json({ error: "Duración inválida" }, { status: 400, headers: sinCache });
  }

  try {
    const r = await disponibilidadReservas({ fecha, duracion: duracion ?? undefined });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, ...(r.duraciones ? { duraciones: r.duraciones } : {}) },
        { status: r.status, headers: sinCache },
      );
    }
    return NextResponse.json(r.data, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo calcular la disponibilidad", {
      logContext: "reservas disponibilidad", error,
    });
  }
}
