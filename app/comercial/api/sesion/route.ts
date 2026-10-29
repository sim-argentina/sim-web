import { NextResponse } from "next/server";
import { requireCrmActor, SIN_CACHE } from "@/lib/crmAuth";

// Quién es el actor de esta petición en la interfaz comercial (CRM B0). Solo el
// tipo y el nombre: ni IDs internos ni datos de la sesión.
export async function GET() {
  const auth = await requireCrmActor();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ actor: { tipo: auth.actor.tipo, nombre: auth.actor.nombre } }, { headers: SIN_CACHE });
}
