import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { disponibilidadConCodigo } from "@/lib/empresasServer";

// (B7) Horarios libres para canjear un código empresarial en una fecha. Los
// calcula el SERVIDOR con el motor B2, la modalidad guardada de la campaña y su
// duración (bloqueos, pendientes vigentes y reservas de todos los orígenes): la
// página solo muestra lo que recibe. POST para que el código no viaje en la URL.
// Rate-limited + origin; mensajes genéricos (no revela por qué un código falla).
// La respuesta no tiene datos personales: solo horas y simuladores libres.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function POST(req: Request) {
  if (!(await rateLimit(`emp-disp:${clientIp(req)}`, 30, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Código inválido o no disponible." }, { status: 400, headers: sinCache }); }
  const res = await disponibilidadConCodigo(String(body.codigo ?? ""), String(body.fecha ?? ""));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: sinCache });
  return NextResponse.json(res.data, { headers: sinCache });
}
