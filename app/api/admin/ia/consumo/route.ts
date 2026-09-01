import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN, getLimites, PRECIOS_VERSION } from "@/lib/ia/config";
import { rangoMes } from "@/lib/ia/consumoUtil";

// Siempre dinámico y sin caché: el contador debe reflejar el consumo real al instante.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function hoyISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
}

// Consumo de IA (admin-only): tokens del día y del MES LOCAL (Córdoba), costo estimado,
// % del límite y advertencia de uso desconocido. Sin caché.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const hoy = hoyISO();
  const mes = hoy.slice(0, 7);
  const { desde, hasta } = rangoMes(mes);

  const { data, error } = await supabaseAdmin
    .from("ia_consumo")
    .select("dia, tokens_in, tokens_out, solicitudes, costo_estimado")
    .eq("owner", IA_OWNER_ADMIN)
    .gte("dia", desde)
    .lt("dia", hasta);
  if (error) return NextResponse.json({ error: "No se pudo leer el consumo." }, { status: 500, headers: { "Cache-Control": "no-store" } });

  const rows = data ?? [];
  const mesTot = rows.reduce((a, r) => ({ tin: a.tin + Number(r.tokens_in || 0), tout: a.tout + Number(r.tokens_out || 0), sol: a.sol + Number(r.solicitudes || 0), costo: a.costo + Number(r.costo_estimado || 0) }), { tin: 0, tout: 0, sol: 0, costo: 0 });
  const hoyRow = rows.find((r) => r.dia === hoy);
  const limites = getLimites();
  const tokensMes = mesTot.tin + mesTot.tout;

  // Uso DESCONOCIDO: ejecuciones reales completas del mes (no fake) sin usage registrado.
  const { count: desconocidas } = await supabaseAdmin
    .from("ia_ejecuciones")
    .select("id", { count: "exact", head: true })
    .neq("proveedor", "fake")
    .eq("estado", "completa")
    .eq("tokens_in", 0)
    .eq("tokens_out", 0)
    .gte("created_at", `${desde}T00:00:00-03:00`)
    .lt("created_at", `${hasta}T00:00:00-03:00`);

  return NextResponse.json(
    {
      hoy: { dia: hoy, tokens_in: Number(hoyRow?.tokens_in || 0), tokens_out: Number(hoyRow?.tokens_out || 0), solicitudes: Number(hoyRow?.solicitudes || 0) },
      mes: {
        periodo: mes,
        tokens_in: mesTot.tin,
        tokens_out: mesTot.tout,
        tokens_total: tokensMes,
        solicitudes: mesTot.sol,
        // 4 decimales: los montos chicos no se muestran como cero.
        costo_estimado_usd: Math.round(mesTot.costo * 10000) / 10000,
      },
      limites: { solicitudes_dia: limites.solicitudesDia, tokens_mes: limites.tokensMesMax },
      porcentaje: {
        solicitudes_dia: hoyRow ? Math.round((Number(hoyRow.solicitudes) / limites.solicitudesDia) * 100) : 0,
        tokens_mes: Math.round((tokensMes / limites.tokensMesMax) * 100),
      },
      uso_desconocido: Number(desconocidas || 0),
      precios_version: PRECIOS_VERSION,
      nota: "El costo es una ESTIMACIÓN con tabla de precios versionada; no es la facturación exacta de Anthropic.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
