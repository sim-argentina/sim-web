import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { disponibilidadReservas } from "@/lib/reservasComercial";

// Disponibilidad pública (Bloque M6). Es el ÚNICO contrato de disponibilidad:
// el navegador no vuelve a definir horarios ni a calcular cuántos simuladores
// quedan libres, y tampoco puede mandarlos.
//
// Devuelve solo lo imprescindible: qué horarios están habilitados y cuántos
// simuladores quedan libres durante TODA la duración. Nunca reservas, nombres,
// teléfonos ni identificadores internos.
//
// (B3) Reservas sale del motor por intervalos con la modalidad VIGENTE (antes
// del corte legacy, idéntico a lo de siempre; desde el corte, v2_10) y agrega
// `modalidad`.
//
// (B9) La rama de Mensualidades se RETIRÓ (410). La disponibilidad de un plan
// depende de SU modalidad (mensualidades.modalidad) y, al reprogramar, de la de
// la reserva; este endpoint no tiene sesión ni plan, así que con v2 respondía la
// grilla vieja. Nadie la consumía: la web usa /api/mensualidades/disponibilidad
// (B6, con la sesión del plan y el motor B2).

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  if (!(await rateLimit(`disp:${clientIp(req)}`, 120, 60_000))) return tooManyResponse();

  const url = new URL(req.url);
  const fecha = url.searchParams.get("fecha") ?? "";
  const duracionParam = url.searchParams.get("duracion");
  const productoCrudo = url.searchParams.get("producto") ?? "reserva";

  // Solo productos conocidos. Un valor raro no cae en el default: se rechaza.
  if (productoCrudo !== "reserva" && productoCrudo !== "mensualidad") {
    return NextResponse.json({ error: "Producto inválido" }, { status: 400, headers: sinCache });
  }
  // Mensualidades no se expone mientras la venta esté apagada: mismo 404 que el
  // resto del módulo, sin revelar que la función existe. Encendida: retirada.
  if (productoCrudo === "mensualidad") {
    if (!mensualidadesHabilitadas()) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
    }
    return NextResponse.json(
      { error: "La disponibilidad de Mensualidades se consulta desde Mi Plan.", codigo: "producto_retirado" },
      { status: 410, headers: sinCache },
    );
  }

  if (duracionParam !== null && !/^\d+$/.test(duracionParam)) {
    return NextResponse.json({ error: "Duración inválida" }, { status: 400, headers: sinCache });
  }

  try {
    const r = await disponibilidadReservas({ fecha, duracion: duracionParam ?? undefined });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: sinCache });
    return NextResponse.json({
      fecha: r.data.fecha,
      duracion: r.data.duracion,
      modalidad: r.data.modalidad,
      // Las duraciones que este producto puede pedir, para que el front no las repita.
      duraciones: r.data.duraciones,
      // La ventana pública, misma fuente que usa el servidor para validar.
      fechas: r.data.ventana,
      horarios: r.data.horarios
        .filter((h) => h.disponibles > 0)
        .map((h) => ({ hora: h.hora, simuladores: h.disponibles })),
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo calcular la disponibilidad", {
      logContext: "disponibilidad", error,
    });
  }
}
