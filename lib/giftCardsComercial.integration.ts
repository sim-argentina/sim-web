import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS, modalidadVigente } from "@/lib/modalidadComercial";
import { catalogoGiftCardsVigente } from "@/lib/giftCardsComercial";
import {
  METODOS_SIN_COMISION, calcularComisionesPagos, claveComision, porcentajeTotalComision, type ComisionConfig,
} from "@/lib/finanzasComisiones";

// Integración de Gift Cards (Bloque B5) contra la base REAL.
// SOLO LECTURA: no inserta, no actualiza y no borra nada (se vigila abajo).
// Ejecutar: npx tsx --env-file=.env.local lib/giftCardsComercial.integration.ts
//
// 1. Antes del corte el catálogo real es legacy; con el reloj inyectado del
//    corte, v2 (override NULL: sin forzar nada en producción).
// 2. Medios del panel con la configuración REAL de fin_comisiones_cobro y el
//    MISMO cálculo que Finanzas (calcularComisionesPagos): efectivo y
//    transferencia sin comisión; QR, débito y crédito con la tasa configurada.
// 3. Las Gift Cards reales siguen siendo legacy (15/30) y nada las recalcula.

const cliente = supabaseAdmin as unknown as Record<string, unknown>;
const fromOrig = cliente.from as (t: string) => Record<string, unknown>;
cliente.from = (t: string) => {
  const q = fromOrig.call(supabaseAdmin, t);
  for (const escritura of ["insert", "update", "upsert", "delete"]) {
    q[escritura] = () => { throw new Error(`solo lectura: ${escritura} sobre ${t}`); };
  }
  return q;
};
cliente.rpc = () => { throw new Error("solo lectura: rpc"); };

async function main() {
  // ── 1. Catálogo real antes y (simulado) después del corte ─────────────────
  const vigente = await modalidadVigente(new Date());
  assert.equal(vigente.override, null, "override de producción en NULL");
  const hoy = await catalogoGiftCardsVigente(new Date());
  if (Date.now() < CORTE_MODALIDAD_V2_MS) {
    assert.equal(hoy.modalidad, "legacy", "antes del corte: legacy");
    assert.deepEqual(hoy.productos.map((p) => [p.duracion, p.monto]), [[15, 12000], [30, 20000]]);
  }
  const corte = await catalogoGiftCardsVigente(new Date(CORTE_MODALIDAD_V2_MS));
  assert.equal(corte.modalidad, "v2_10");
  assert.deepEqual(corte.productos.map((p) => [p.duracion, p.monto]), [[10, 10000], [20, 17000], [30, 23000]]);

  // ── 2. Medios del panel con la configuración real ─────────────────────────
  const { data: cfg, error } = await supabaseAdmin.from("fin_comisiones_cobro").select("*").eq("activa", true);
  assert.ifError(error);
  const configByKey: Record<string, ComisionConfig> = {};
  for (const c of cfg ?? []) {
    configByKey[claveComision(c.procesador, c.metodo_pago)] = {
      procesador: c.procesador, metodo_pago: c.metodo_pago,
      porcentaje_base: Number(c.porcentaje_base) || 0,
      aplica_iva: Boolean(c.aplica_iva), iva_porcentaje: Number(c.iva_porcentaje) || 0,
      activa: Boolean(c.activa),
    };
  }
  const casos: Array<[string, string | null, number]> = [
    ["efectivo", null, 10000], ["transferencia", null, 17000],
    ["qr", "mercado_pago", 23000], ["debito", "payway", 10000], ["credito", "mercado_pago", 17000],
  ];
  for (const [medio, procesador, monto] of casos) {
    const r = calcularComisionesPagos([{ metodo_pago: medio, monto, posnet_pago: procesador }], configByKey);
    const cfgCaso = procesador ? configByKey[claveComision(procesador, medio)] : undefined;
    if ((METODOS_SIN_COMISION as readonly string[]).includes(medio)) {
      assert.equal(r.comision, 0, `${medio} ${monto}: sin comisión`);
    } else if (cfgCaso) {
      const esperada = Math.round(((monto * porcentajeTotalComision(cfgCaso)) / 100 + Number.EPSILON) * 100) / 100;
      assert.ok(Math.abs(r.comision - esperada) < 0.02, `${medio}/${procesador} ${monto}: ${r.comision} vs ${esperada}`);
    }
    assert.equal(r.bruto, monto, "el bruto es el monto guardado");
    console.log(`${medio.padEnd(13)} ${String(procesador ?? "-").padEnd(12)} bruto ${monto} · comisión ${r.comision} · neto ${r.neto}${!cfgCaso && procesador ? " (sin tasa configurada)" : ""}`);
  }

  // ── 3. Las Gift Cards reales: legacy y guardadas tal cual ─────────────────
  const { data: reales, error: e2 } = await supabaseAdmin.from("gift_cards").select("duracion_minutos, monto, estado_pago, canal");
  assert.ifError(e2);
  for (const g of reales ?? []) {
    assert.ok([15, 30].includes(Number(g.duracion_minutos)), `real legacy: ${g.duracion_minutos}`);
    assert.equal(Number(g.monto), Number(g.duracion_minutos) === 15 ? 12000 : 20000, "monto legacy guardado");
  }
  console.log(`OK — B5 contra la base real (solo lectura): catálogo legacy hoy / v2 en el corte, ${casos.length} medios con la tasa real, ${reales?.length ?? 0} Gift Cards reales legacy intactas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
