import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { normalizarImporteUsd } from "@/lib/ia/creditos/dinero";
import { conciliar } from "@/lib/ia/creditos/saldoServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Conciliar con el saldo observado en Anthropic Console. confirmar=false → solo
// compara (preview); confirmar=true → crea el ajuste de conciliación (conserva
// historial, no sobrescribe). Admin-only.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }

  const observado = normalizarImporteUsd(body.saldo_observado_usd, { permitirCero: true });
  if (observado == null) return NextResponse.json({ error: "Saldo observado inválido." }, { status: 400 });
  const confirmar = Boolean(body.confirmar);
  const motivo = body.motivo ? String(body.motivo) : null;

  const r = await conciliar({ observadoUsd: observado, confirmar, motivo, actor: IA_OWNER_ADMIN });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
