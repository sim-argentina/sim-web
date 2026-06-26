import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { getBloqueosActivos } from "@/lib/bloqueos";

// Bloqueos activos de una fecha, para que el calendario público oculte los
// turnos no disponibles. Requiere ?fecha (mismo criterio que disponibilidad).
export async function GET(req: Request) {
  if (!(await rateLimit(`bloqueos-get:${clientIp(req)}`, 60, 60_000))) {
    return tooManyResponse();
  }

  const { searchParams } = new URL(req.url);
  const fecha = searchParams.get("fecha");

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }

  try {
    const bloqueos = await getBloqueosActivos(fecha);
    return NextResponse.json({ bloqueos });
  } catch {
    return NextResponse.json(
      { error: "Error al obtener bloqueos" },
      { status: 500 }
    );
  }
}
