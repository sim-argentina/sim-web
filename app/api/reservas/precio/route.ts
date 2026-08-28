import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { getPreciosEfectivos } from "@/lib/reservasPricing";

// GET público: precio EFECTIVO por simulador de una fecha (especial si existe, si no el
// normal), para que la web muestre el importe correcto. Solo devuelve montos (sin PII).
// El servidor sigue siendo la fuente de verdad al crear la preferencia/reserva.
export async function GET(req: Request) {
  if (!(await rateLimit(`resv-precio:${clientIp(req)}`, 120, 60_000))) {
    return tooManyResponse();
  }
  const fecha = new URL(req.url).searchParams.get("fecha") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  try {
    const precios = await getPreciosEfectivos(fecha);
    return NextResponse.json(precios, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch {
    return NextResponse.json({ error: "No se pudo obtener el precio" }, { status: 500 });
  }
}
