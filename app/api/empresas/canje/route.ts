import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { canjearCodigo } from "@/lib/empresasServer";

// Canje ATÓMICO de un código (consume un uso). Rate-limited. La atomicidad la
// garantiza el RPC consumir_empresa_codigo (lock de fila). Fase 1: registra el
// beneficiario; la creación de la reserva es Fase 2 (integración Reservas).
export async function POST(req: Request) {
  if (!(await rateLimit(`emp-canje:${clientIp(req)}`, 10, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Código inválido o no disponible." }, { status: 400 }); }
  const res = await canjearCodigo(String(body.codigo ?? ""), {
    nombre: body.nombre ? String(body.nombre).trim().slice(0, 80) : undefined,
    apellido: body.apellido ? String(body.apellido).trim().slice(0, 80) : undefined,
    telefono: body.telefono ? String(body.telefono).trim().slice(0, 40) : undefined,
    email: body.email ? String(body.email).trim().slice(0, 120) : undefined,
  });
  if (!res.ok) return NextResponse.json({ error: "Código inválido o no disponible." }, { status: res.status });
  return NextResponse.json(res.data);
}
