import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { reservarConCodigo } from "@/lib/empresasServer";

// Reserva empresarial (canje que BOOKEA). Transacción atómica reserva+slots+consumo:
// nunca gasta el código sin crear la reserva. Rate-limited + origin. La duración y la
// validación son server-side (no se confía en el front). Idempotency key opcional.
export async function POST(req: Request) {
  if (!(await rateLimit(`emp-reservar:${clientIp(req)}`, 10, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Código inválido o no disponible." }, { status: 400 }); }

  const res = await reservarConCodigo(
    String(body.codigo ?? ""),
    {
      nombre: body.nombre ? String(body.nombre).trim().slice(0, 80) : undefined,
      apellido: body.apellido ? String(body.apellido).trim().slice(0, 80) : undefined,
      telefono: body.telefono ? String(body.telefono).trim().slice(0, 40) : undefined,
      email: body.email ? String(body.email).trim().slice(0, 120) : undefined,
    },
    String(body.fecha ?? ""),
    String(body.hora ?? ""),
    Array.isArray(body.simuladores) ? (body.simuladores as unknown[]).map(String) : [],
    body.idempotency_key ? String(body.idempotency_key).slice(0, 80) : null,
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data, { status: 201 });
}
