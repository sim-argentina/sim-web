// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS, modalidadEfectiva, modalidadProgramada, modalidadVigente } from "@/lib/modalidadComercial";
import { catalogoGiftCardsPara, catalogoGiftCardsVigente } from "@/lib/giftCardsComercial";
import {
  METODOS_SIN_COMISION, calcularComisionesPagos, claveComision, porcentajeTotalComision, type ComisionConfig,
} from "@/lib/finanzasComisiones";

// Integración de Gift Cards (Bloque B5) contra la base AISLADA de pruebas, con
// datos CONTROLADOS. Antes leía Producción (tasas configuradas y Gift Cards
// reales) y fallaba cuando cambiaban los datos reales —p. ej. al venderse la
// primera Gift Card a precio v2—, sin que nada estuviera roto. Ahora:
//   1. Catálogo: antes y después del corte (reloj inyectado), igual a la
//      modalidad efectiva que resuelve la base local, y los precios del código.
//   2. Medios del panel: tasas CONTROLADAS con el MISMO cálculo que Finanzas
//      (calcularComisionesPagos), con resultados exactos.
//   3. Gift Cards sintéticas legacy y v2 en la base local: se guardan tal cual y
//      nada las recalcula. Se borran al final.
// No toca precios reales ni el override de la modalidad.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/giftCardsComercial.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const RUN = Date.now().toString(36);
const MARCA = `zzgcc_${RUN}`;

{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
  { input: q, encoding: "utf8" }).trim();

async function main() {
  // ── 1. Catálogo antes y después del corte ─────────────────────────────────
  assert.deepEqual(catalogoGiftCardsPara("legacy", new Date()).productos.map((p) => [p.duracion, p.monto]), [[15, 12000], [30, 20000]]);
  assert.deepEqual(catalogoGiftCardsPara("v2_10", new Date()).productos.map((p) => [p.duracion, p.monto]), [[10, 10000], [20, 17000], [30, 23000]]);
  for (const t of [CORTE_MODALIDAD_V2_MS - 86_400_000, CORTE_MODALIDAD_V2_MS, CORTE_MODALIDAD_V2_MS + 86_400_000]) {
    const ahora = new Date(t);
    const v = await modalidadVigente(ahora);
    assert.equal(v.modalidad, modalidadEfectiva(modalidadProgramada(ahora), v.override), "la vigente es la programada salvo override");
    const cat = await catalogoGiftCardsVigente(ahora);
    assert.equal(cat.modalidad, v.modalidad);
    assert.deepEqual(cat.productos, catalogoGiftCardsPara(v.modalidad, ahora).productos, "el catálogo es el de la modalidad vigente");
  }

  // ── 2. Medios del panel con tasas controladas ─────────────────────────────
  const tasa = (procesador: string, metodo_pago: string, porcentaje_base: number): ComisionConfig =>
    ({ procesador, metodo_pago, porcentaje_base, aplica_iva: true, iva_porcentaje: 21, activa: true });
  const config: Record<string, ComisionConfig> = {
    [claveComision("mercado_pago", "qr")]: tasa("mercado_pago", "qr", 0.8),
    [claveComision("payway", "debito")]: tasa("payway", "debito", 1),
    [claveComision("mercado_pago", "credito")]: tasa("mercado_pago", "credito", 6.29),
  };
  const casos: Array<[string, string | null, number, number]> = [
    ["efectivo", null, 10000, 0], ["transferencia", null, 17000, 0],
    ["qr", "mp", 23000, 222.64], ["debito", "payway", 10000, 121], ["credito", "mp", 17000, 1293.85],
  ];
  for (const [medio, posnet, monto, esperada] of casos) {
    const r = calcularComisionesPagos([{ metodo_pago: medio, monto, posnet_pago: posnet }], config);
    if ((METODOS_SIN_COMISION as readonly string[]).includes(medio)) assert.equal(r.comision, 0, `${medio}: sin comisión`);
    assert.equal(r.comision, esperada, `${medio} ${monto}: comisión`);
    assert.equal(r.bruto, monto, "el bruto es el monto guardado");
    assert.equal(Math.round((r.neto + r.comision) * 100) / 100, monto, "neto + comisión = bruto");
  }
  assert.equal(porcentajeTotalComision(config[claveComision("payway", "debito")]), 1.21, "1 % + IVA 21 %");

  // ── 3. Gift Cards sintéticas: se guardan tal cual y nada las recalcula ─────
  const filas = [
    { duracion_minutos: 15, monto: 12000 }, { duracion_minutos: 30, monto: 20000 }, { duracion_minutos: 30, monto: 23000 },
  ].map((f, i) => ({
    ...f, codigo_unico: `ZZGCC-${RUN}-${i}`, comprador_nombre: MARCA, comprador_telefono: "3519990301",
    estado_pago: "pagado", canal: "web",
  }));
  const { error: ins } = await supabaseAdmin.from("gift_cards").insert(filas);
  assert.ifError(ins);
  await catalogoGiftCardsVigente(new Date());
  await catalogoGiftCardsVigente(new Date(CORTE_MODALIDAD_V2_MS + 86_400_000));
  const { data: leidas, error: e2 } = await supabaseAdmin.from("gift_cards")
    .select("codigo_unico, duracion_minutos, monto").eq("comprador_nombre", MARCA).order("codigo_unico");
  assert.ifError(e2);
  assert.deepEqual((leidas ?? []).map((g) => [Number(g.duracion_minutos), Number(g.monto)]), [[15, 12000], [30, 20000], [30, 23000]],
    "legacy y v2 quedan con el monto con el que se vendieron");
  console.log(`OK — B5 en la base aislada: catálogo por modalidad (antes/en/después del corte), ${casos.length} medios con tasas controladas, 3 Gift Cards sintéticas intactas.`);
}

function limpiar() {
  sql(`begin; set local session_replication_role = replica;
       delete from public.gift_card_logs where gift_card_id in (select id from public.gift_cards where comprador_nombre = '${MARCA}');
       delete from public.gift_cards where comprador_nombre = '${MARCA}';
       commit;`);
}

main()
  .then(() => { limpiar(); })
  .catch((e) => {
    console.error(e);
    try { limpiar(); } catch (err) { console.error("Limpieza falló:", err); }
    process.exit(1);
  });
