import { NextResponse } from "next/server";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Purga definitiva de la papelera (> 30 días). Endpoint PROTEGIDO: lo dispara el Cron
// de Vercel (GET con `Authorization: Bearer ${CRON_SECRET}`), o un admin manualmente
// (POST con sesión). Nunca es un endpoint público desprotegido.
const DIAS_RETENCION = 30;

function tieneSecretoCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.IA_CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function purgar() {
  const { data, error } = await supabaseAdmin.rpc("ia_purgar_papelera", { p_dias: DIAS_RETENCION });
  if (error) return NextResponse.json({ error: "No se pudo purgar." }, { status: 500 });
  return NextResponse.json({ ok: true, eliminadas: data ?? 0, retencion_dias: DIAS_RETENCION });
}

// Cron de Vercel (GET con el secreto).
export async function GET(req: Request) {
  if (!tieneSecretoCron(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return purgar();
}

// Disparo manual por un admin autenticado (o con el secreto de cron).
export async function POST(req: Request) {
  if (!tieneSecretoCron(req) && (await getCurrentAdminRole()) !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  return purgar();
}
