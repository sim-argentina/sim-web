import { strict as assert } from "node:assert";
import {
  extraerFinanzasPago,
  filaPagoWeb,
  sumarCargosCollector,
  sumarChargesDetails,
  type PagoMpFinanzas,
} from "@/lib/mercadopagoPagosCalculo";

// Conciliación de los cargos reales de Mercado Pago Checkout Pro.
//
// El contrato es siempre el mismo:  bruto − cargos = neto
// y un fallo o un dato faltante NUNCA puede leerse como comisión $0, porque eso
// infla el saldo de Mercado Pago sin que nadie se entere.
//
// Ejecutar: npx tsx lib/mercadopagoPagosCalculo.test.ts

const aprobado = (extra: Partial<PagoMpFinanzas> = {}): PagoMpFinanzas => ({
  id: "1",
  status: "approved",
  status_detail: "accredited",
  currency_id: "ARS",
  transaction_amount: 20000,
  ...extra,
});

// ── 1) Caso real: inscripción de $20.000 con la comisión que cobró MP ────────
{
  const p = aprobado({
    fee_details: [{ amount: 1597.34, fee_payer: "collector", type: "mercadopago_fee" }],
    charges_details: [{ name: "mercadopago_fee", type: "fee", amounts: { original: 1597.34, refunded: 0 } }],
    transaction_details: { net_received_amount: 18402.66, total_paid_amount: 20000 },
    date_approved: "2026-09-07T18:37:12.000-04:00",
    money_release_status: "released",
  });
  const f = extraerFinanzasPago(p);
  assert.equal(f.bruto, 20000, "bruto");
  assert.equal(f.cargos, 1597.34, "cargos reales, no una tasa estimada");
  assert.equal(f.neto, 18402.66, "neto acreditado");
  assert.equal(f.incompleto, false);
  assert.equal(f.conciliado, true, "el desglose explica el neto");
  assert.equal(f.diferenciaRedondeo, 0);
  assert.equal(f.bruto! - f.cargos!, f.neto!, "bruto − cargos = neto");
}

// ── 2) Varios fee_details: se suman todos los del collector ─────────────────
{
  const p = aprobado({
    transaction_amount: 10000,
    fee_details: [
      { amount: 600, fee_payer: "collector", type: "mercadopago_fee" },
      { amount: 150, fee_payer: "collector", type: "application_fee" },
      { amount: 250.5, fee_payer: "collector", type: "financing_fee" },
    ],
    transaction_details: { net_received_amount: 8999.5 },
  });
  assert.equal(sumarCargosCollector(p.fee_details), 1000.5, "suma los tres cargos");
  const f = extraerFinanzasPago(p);
  assert.equal(f.cargos, 1000.5);
  assert.equal(f.neto, 8999.5);
  assert.equal(f.conciliado, true);
}

// ── 3) Un cargo que paga el CLIENTE no reduce lo que recibimos ──────────────
{
  const fees = [
    { amount: 600, fee_payer: "collector", type: "mercadopago_fee" },
    { amount: 900, fee_payer: "payer", type: "financing_fee" },
  ];
  assert.equal(sumarCargosCollector(fees), 600, "el fee del payer no se cuenta");
}

// ── 4) Retenciones impositivas: están en charges_details, NO en fee_details ─
// Caso real de agosto: comisión 1597,34 + SIRTAC 300 = 1897,34 descontados.
{
  const p = aprobado({
    fee_details: [{ amount: 1597.34, fee_payer: "collector", type: "mercadopago_fee" }],
    charges_details: [
      { name: "mercadopago_fee", type: "fee", amounts: { original: 1597.34, refunded: 0 } },
      { name: "tax_withholding_sirtac", type: "tax", amounts: { original: 300, refunded: 0 } },
    ],
    transaction_details: { net_received_amount: 18102.66 },
  });
  assert.equal(sumarChargesDetails(p.charges_details), 1897.34, "comisión + retención");
  const f = extraerFinanzasPago(p);
  assert.equal(f.cargos, 1897.34, "el cargo incluye la retención");
  assert.equal(f.neto, 18102.66);
  assert.equal(f.conciliado, true, "charges_details explica el neto aunque fee_details no alcance");
  assert.equal(f.cargosFeeDetails, 1597.34, "se conserva el dato de fee_details para auditar");
}

// ── 5) Un reintegro descuenta del cargo ─────────────────────────────────────
{
  const charges = [
    { name: "mercadopago_fee", type: "fee", amounts: { original: 1000, refunded: 400 } },
  ];
  assert.equal(sumarChargesDetails(charges), 600, "cargo neto de lo reintegrado");
}

