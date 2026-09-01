import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { resumenSaldo } from "@/lib/ia/creditos/saldoServer";

// Saldo de créditos (admin-only): saldo calculado, cargas, costo oficial acumulado,
// consumo interno estimado del mes, estado de sync y alertas. Sin caché.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const r = await resumenSaldo();
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el saldo." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
