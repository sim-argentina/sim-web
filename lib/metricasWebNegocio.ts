// Datos REALES de negocio atribuibles a la web (Supabase). Fuente financiera real,
// separada de GA4. Solo se cuentan operaciones que con CERTEZA provienen de la web:
//  - Reservas con origen 'web' (o null legacy = web) y estado 'activa' (confirmadas).
//    Las de origen 'empresa' NO son web y se excluyen.
//  - Gift Cards pagadas: sólo se venden por la web pública → atribuibles.
// No duplica reglas de Finanzas: son conteos/sumas directas del período.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { DateRange } from "@/lib/metricasWebRange";

export type NegocioReal = {
  atribuible: true;
  reservasWeb: number;
  ingresosReservas: number;
  ticketReservas: number | null;
  giftCards: number;
  ingresosGiftCards: number;
  ticketGiftCards: number | null;
  ingresosTotal: number;
};

// Argentina es UTC-3 (sin DST): límites del día en hora local.
const startIso = (d: string) => `${d}T00:00:00-03:00`;
const endIso = (d: string) => `${d}T23:59:59.999-03:00`;

export async function negocioWeb(range: DateRange): Promise<NegocioReal> {
  const desde = startIso(range.start);
  const hasta = endIso(range.end);

  const { data: reservas } = await supabaseAdmin
    .from("reservas")
    .select("total, origen, estado, created_at")
    .eq("estado", "activa")
    .gte("created_at", desde)
    .lte("created_at", hasta);
  const web = (reservas ?? []).filter((r) => r.origen == null || r.origen === "web");
  const reservasWeb = web.length;
  const ingresosReservas = web.reduce((s, r) => s + (Number(r.total) || 0), 0);

  const { data: gcs } = await supabaseAdmin
    .from("gift_cards")
    .select("monto, estado_pago, fecha_pago")
    .eq("estado_pago", "pagado")
    .gte("fecha_pago", desde)
    .lte("fecha_pago", hasta);
  const giftCards = (gcs ?? []).length;
  const ingresosGiftCards = (gcs ?? []).reduce((s, g) => s + (Number(g.monto) || 0), 0);

  return {
    atribuible: true,
    reservasWeb,
    ingresosReservas,
    ticketReservas: reservasWeb > 0 ? Math.round(ingresosReservas / reservasWeb) : null,
    giftCards,
    ingresosGiftCards,
    ticketGiftCards: giftCards > 0 ? Math.round(ingresosGiftCards / giftCards) : null,
    ingresosTotal: ingresosReservas + ingresosGiftCards,
  };
}
