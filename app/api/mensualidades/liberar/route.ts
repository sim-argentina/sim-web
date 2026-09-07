import { NextResponse } from "next/server";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { liberarRetencionesVencidas } from "@/lib/mensualidadesReservaPago";

// Barrido de retenciones mixtas vencidas (Bloque M5B).
//
// Endpoint PROTEGIDO, nunca público: lo dispara el Cron de Vercel (GET con
// `Authorization: Bearer ${CRON_SECRET}`) o un admin manualmente (POST con
// sesión), con el mismo patrón que las purgas de IA.
//
// NO depende de la feature flag: apagar la venta no puede dejar slots tomados
// para siempre ni minutos comprometidos sin devolver.
//
// Antes de soltar cada retención le pregunta a Mercado Pago si hay un pago
// aprobado. Si lo hay, confirma en vez de liberar (pago a tiempo con webhook
// tardío). Si Mercado Pago no responde, POSPONE: es preferible demorar la
// liberación a vender dos veces el mismo turno.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

function tieneSecretoCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function barrer() {
  const r = await liberarRetencionesVencidas();
  // Sin PII y sin ids: solo el recuento, que es lo que sirve para monitorear.
  return NextResponse.json(r, { headers: sinCache });
}

export async function GET(req: Request) {
  if (!tieneSecretoCron(req)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  }
  try {
    return await barrer();
  } catch (error) {
    return failResponse(500, "No se pudo liberar.", { logContext: "mens-liberar", error });
  }
}

export async function POST(req: Request) {
  const role = await getCurrentAdminRole();
  if (!role && !tieneSecretoCron(req)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  }
  try {
    return await barrer();
  } catch (error) {
    return failResponse(500, "No se pudo liberar.", { logContext: "mens-liberar", error });
  }
}
