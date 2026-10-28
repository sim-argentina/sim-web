import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import {
  combinar,
  enRango,
  filtrar,
  paginaDetalle,
  resumir,
  totalesDe,
  type Criterios,
  type Rango,
} from "@/lib/metricasStandDashboard";
import { operacionesEntre } from "@/lib/metricasStandServer";

// Contrato de SOLO LECTURA del dashboard del Stand contra los datos reales:
//   1. la facturación del Turnero coincide al peso con Finanzas (fuente `turnero`
//      de fin_eventos_facturacion) y con la suma directa de turnos_stand;
//   2. un mes de Excel coincide con la suma directa de turnos_historicos;
//   3. cada desglose (duración, grupo, día, serie, medio) suma los totales;
//   4. el contexto del detalle paginado es exactamente la cifra del dashboard.
//
//   npx tsx --env-file=.env.local lib/metricasStandDashboard.contrato.integration.ts

const suma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const rango = (desde: string, hasta: string): Rango => ({ desde, hasta, incompleto: false, corteMinuto: null, minutoAhora: null });

async function main() {
  const hoy = hoyEnSim();
  const mesActual = rango(`${hoy.slice(0, 7)}-01`, hoy);
  const meses = [rango("2026-07-01", "2026-07-31"), rango("2026-09-01", "2026-09-30"), mesActual];

  // 1. Turnero contra Finanzas y contra la suma directa.
  for (const r of meses) {
    const ops = filtrar(enRango(await operacionesEntre(r.desde, r.hasta, { fresco: true }), r), { fuente: "turnero" });
    const res = resumir(ops, r, hoy);
    const { data: fin, error } = await supabaseAdmin.rpc("fin_eventos_facturacion", { p_desde: r.desde, p_hasta: r.hasta });
    if (error) throw error;
    const finTurnero = suma((fin ?? []).filter((e: { fuente: string }) => e.fuente === "turnero"), (e: { monto: number | string }) => Number(e.monto));
    const { data: filas } = await supabaseAdmin.from("turnos_stand").select("total, estado, cantidad_personas").gte("fecha", r.desde).lte("fecha", r.hasta).range(0, 9999);
    const vigentes = (filas ?? []).filter((f) => !["anulado", "cancelado"].includes(String(f.estado ?? "").toLowerCase()));
    const directa = suma(vigentes, (f) => Number(f.total || 0));
    assert.equal(res.totales.facturacion, finTurnero, `${r.desde}: facturación = Finanzas turnero`);
    assert.equal(res.totales.facturacion, directa, `${r.desde}: facturación = Σ total`);
    assert.equal(res.totales.personas, suma(vigentes, (f) => Number(f.cantidad_personas || 1)), `${r.desde}: personas = Σ cantidad_personas`);
    assert.equal(res.totales.operaciones, vigentes.length);
    console.log(`OK — ${r.desde}…${r.hasta}: ${res.totales.operaciones} operaciones, $ ${res.totales.facturacion.toLocaleString("es-AR")} = Finanzas turnero = Σ turnos_stand.total`);
  }

  // 2. Un mes de Excel contra la suma directa.
  const nov = rango("2025-11-01", "2025-11-30");
  const opsNov = enRango(await operacionesEntre(nov.desde, nov.hasta, { fresco: true }), nov);
  const { data: hist } = await supabaseAdmin.from("turnos_historicos").select("total, cantidad_simuladores").gte("fecha", nov.desde).lte("fecha", nov.hasta).range(0, 9999);
  assert.equal(totalesDe(opsNov).facturacion, suma(hist ?? [], (f) => Number(f.total || 0)), "noviembre 2025 = Σ turnos_historicos.total");
  assert.equal(totalesDe(opsNov).personas, suma(hist ?? [], (f) => Number(f.cantidad_simuladores || 1)));
  console.log(`OK — noviembre 2025 (Excel): ${opsNov.length} operaciones, $ ${totalesDe(opsNov).facturacion.toLocaleString("es-AR")}`);

  // 3 y 4. Desgloses y detalle sobre un período con Turnero y Excel juntos.
  const r = rango("2025-10-01", hoy);
  const ops = enRango(await operacionesEntre(r.desde, r.hasta), r);
  const res = resumir(ops, r, hoy);
  const t = res.totales;
  for (const [nombre, valor] of [
    ["duraciones", suma(res.duraciones, (d) => d.facturacion)],
    ["grupos", suma(res.grupos, (g) => g.facturacion)],
    ["días de la semana", suma(res.diasSemana, (d) => d.facturacion)],
    ["serie diaria", suma(res.serie, (d) => d.facturacion)],
    ["medios de pago", suma(res.pagos, (p) => p.monto)],
  ] as const) {
    assert.equal(valor, t.facturacion, `Σ ${nombre} = facturación`);
  }
  assert.equal(suma(res.duraciones, (d) => d.personas), t.personas);
  assert.equal(suma(res.calorVenta, (c) => c.operaciones), res.cobertura.conHoraVenta);

  const selecciones: Array<[string, Criterios, (x: typeof res) => { operaciones: number; facturacion: number; personas: number }]> = [
    ["duración 10 min", { duraciones: ["10"] }, (x) => x.duraciones.find((d) => d.clase === "10")!],
    ["sábados", { dias: [5] }, (x) => x.diasSemana[5]],
    ["grupos de 4 o más", { grupo: 4 }, (x) => x.grupos[3]],
    ["sábado 18 h (venta)", { dias: [5], horas: [18] }, (x) => x.calorVenta.find((c) => c.dia === 5 && c.hora === 18)!],
  ];
  for (const [nombre, sel, cifra] of selecciones) {
    const det = paginaDetalle(filtrar(ops, combinar({}, sel)), "reciente", 1);
    const esperado = cifra(res);
    assert.equal(det.total, esperado.operaciones, `${nombre}: operaciones`);
    assert.equal(det.contexto.facturacion, esperado.facturacion, `${nombre}: facturación`);
    assert.equal(det.contexto.personas, esperado.personas, `${nombre}: personas`);
    console.log(`OK — detalle "${nombre}": ${det.total} operaciones, ${det.contexto.personas} personas, $ ${det.contexto.facturacion.toLocaleString("es-AR")} = cifra del dashboard`);
  }

  // Con un filtro del dashboard, el resumen filtrado y el detalle coinciden.
  const filtro: Criterios = { duraciones: ["20"], tipo: "comerciales" };
  const resF = resumir(filtrar(ops, filtro), r, hoy);
  const detF = paginaDetalle(filtrar(ops, combinar(filtro, { dias: [6] })), "reciente", 1);
  assert.equal(detF.contexto.facturacion, resF.diasSemana[6].facturacion, "filtro 20 min + domingo");
  console.log("OK — filtros del dashboard y selección del detalle combinan igual en las dos vistas");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
