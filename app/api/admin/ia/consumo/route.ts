import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN, getLimites, PRECIOS_VERSION } from "@/lib/ia/config";

function hoyISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
}

// Consumo de IA (admin-only): tokens del día y del mes, costo estimado y % del límite.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const hoy = hoyISO();
  const mes = hoy.slice(0, 7);
  const { data } = await supabaseAdmin.from("ia_consumo").select("dia, tokens_in, tokens_out, solicitudes, costo_estimado").eq("owner", IA_OWNER_ADMIN).gte("dia", `${mes}-01`).lte("dia", `${mes}-31`);
  const rows = data ?? [];
  const mesTot = rows.reduce((a, r) => ({ tin: a.tin + Number(r.tokens_in || 0), tout: a.tout + Number(r.tokens_out || 0), sol: a.sol + Number(r.solicitudes || 0), costo: a.costo + Number(r.costo_estimado || 0) }), { tin: 0, tout: 0, sol: 0, costo: 0 });
  const hoyRow = rows.find((r) => r.dia === hoy);
  const limites = getLimites();
  const tokensMes = mesTot.tin + mesTot.tout;
  return NextResponse.json({
    hoy: { dia: hoy, tokens_in: Number(hoyRow?.tokens_in || 0), tokens_out: Number(hoyRow?.tokens_out || 0), solicitudes: Number(hoyRow?.solicitudes || 0) },
    mes: { periodo: mes, tokens_in: mesTot.tin, tokens_out: mesTot.tout, tokens_total: tokensMes, solicitudes: mesTot.sol, costo_estimado_usd: Math.round(mesTot.costo * 10000) / 10000 },
    limites: { solicitudes_dia: limites.solicitudesDia, tokens_mes: limites.tokensMesMax },
    porcentaje: { solicitudes_dia: hoyRow ? Math.round((Number(hoyRow.solicitudes) / limites.solicitudesDia) * 100) : 0, tokens_mes: Math.round((tokensMes / limites.tokensMesMax) * 100) },
    precios_version: PRECIOS_VERSION,
    nota: "El costo es una ESTIMACIÓN con tabla de precios versionada; no es la facturación exacta de Anthropic.",
  });
}
