import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { validarCodigoDescuento } from "@/lib/codigosDescuento";

export async function POST(req: Request) {
  // Rate limit anti enumeración de códigos.
  if (!(await rateLimit(`validar:${clientIp(req)}`, 20, 60_000))) {
    return NextResponse.json(
      { valido: false, error: "Demasiados intentos. Esperá un minuto." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const codigoBuscado = String(body.codigo || "").trim().toUpperCase().slice(0, 40);
  const totalOriginal = Number(body.total || 0);
  // Fecha del turno (opcional): habilita las restricciones por día/fecha.
  const fechaTurno = String(body.fecha || "").trim();
  // Duración del turno (opcional): habilita la restricción por duración.
  const duracionTurno = Number(body.duracion) || null;

  if (!codigoBuscado || totalOriginal <= 0) {
    return NextResponse.json(
      { valido: false, error: "Código o total inválido" },
      { status: 400 }
    );
  }

  try {
    // Toda la lógica vive en el lib compartido (misma validación que usan las
    // rutas que crean reservas), evitando duplicar reglas.
    const r = await validarCodigoDescuento(
      codigoBuscado,
      totalOriginal,
      fechaTurno || null,
      duracionTurno
    );

    if (!r.valido) {
      return NextResponse.json({ valido: false, error: r.error });
    }

    const descuento = r.descuento;
    const totalFinal = Math.max(totalOriginal - descuento, 0);

    return NextResponse.json({
      valido: true,
      codigo: r.codigo,
      descuento,
      totalOriginal,
      totalFinal,
    });
  } catch {
    return NextResponse.json(
      { valido: false, error: "Error validando código" },
      { status: 500 }
    );
  }
}
