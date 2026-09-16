import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  filaPagoWeb,
  registrarPagoWeb,
  type PagoMpFinanzas,
  type ProductoWeb,
} from "@/lib/mercadopagoPagos";

// Backfill de los cargos reales de Checkout Pro sobre los cobros web YA existentes.
//
// Qué hace:  por cada payment_id ya guardado en campeonatos / reservas / gift
//            cards, consulta el pago a Mercado Pago y guarda bruto/cargos/neto
//            en fin_pagos_web.
// Qué NO hace: no toca reservas, gift_cards, campeonato_inscripciones ni
//            campeonato_checkouts; no crea inscripciones; no consume cupos; no
//            reejecuta ningún efecto comercial del webhook. Solo escribe en
//            fin_pagos_web, que es una tabla contable satélite.
//
// Es idempotente: upsert por payment_id. Correrlo dos veces deja el mismo estado.
//
// Ejecutar (simulación, NO escribe):
//   npx tsx --env-file=.env.local lib/finanzasPagosWebBackfill.ts
// Ejecutar (aplica):
//   npx tsx --env-file=.env.local lib/finanzasPagosWebBackfill.ts --aplicar

export type PagoPendiente = { producto: ProductoWeb; paymentId: string; referencia: string; brutoOperacion: number };

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

// Todos los cobros web con payment_id, de las MISMAS fuentes que lee Finanzas.
export async function listarPagosWeb(): Promise<PagoPendiente[]> {
  const out: PagoPendiente[] = [];

  const { data: camp, error: e1 } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id, payment_id, monto")
    .eq("estado_pago", "pagado")
    .is("eliminada_at", null)
    .not("payment_id", "is", null);
  if (e1) throw e1;
  for (const r of camp || []) {
    out.push({ producto: "campeonatos", paymentId: String(r.payment_id), referencia: String(r.id), brutoOperacion: Number(r.monto) || 0 });
  }

  const { data: res, error: e2 } = await supabaseAdmin
    .from("reservas")
    .select("id, mercado_pago_payment_id, total, estado, origen")
    .in("estado", ["activa", "reembolsada"])
    .not("mercado_pago_payment_id", "is", null);
  if (e2) throw e2;
  for (const r of res || []) {
    if (r.origen === "empresa" || r.origen === "mensualidad") continue;
    out.push({ producto: "reservas_online", paymentId: String(r.mercado_pago_payment_id), referencia: String(r.id), brutoOperacion: Number(r.total) || 0 });
  }

  const { data: gc, error: e3 } = await supabaseAdmin
    .from("gift_cards")
    .select("id, mercado_pago_payment_id, monto")
    .eq("estado_pago", "pagado")
    .not("fecha_pago", "is", null)
    .not("mercado_pago_payment_id", "is", null);
  if (e3) throw e3;
  for (const r of gc || []) {
    out.push({ producto: "gift_cards", paymentId: String(r.mercado_pago_payment_id), referencia: String(r.id), brutoOperacion: Number(r.monto) || 0 });
  }

  // Un payment_id se procesa UNA sola vez aunque cubra varias filas operativas
  // (p. ej. una compra de varias gift cards).
  const vistos = new Set<string>();
  return out.filter((p) => (vistos.has(p.paymentId) ? false : (vistos.add(p.paymentId), true)));
}

function clienteMp(): MercadoPagoConfig {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error("Falta MERCADOPAGO_ACCESS_TOKEN");
  return new MercadoPagoConfig({ accessToken });
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const pagos = await listarPagosWeb();

  const { data: yaGuardados, error } = await supabaseAdmin.from("fin_pagos_web").select("payment_id, cargos, neto");
  if (error) throw error;
  const previos = new Map((yaGuardados || []).map((r) => [String(r.payment_id), r]));

  console.log(`\n${aplicar ? "APLICANDO" : "SIMULACIÓN (no escribe nada — usar --aplicar para guardar)"}`);
  console.log(`Cobros web con payment_id: ${pagos.length} · ya conciliados: ${previos.size}\n`);

  const client = clienteMp();
  const api = new Payment(client);
  const filas: Array<{ p: PagoPendiente; bruto: number | null; cargos: number | null; neto: number | null; estado: string }> = [];
  let errores = 0;

  for (const p of pagos) {
    let pago: PagoMpFinanzas;
    try {
      pago = (await api.get({ id: p.paymentId })) as PagoMpFinanzas;
    } catch (e) {
      errores++;
      filas.push({ p, bruto: null, cargos: null, neto: null, estado: `ERROR MP: ${e instanceof Error ? e.message : e}` });
      continue;
    }

    const fila = filaPagoWeb(p.paymentId, p.producto, pago, "backfill");
    const antes = previos.get(p.paymentId);
    const estado = !antes
      ? "NUEVO"
      : Number(antes.cargos) === Number(fila.cargos) && Number(antes.neto) === Number(fila.neto)
      ? "sin cambios"
      : "ACTUALIZA";

    filas.push({ p, bruto: fila.bruto, cargos: fila.cargos, neto: fila.neto, estado });

    if (aplicar) {
      const r = await registrarPagoWeb(p.paymentId, p.producto, pago, "backfill");
      if (!r.ok) {
        errores++;
        filas[filas.length - 1].estado = `ERROR GUARDANDO: ${r.motivo}`;
      }
    }
  }

  // ── Detalle ────────────────────────────────────────────────────────────────
  console.log(
    "producto".padEnd(16) + "payment_id".padEnd(14) + "bruto".padStart(14) + "cargos".padStart(14) + "neto".padStart(14) + "  estado"
  );
  for (const f of filas) {
    console.log(
      f.p.producto.padEnd(16) +
        f.p.paymentId.padEnd(14) +
        money(f.bruto).padStart(14) +
        money(f.cargos).padStart(14) +
        money(f.neto).padStart(14) +
        "  " + f.estado
    );
  }

  // ── Totales por producto ───────────────────────────────────────────────────
  const porProd: Record<string, { n: number; bruto: number; cargos: number; neto: number; sinDatos: number }> = {};
  for (const f of filas) {
    const a = (porProd[f.p.producto] = porProd[f.p.producto] || { n: 0, bruto: 0, cargos: 0, neto: 0, sinDatos: 0 });
    a.n++;
    if (f.cargos === null || f.neto === null) { a.sinDatos++; continue; }
    a.bruto += f.bruto ?? 0;
    a.cargos += f.cargos;
    a.neto += f.neto;
  }
  console.log("\n── Totales ──");
  for (const [prod, a] of Object.entries(porProd)) {
    console.log(
      `${prod.padEnd(16)} ${a.n} pagos · bruto ${money(a.bruto)} · cargos ${money(a.cargos)} · neto ${money(a.neto)}` +
        (a.sinDatos > 0 ? ` · ${a.sinDatos} sin datos` : "")
    );
  }
  if (errores > 0) console.log(`\n⚠ ${errores} pago(s) con error: quedan sin conciliar y se muestran como advertencia en Finanzas.`);
  if (!aplicar) console.log("\nNada fue escrito. Volver a correr con --aplicar para guardar.");
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
