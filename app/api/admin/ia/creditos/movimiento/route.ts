import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { normalizarImporteUsd } from "@/lib/ia/creditos/dinero";
import { registrarMovimiento, TIPOS_MOVIMIENTO, type TipoMovimiento } from "@/lib/ia/creditos/saldoServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Registrar un movimiento de crédito (carga / ajuste). La conciliación se hace por
// su propio endpoint. Idempotente por idempotency_key. Admin-only + rate limit.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:creditos:mov", 30, 60_000))) return tooManyResponse();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }

  const tipo = String(body.tipo || "") as TipoMovimiento;
  if (!TIPOS_MOVIMIENTO.includes(tipo) || tipo === "conciliacion") {
    return NextResponse.json({ error: "Tipo inválido. Usá carga, ajuste_positivo, ajuste_negativo o credito_vencido." }, { status: 400 });
  }
  const importe = normalizarImporteUsd(body.importe_usd);
  if (!importe) return NextResponse.json({ error: "Importe USD inválido (debe ser positivo)." }, { status: 400 });
  const fecha = String(body.fecha || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)." }, { status: 400 });
  const descripcion = String(body.descripcion || "").trim();
  if (!descripcion) return NextResponse.json({ error: "Falta la descripción." }, { status: 400 });

  const r = await registrarMovimiento({
    tipo, importeUsd: importe, fecha, descripcion,
    referencia: body.referencia ? String(body.referencia) : null,
    idempotencyKey: body.idempotency_key ? String(body.idempotency_key) : null,
    actor: IA_OWNER_ADMIN,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id, duplicado: r.duplicado }, { status: r.duplicado ? 200 : 201, headers: { "Cache-Control": "no-store" } });
}
