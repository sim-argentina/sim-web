import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcularMes, getComisionesWebMes } from "@/lib/finanzas";
import { registrarPagoWeb } from "@/lib/mercadopagoPagos";

// Integración contra la DB REAL de los cargos de Checkout Pro.
//
// Solo LECTURA sobre las tablas operativas. La única escritura es un upsert
// repetido en fin_pagos_web sobre un pago YA conciliado, para probar la
// idempotencia: no cambia ningún valor ni agrega filas.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/finanzasComisionesWeb.integration.ts

const money = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

async function contar(tabla: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(tabla).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  // ── Fotografía de las tablas operativas ANTES ─────────────────────────────
  const OPERATIVAS = ["campeonato_inscripciones", "campeonato_checkouts", "reservas", "gift_cards"];
  const antes: Record<string, number> = {};
  for (const t of OPERATIVAS) antes[t] = await contar(t);

  // ── 1) El contrato bruto − cargos = neto cierra en los datos reales ───────
  for (const mes of ["2026-09", "2026-08"]) {
    const w = await getComisionesWebMes(mes);
    console.log(
      `\n${mes}  bruto ${money(w.bruto)} − cargos ${money(w.cargos)} = neto ${money(w.neto)} · ${w.cantidad} pagos · tasa ${(w.tasaEfectiva * 100).toFixed(3)}%`
    );
    for (const [prod, v] of Object.entries(w.porProducto)) {
      console.log(`   ${prod.padEnd(16)} ${v.cantidad} pagos · bruto ${money(v.bruto)} · cargos ${money(v.cargos)} · neto ${money(v.neto)}`);
    }
    for (const s of w.sinDatos) {
      console.log(`   ⚠ ${s.producto} · pago ${s.paymentId} · bruto ${money(s.brutoOperacion)} · ${s.motivo}`);
    }

    assert.ok(Math.abs(w.bruto - w.cargos - w.neto) < 0.01, `${mes}: bruto − cargos = neto`);
    assert.ok(w.cargos >= 0, `${mes}: los cargos nunca son negativos`);
    // Ningún pago con datos puede tener un cargo mayor que su bruto.
    for (const d of w.detalle) {
      if (d.incompleto) continue;
      assert.ok(d.cargos !== null && d.neto !== null, `${mes}: pago ${d.paymentId} completo`);
      assert.ok(d.cargos! <= (d.bruto ?? d.brutoOperacion), `${mes}: pago ${d.paymentId} cargo <= bruto`);
      assert.ok(Math.abs((d.bruto ?? 0) - d.cargos! - d.neto!) < 0.01, `${mes}: pago ${d.paymentId} concilia`);
    }
  }

  // ── 2) Septiembre: los cargos llegan al saldo de Mercado Pago ─────────────
  const { resumen } = await calcularMes("2026-09");
  const mp = resumen.porFuente.find((f) => f.tipo === "mercado_pago")!;
  const w9 = resumen.comisionesWeb!;
  assert.ok(w9.cargos > 0, "septiembre tiene cargos web reales");
  assert.equal(mp.comisionesWeb, w9.cargos, "el cargo web se imputa a Mercado Pago");
  assert.equal(resumen.porFuente.find((f) => f.tipo === "efectivo")!.comisionesWeb, 0, "efectivo no carga comisión web");

  // Métricas comerciales intactas: el bruto no se toca.
  const brutoAuto = resumen.ingresosAutomaticos;
  assert.ok(brutoAuto > 0 && resumen.ingresosBruto >= brutoAuto, "el revenue bruto sigue siendo bruto");

  // La identidad del desglose visual cierra.
  const suma =
    mp.saldoInicial + mp.ingresos + mp.financiamiento + mp.transferenciasEntrantes -
    mp.egresos - mp.comisiones - mp.reembolsos - mp.transferenciasSalientes;
  assert.ok(Math.abs(suma - mp.saldoTeorico) < 0.01, "el desglose del saldo MP cierra");
  console.log(`\nSaldo MP 2026-09  ${money(mp.saldoTeorico)}  (stand ${money(mp.comisionesStand)} + web ${money(mp.comisionesWeb)})`);

  // ── 3) Idempotencia: reprocesar un pago no cambia nada ───────────────────
  const { data: fila } = await supabaseAdmin
    .from("fin_pagos_web")
    .select("*")
    .eq("incompleto", false)
    .limit(1)
    .maybeSingle();
  assert.ok(fila, "hay al menos un pago conciliado para la prueba");

  const filasAntes = await contar("fin_pagos_web");
  const pagoSimulado = {
    status: fila!.mp_status,
    currency_id: fila!.moneda,
    external_reference: fila!.referencia_externa,
    transaction_amount: Number(fila!.bruto),
    fee_details: fila!.fee_details,
    charges_details: fila!.charges_details,
    transaction_details: { net_received_amount: Number(fila!.neto_mp) },
    date_approved: fila!.date_approved,
    money_release_status: fila!.money_release_status,
    payment_method_id: fila!.metodo_pago,
    payment_type_id: fila!.tipo_pago,
  };
  for (let i = 0; i < 3; i++) {
    const r = await registrarPagoWeb(String(fila!.payment_id), fila!.producto, pagoSimulado, "webhook");
    assert.ok(r.ok, "el reprocesamiento no falla");
  }
  const filasDespues = await contar("fin_pagos_web");
  assert.equal(filasDespues, filasAntes, "reprocesar 3 veces NO agrega filas");

  const { data: reLeida } = await supabaseAdmin
    .from("fin_pagos_web").select("bruto, cargos, neto").eq("payment_id", fila!.payment_id).maybeSingle();
  assert.equal(Number(reLeida!.cargos), Number(fila!.cargos), "el cargo no se duplicó ni cambió");
  assert.equal(Number(reLeida!.neto), Number(fila!.neto), "el neto no cambió");

  // ── 4) Nada operativo se movió ───────────────────────────────────────────
  for (const t of OPERATIVAS) {
    const ahora = await contar(t);
    assert.equal(ahora, antes[t], `${t}: la conciliación no crea ni borra filas operativas`);
  }

  console.log("\nOK — finanzasComisionesWeb: cargos reales conciliados, imputados solo a Mercado Pago, idempotentes y sin tocar tablas operativas.");
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
