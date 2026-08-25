import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { validarCodigo } from "@/lib/empresasServer";

// Validación pública de un código empresarial (read-only). Rate-limited. Mensajes
// genéricos (no revela si existe/venció/está usado → evita enumeración).
export async function POST(req: Request) {
  if (!(await rateLimit(`emp-val:${clientIp(req)}`, 20, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Código inválido o no disponible." }, { status: 400 }); }
  const res = await validarCodigo(String(body.codigo ?? ""));
  if (!res.ok) return NextResponse.json({ error: "Código inválido o no disponible." }, { status: res.status });
  return NextResponse.json(res.data);
}
