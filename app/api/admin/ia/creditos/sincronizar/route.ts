import { NextResponse } from "next/server";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { sincronizarCostos } from "@/lib/ia/creditos/saldoServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Ventana mínima entre sincronizaciones REALES (caché server-side controlada):
// no se consulta el Cost Report más de una vez por minuto salvo `forzar`.
const MIN_INTERVALO_MS = 60_000;

function tieneSecretoCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.IA_CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function ultimaSyncMs(): Promise<number | null> {
  const { data } = await supabaseAdmin.from("ia_costos_oficiales_snapshots").select("sincronizado_at").order("sincronizado_at", { ascending: false }).limit(1).maybeSingle();
  return data?.sincronizado_at ? new Date(data.sincronizado_at as string).getTime() : null;
}

async function correr(forzar: boolean, actor: string) {
  if (!forzar) {
    const ult = await ultimaSyncMs();
    if (ult != null && Date.now() - ult < MIN_INTERVALO_MS) {
      return NextResponse.json({ ok: true, omitida: true, motivo: "sincronización reciente (ventana de caché)" }, { headers: { "Cache-Control": "no-store" } });
    }
  }
  const r = await sincronizarCostos(actor);
  const status = r.ok ? 200 : r.estado === "no_configurada" ? 200 : r.estado === "rate_limit" ? 429 : r.estado === "credencial_invalida" ? 400 : 502;
  return NextResponse.json(r, { status, headers: { "Cache-Control": "no-store" } });
}

// Disparo manual por un admin (botón ACTUALIZAR SALDO).
export async function POST(req: Request) {
  const esCron = tieneSecretoCron(req);
  if (!esCron && (await getCurrentAdminRole()) !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!esCron && !(await rateLimit("ia:creditos:sync", 6, 60_000))) return tooManyResponse();
  let forzar = false;
  try { forzar = Boolean((await req.json())?.forzar); } catch { /* body opcional */ }
  return correr(forzar, IA_OWNER_ADMIN);
}

// Cron de Vercel (GET con el secreto): sincronización periódica segura.
export async function GET(req: Request) {
  if (!tieneSecretoCron(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return correr(true, "cron");
}
