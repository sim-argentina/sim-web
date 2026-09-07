import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { leerSesion, tokenDeRequest } from "@/lib/mensualidadSesion";
import { huellaCodigo } from "@/lib/mensualidadHuella";
import { simuladoresLibresDelDia } from "@/lib/disponibilidad";
import { DURACIONES_POR_PRODUCTO, fechasPublicas } from "@/lib/agenda";

// Disponibilidad CON NOMBRES de escudería para Mensualidades (Bloque M5A).
//
// Existe aparte de /api/disponibilidad porque devuelve más: qué escuderías
// concretas están libres, no cuántas. Eso solo se entrega a quien ya probó ser
// el titular (sesión de M4). El DTO público genérico de M6 no se toca ni se
// debilita: sigue devolviendo cantidades a cualquiera.
//
// Lo que NO devuelve: reservas, nombres de personas, teléfonos, emails, ids
// internos ni nada de la billetera más allá del saldo del propio titular.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

// Misma respuesta para "sin cookie", "token inválido" y "sesión vencida".
const sinSesion = () =>
  NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

export async function GET(req: Request) {
  // Acceso NUEVO a la función de reservar: depende de la flag.
  if (!mensualidadesHabilitadas()) return sinSesion();
  if (!(await rateLimit(`mens-disp-ip:${clientIp(req)}`, 90, 60_000))) return tooManyResponse();

  try {
    const sesion = await leerSesion(tokenDeRequest(req));
    if (!sesion) return sinSesion();

    // Segundo carril del rate limit: por sesión, con huella no reversible. Una
    // sola sesión no puede barrer el calendario entero aunque rote de IP.
    if (!(await rateLimit(`mens-disp-ses:${huellaCodigo(sesion.sesionId)}`, 120, 60_000))) {
      return tooManyResponse();
    }

    const url = new URL(req.url);
    const fecha = url.searchParams.get("fecha") ?? "";
    const duracionCruda = url.searchParams.get("duracion") ?? "15";
    if (!/^\d+$/.test(duracionCruda)) {
      return NextResponse.json({ error: "Duración inválida" }, { status: 400, headers: sinCache });
    }

    const r = await simuladoresLibresDelDia({
      fecha, duracion: Number(duracionCruda), producto: "mensualidad",
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: sinCache });

    return NextResponse.json({
      fecha: r.fecha,
      duracion: r.duracion,
      duraciones: DURACIONES_POR_PRODUCTO.mensualidad,
      fechas: fechasPublicas(),
      horarios: r.horarios,
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo calcular la disponibilidad", {
      logContext: "mens-disponibilidad", error,
    });
  }
}
