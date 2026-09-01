import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { anularMovimiento } from "@/lib/ia/creditos/saldoServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Anular un movimiento confirmado (conserva historial; NO borra). Admin-only.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const id = String(body.id || "");
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const motivo = String(body.motivo || "").trim();
  if (!motivo) return NextResponse.json({ error: "Falta el motivo de anulación." }, { status: 400 });

  const r = await anularMovimiento(id, motivo, IA_OWNER_ADMIN);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
