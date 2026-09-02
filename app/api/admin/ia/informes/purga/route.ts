import { NextResponse } from "next/server";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { purgarInformes } from "@/lib/ia/informes/informesServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Purga definitiva de informes en papelera > 30 días (borra Storage + filas).
// La dispara el Cron de Vercel (GET con Authorization: Bearer CRON_SECRET) o un admin (POST).
const DIAS_RETENCION = 30;

function tieneSecretoCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.IA_CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!tieneSecretoCron(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const r = await purgarInformes(DIAS_RETENCION);
  return NextResponse.json({ ok: true, ...r, retencion_dias: DIAS_RETENCION });
}

export async function POST(req: Request) {
  if (!tieneSecretoCron(req) && (await getCurrentAdminRole()) !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const r = await purgarInformes(DIAS_RETENCION);
  return NextResponse.json({ ok: true, ...r, retencion_dias: DIAS_RETENCION });
}
