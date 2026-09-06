import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { disponibilidadDelDia } from "@/lib/disponibilidad";
import { DURACIONES_POR_PRODUCTO, fechasPublicas, type Producto } from "@/lib/agenda";

// Disponibilidad pública (Bloque M6). Es el ÚNICO contrato de disponibilidad:
// el navegador no vuelve a definir horarios ni a calcular cuántos simuladores
// quedan libres, y tampoco puede mandarlos.
//
// Devuelve solo lo imprescindible: qué horarios están habilitados y cuántos
// simuladores quedan libres durante TODA la duración. Nunca reservas, nombres,
// teléfonos ni identificadores internos.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  if (!(await rateLimit(`disp:${clientIp(req)}`, 120, 60_000))) return tooManyResponse();

  const url = new URL(req.url);
  const fecha = url.searchParams.get("fecha") ?? "";
  const duracionCruda = url.searchParams.get("duracion") ?? "15";
  const productoCrudo = url.searchParams.get("producto") ?? "reserva";

  // Solo productos conocidos. Un valor raro no cae en el default: se rechaza.
  if (productoCrudo !== "reserva" && productoCrudo !== "mensualidad") {
    return NextResponse.json({ error: "Producto inválido" }, { status: 400, headers: sinCache });
  }
  const producto = productoCrudo as Producto;

  // Mensualidades no se expone mientras la venta esté apagada: mismo 404 que el
  // resto del módulo, sin revelar que la función existe.
  if (producto === "mensualidad" && !mensualidadesHabilitadas()) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  }

  if (!/^\d+$/.test(duracionCruda)) {
    return NextResponse.json({ error: "Duración inválida" }, { status: 400, headers: sinCache });
  }
  const duracion = Number(duracionCruda);

  try {
    const r = await disponibilidadDelDia({ fecha, duracion, producto });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: sinCache });

    return NextResponse.json({
      fecha: r.fecha,
      duracion: r.duracion,
      // Las duraciones que este producto puede pedir, para que el front no las repita.
      duraciones: DURACIONES_POR_PRODUCTO[producto],
      // La ventana pública, misma fuente que usa el servidor para validar.
      fechas: fechasPublicas(),
      horarios: r.horarios,
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo calcular la disponibilidad", {
      logContext: "disponibilidad", error,
    });
  }
}
