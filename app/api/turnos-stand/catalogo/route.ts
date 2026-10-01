import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { catalogoTurneroVigente } from "@/lib/turneroComercial";

// (B8) Oferta del Turnero según la modalidad VIGENTE (override > calendario),
// resuelta en cada request: activar o volver atrás el modelo no necesita
// redeploy y la pantalla nunca usa una oferta fija del bundle.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await catalogoTurneroVigente(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}