// ── 6) Sin fee ni neto: advertencia, NUNCA comisión 0 ───────────────────────
{
  const f = extraerFinanzasPago(aprobado({ fee_details: [], transaction_details: null }));
  assert.equal(f.incompleto, true, "queda marcado como incompleto");
  assert.equal(f.cargos, null, "cargos en null, no en 0");
  assert.equal(f.neto, null, "neto en null, no igual al bruto");
  assert.equal(f.motivoIncompleto, "sin_fee_details_ni_net_received_amount");
  assert.equal(f.bruto, 20000, "el bruto igual se conserva para poder identificarlo");
}

// ── 7) Pago NO aprobado: no acreditó nada ───────────────────────────────────
// MP devuelve net_received_amount = 0 en los rechazados: tomarlo como válido
// inventaría un cargo igual al bruto entero (caso real: pago 178100778403).
{
  const f = extraerFinanzasPago({
    status: "rejected",
    status_detail: "cc_rejected_card_disabled",
    transaction_amount: 20000,
    fee_details: [],
    transaction_details: { net_received_amount: 0 },
  });
  assert.equal(f.incompleto, true, "rechazado → incompleto");
  assert.equal(f.cargos, null, "NO se registra un cargo de $20.000");
  assert.equal(f.neto, null);
  assert.equal(f.motivoIncompleto, "pago_no_aprobado:rejected");
}
{
  const f = extraerFinanzasPago({
    status: "refunded",
    transaction_amount: 12000,
    fee_details: [{ amount: 958.4, fee_payer: "collector", type: "mercadopago_fee" }],
    transaction_details: { net_received_amount: 11041.6 },
  });
  assert.equal(f.incompleto, true, "devuelto → incompleto (el dinero volvió al cliente)");
  assert.equal(f.motivoIncompleto, "pago_no_aprobado:refunded");
}

// ── 8) Sin net_received_amount se reconstruye desde el desglose ─────────────
{
  const f = extraerFinanzasPago(aprobado({
    transaction_amount: 5000,
    fee_details: [{ amount: 400, fee_payer: "collector", type: "mercadopago_fee" }],
  }));
  assert.equal(f.cargos, 400);
  assert.equal(f.neto, 4600, "bruto − cargos");
  assert.equal(f.incompleto, false);
}

// ── 9) Desglose que NO explica el neto: queda marcado como no conciliado ────
{
  const f = extraerFinanzasPago(aprobado({
    fee_details: [{ amount: 1000, fee_payer: "collector", type: "mercadopago_fee" }],
    transaction_details: { net_received_amount: 17000 },
  }));
  assert.equal(f.cargos, 3000, "manda net_received_amount");
  assert.equal(f.neto, 17000);
  assert.equal(f.conciliado, false, "hay $2.000 que el desglose no explica");
  assert.equal(f.diferenciaRedondeo, 2000);
}

// ── 10) Tolerancia de redondeo de un centavo ────────────────────────────────
{
  const f = extraerFinanzasPago(aprobado({
    fee_details: [{ amount: 1597.34, fee_payer: "collector", type: "mercadopago_fee" }],
    transaction_details: { net_received_amount: 18402.65 },
  }));
  assert.equal(f.conciliado, true, "un centavo de diferencia sigue conciliado");
}

// ── 11) filaPagoWeb es determinística → idempotencia ────────────────────────
// Reprocesar el mismo webhook, reconciliar y correr el backfill tienen que
// producir exactamente la misma fila: el upsert por payment_id no duplica nada
// ni suma el cargo dos veces.
{
  const p = aprobado({
    external_reference: "campeonato_inscripcion_abc",
    fee_details: [{ amount: 1597.34, fee_payer: "collector", type: "mercadopago_fee" }],
    transaction_details: { net_received_amount: 18402.66 },
  });
  const a = filaPagoWeb("177820285196", "campeonatos", p, "webhook");
  const b = filaPagoWeb("177820285196", "campeonatos", p, "webhook");
  assert.deepEqual(a, b, "dos pasadas idénticas");

  const c = filaPagoWeb("177820285196", "campeonatos", p, "backfill");
  assert.equal(c.payment_id, a.payment_id, "misma clave primaria → upsert, no inserción nueva");
  assert.equal(c.cargos, a.cargos, "el cargo no cambia según quién lo registre");
  assert.equal(c.neto, a.neto);
  assert.equal(c.origen, "backfill", "solo cambia de dónde vino el dato");
}

// ── 12) Importes como string (MP a veces los serializa así) ─────────────────
{
  const f = extraerFinanzasPago(aprobado({
    transaction_amount: "20000",
    fee_details: [{ amount: "1597.34", fee_payer: "collector", type: "mercadopago_fee" }],
    transaction_details: { net_received_amount: "18402.66" },
  }));
  assert.equal(f.cargos, 1597.34);
  assert.equal(f.neto, 18402.66);
}

console.log("OK — mercadopagoPagosCalculo: bruto − cargos = neto, múltiples fee_details, retenciones, rechazados/devueltos, datos faltantes sin asumir $0, e idempotencia.");
