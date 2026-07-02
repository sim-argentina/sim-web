import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { clasificarTexto } from "@/lib/finanzas";

// Interpreta texto libre ("8500 nafta efectivo") y devuelve un movimiento
// sugerido estructurado. NO guarda nada: la confirmación es siempre explícita.
// Pensado para la caja de carga rápida y para una futura integración WhatsApp
// (mismo contrato de entrada/salida).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const texto = String(body.texto || "").trim();

  if (texto.length < 3 || texto.length > 500) {
    return NextResponse.json({ error: "Texto inválido (3 a 500 caracteres)" }, { status: 400 });
  }

  try {
    const sugerencia = await clasificarTexto(texto);
    return NextResponse.json({ sugerencia });
  } catch (error) {
    return failResponse(500, "Error clasificando el texto", {
      logContext: "finanzas clasificar POST",
      error,
    });
  }
}
