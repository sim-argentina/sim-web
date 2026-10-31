import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import {
  DEFINICIONES, DIMENSIONES, SIN_FILTROS, detalle, fechaSim, filasJornadas, periodoDe, preparar, tablero,
  type DatosCrm, type Filtros, type IdMetrica, type Periodo, type Tablero, type Valor,
} from "@/lib/crmB4";

// Ejecutar: npx tsx lib/crmB4.test.ts
// CRM B4, puro (sin base), con la REFERENCIA TEMPORAL FIJA (hoy = 10/12/2026 en SIM),
// para que no se rompa cuando avance el calendario. Un escenario controlado y las
// cifras esperadas a mano; después, el contrato de conciliación sobre todas las
// métricas y varios filtros:
//   · cada cifra = su detalle (conteo o suma de la misma columna);
//   · los desgloses excluyentes suman el total; los superpuestos se marcan;
//   · ninguna venta en dos jornadas; ninguna tasa mezcla poblaciones;
//   · centavos exactos; medianoche y cierre de mes en Argentina.

const AHORA = new Date("2026-12-10T15:00:00Z"); // 12:00 en Córdoba
const P = (desde: string, hasta: string): Periodo => periodoDe("personalizado", "2026-12-10", { desde, hasta });
const OCT = P("2026-10-01", "2026-10-31");
const NOV = P("2026-11-01", "2026-11-30");
const DIC = P("2026-12-01", "2026-12-10");
const TODO = P("2026-01-01", "2026-12-10");

const G = (c: number | null, e: number | null, p: number | null, o: number | null) => [c, e, p, o] as [number | null, number | null, number | null, number | null];
function escenario(): DatosCrm {
  const emp = (id: string, nombre: string, rubro_id: string, zona_id: string, archivada = false) =>
    ({ id, nombre, rubro_id, rubro: rubro_id === "rG" ? "Gimnasio" : "Comercio", zona_id, zona: zona_id === "zN" ? "Norte" : "Sur", cliente_previo: false, archivada });
  const vis = (id: string, empresa_id: string, jornada_id: string, oportunidad_id: string | null, usuario_id: string, fecha: string, ocurrida_en: string,
    x: Partial<{ responsable: boolean; decisor: boolean; contacto_util: boolean; interes: string | null; necesidades: string[]; pack: string | null; anulada: boolean }> = {}) =>
    ({ id, empresa_id, jornada_id, oportunidad_id, usuario_id, fecha, ocurrida_en, responsable: false, decisor: false, contacto_util: false, interes: null, necesidades: [], pack: null, anulada: false, ...x });
  const opp = (id: string, empresa_id: string, origen_tipo: "visita" | "recompra_admin", origen_visita_id: string | null, origen_usuario_id: string | null, lead_en: string, estado: string,
    x: Partial<{ cierre_motivo: string | null; interesado_en: string | null; negociacion_en: string | null; perdida_en: string | null; perdida_motivo: string | null }> = {}) =>
    ({ id, empresa_id, origen_tipo, origen_visita_id, origen_usuario_id, lead_en, estado, cierre_motivo: estado === "ganada" ? "ganada" : estado === "perdida" ? "perdida" : null,
      interesado_en: null, negociacion_en: null, perdida_en: null, perdida_motivo: null, ...x });
  const venta = (id: string, oportunidad_id: string, empresa_id: string, fecha_acuerdo: string, producto_codigo: string, importe: number,
    x: Partial<{ es_recompra: boolean; comision_tipo: "pactada" | "no_corresponde"; comision_importe: number | null; beneficiario_id: string | null; fundamento: string; intervencion_visita_id: string | null; anulada: boolean }> = {}) =>
    ({ id, oportunidad_id, empresa_id, es_recompra: false, fecha_acuerdo, producto_codigo, producto_nombre: producto_codigo === "pack_25" ? "Pack 25" : "Pack 10",
      experiencias: producto_codigo === "pack_25" ? 25 : 10, importe, comision_tipo: "pactada" as const, comision_importe: importe === 36_000_000 ? 9_000_000 : 4_000_000,
      beneficiario_id: "tob", fundamento: "origen_comercial", intervencion_visita_id: null, anulada: false, ...x });
  return {
    usuarios: [{ id: "tob", nombre: "Tobías" }, { id: "bru", nombre: "Bruno" }],
    zonas: [{ id: "zN", nombre: "Norte" }, { id: "zS", nombre: "Sur" }], rubros: [{ id: "rG", nombre: "Gimnasio" }, { id: "rC", nombre: "Comercio" }],
    empresas: [
      emp("E1", "Gym Uno", "rG", "zN"), emp("E2", "Kiosco Dos", "rC", "zS"), emp("E3", "Óptica Tres", "rG", "zN", true), emp("E4", "Barbería Cuatro", "rC", "zS"),
      emp("E5", "Café Cinco", "rC", "zN"), emp("E6", "Cliente Seis", "rG", "zS"), emp("E7", "Medianoche Siete", "rC", "zN"), emp("E8", "Importado Ocho", "rG", "zN"),
    ],
    jornadas: [
      { id: "J1", usuario_id: "tob", fecha: "2026-10-10", zona_id: "zN", zona: "Norte", cerrada: true, km: 40, gastos: G(10_000, 0, 0, 0) },
      { id: "J2", usuario_id: "tob", fecha: "2026-10-11", zona_id: "zN", zona: "Norte", cerrada: true, km: null, gastos: G(null, null, null, null) },
      { id: "J3", usuario_id: "bru", fecha: "2026-10-20", zona_id: "zS", zona: "Sur", cerrada: true, km: 25, gastos: G(5_000, 1_000, 0, 0) },
      { id: "J4", usuario_id: "tob", fecha: "2026-10-31", zona_id: "zN", zona: "Norte", cerrada: true, km: 10, gastos: G(2_000, null, 0, 0) },
      { id: "J5", usuario_id: "bru", fecha: "2026-12-01", zona_id: "zS", zona: "Sur", cerrada: false, km: null, gastos: G(3_000, 0, 0, 0) },
    ],
    visitas: [
      vis("v1", "E1", "J1", "o1", "tob", "2026-10-10", "2026-10-10T14:00:00Z", { responsable: true, decisor: true, contacto_util: true, necesidades: ["fidelizacion", "sorteos"], pack: "10" }),
      vis("v2", "E1", "J1", "o1", "tob", "2026-10-10", "2026-10-10T15:00:00Z", { interes: "tibio", necesidades: ["regalos"] }),
      // Teléfono del dueño a través de un empleado: contacto útil, pero NO habló con el decisor.
      vis("v3", "E2", "J1", "o2", "tob", "2026-10-10", "2026-10-10T16:00:00Z", { contacto_util: true }),
      vis("v4", "E3", "J3", "o3", "bru", "2026-10-20", "2026-10-20T13:00:00Z", { responsable: true, decisor: true, contacto_util: true, necesidades: ["premio_compra"] }),
      vis("v5", "E4", "J3", "o4", "bru", "2026-10-20", "2026-10-20T14:00:00Z", { responsable: true, contacto_util: true, interes: "frio" }),
      vis("v6", "E5", "J3", "o5", "bru", "2026-10-20", "2026-10-20T15:00:00Z", { responsable: true, decisor: true, contacto_util: true, interes: "caliente", necesidades: ["sorteos"] }),
      vis("v7", "E5", "J3", null, "bru", "2026-10-20", "2026-10-20T16:00:00Z", { anulada: true, responsable: true }),
      // 23:30 del 31/10 en Córdoba = 02:30 UTC del 01/11: es octubre.
      vis("v8", "E7", "J4", "o7", "tob", "2026-10-31", "2026-11-01T02:30:00Z", { responsable: true, decisor: true, contacto_util: true, interes: "tibio" }),
      // 00:15 del 01/11: noviembre, aunque sea de la jornada del 31/10.
      vis("v9", "E7", "J4", "o7", "tob", "2026-11-01", "2026-11-01T03:15:00Z", { responsable: true }),
      vis("v10", "E6", "J1", "o6", "tob", "2026-10-10", "2026-10-10T17:00:00Z", { responsable: true, decisor: true, contacto_util: true, interes: "caliente" }),
      vis("v11", "E6", "J5", "o6c", "bru", "2026-12-01", "2026-12-01T14:00:00Z", { responsable: true, decisor: true, contacto_util: true }),
      vis("v12", "E2", "J1", "o9", "tob", "2026-10-10", "2026-10-10T18:00:00Z", { anulada: true, contacto_util: true }),
    ],
    oportunidades: [
      opp("o1", "E1", "visita", "v1", "tob", "2026-10-10T14:00:00Z", "ganada", { negociacion_en: "2026-11-01T12:00:00Z" }),
      opp("o2", "E2", "visita", "v3", "tob", "2026-10-10T16:00:00Z", "contacto"),
      // Saltó a negociación y se vendió sin pasar por «interesado» ni declarar interés.
      opp("o3", "E3", "visita", "v4", "bru", "2026-10-20T13:00:00Z", "ganada", { negociacion_en: "2026-10-25T12:00:00Z" }),
      // Perdida dos veces (ciclo 1 archivado y la vigente).
      opp("o4", "E4", "visita", "v5", "bru", "2026-10-20T14:00:00Z", "perdida", { perdida_en: "2026-11-20T15:00:00Z", perdida_motivo: "sin_presupuesto" }),
      // Perdida, reabierta y vendida: sigue siendo un solo lead.
      opp("o5", "E5", "visita", "v6", "bru", "2026-10-20T15:00:00Z", "ganada"),
      opp("o6", "E6", "visita", "v10", "tob", "2026-10-10T17:00:00Z", "ganada"),
      opp("o6b", "E6", "recompra_admin", null, null, "2026-11-15T13:00:00Z", "ganada"),
      opp("o6c", "E6", "visita", "v11", "bru", "2026-12-01T14:00:00Z", "ganada"),
      opp("o7", "E7", "visita", "v8", "tob", "2026-11-01T02:30:00Z", "interesado", { interesado_en: "2026-11-03T12:00:00Z" }),
      opp("o9", "E2", "visita", "v12", "tob", "2026-10-10T18:00:00Z", "contacto", { cierre_motivo: "origen_anulado" }),
    ],
    ciclos: [
      { oportunidad_id: "o4", ciclo: 1, interesado_en: "2026-10-22T12:00:00Z", negociacion_en: null, perdida_en: "2026-10-25T15:00:00Z", perdida_motivo: "precio" },
      { oportunidad_id: "o5", ciclo: 1, interesado_en: null, negociacion_en: null, perdida_en: "2026-10-26T12:00:00Z", perdida_motivo: "precio" },
    ],
    ventas: [
      venta("V1", "o1", "E1", "2026-11-05", "pack_10", 15_000_000),
      venta("V3", "o3", "E3", "2026-10-28", "pack_25", 36_000_000, { beneficiario_id: "bru" }),
      venta("V5a", "o5", "E5", "2026-11-02", "pack_10", 15_000_000, { beneficiario_id: "bru", anulada: true }),
      venta("V5b", "o5", "E5", "2026-11-10", "pack_10", 15_000_000, { beneficiario_id: "bru" }),
      venta("V6a", "o6", "E6", "2026-10-15", "pack_10", 15_000_000),
      venta("V6b", "o6b", "E6", "2026-11-20", "pack_10", 15_000_000, { es_recompra: true, comision_tipo: "no_corresponde", comision_importe: null, beneficiario_id: null, fundamento: "recompra_espontanea" }),
      venta("V6c", "o6c", "E6", "2026-12-05", "pack_10", 15_000_000, { es_recompra: true, beneficiario_id: "bru", fundamento: "recompra_trabajada", intervencion_visita_id: "v11" }),
    ],
    cobros: [
      { id: "c1", venta_id: "V1", fecha: "2026-11-05", importe: 7_500_000, concepto: "anticipo", registrado_en: "2026-11-05T15:00:00Z", anulado: false },
      { id: "c2", venta_id: "V1", fecha: "2026-12-02", importe: 7_500_000, concepto: "saldo", registrado_en: "2026-12-02T15:00:00Z", anulado: false },
      { id: "c3", venta_id: "V3", fecha: "2026-10-28", importe: 36_000_000, concepto: "otro", registrado_en: "2026-10-28T15:00:00Z", anulado: false },
      { id: "c4", venta_id: "V5b", fecha: "2026-11-10", importe: 5_000_000, concepto: "anticipo", registrado_en: "2026-11-10T15:00:00Z", anulado: false },
      { id: "c5", venta_id: "V5b", fecha: "2026-11-12", importe: 5_000_000, concepto: "saldo", registrado_en: "2026-11-12T15:00:00Z", anulado: true },
      { id: "c6", venta_id: "V6a", fecha: "2026-10-15", importe: 15_000_000, concepto: "otro", registrado_en: "2026-10-15T15:00:00Z", anulado: false },
      { id: "c7", venta_id: "V6b", fecha: "2026-11-20", importe: 15_000_000, concepto: "otro", registrado_en: "2026-11-20T15:00:00Z", anulado: false },
      { id: "c8", venta_id: "V6c", fecha: "2026-12-05", importe: 7_500_050, concepto: "anticipo", registrado_en: "2026-12-05T15:00:00Z", anulado: false },
    ],
    pagos: [
      { id: "p1", venta_id: "V1", fecha: "2026-12-08", importe: 4_000_000, beneficiario_id: "tob", registrado_en: "2026-12-08T15:00:00Z", anulado: false },
      { id: "p2", venta_id: "V3", fecha: "2026-10-30", importe: 5_000_000, beneficiario_id: "bru", registrado_en: "2026-10-30T15:00:00Z", anulado: false },
      { id: "p3", venta_id: "V3", fecha: "2026-11-03", importe: 4_000_000, beneficiario_id: "bru", registrado_en: "2026-11-03T15:00:00Z", anulado: false },
      { id: "p4", venta_id: "V6a", fecha: "2026-11-01", importe: 4_000_000, beneficiario_id: "tob", registrado_en: "2026-11-01T15:00:00Z", anulado: true },
      { id: "p5", venta_id: "V6a", fecha: "2026-11-02", importe: 4_000_000, beneficiario_id: "tob", registrado_en: "2026-11-02T15:00:00Z", anulado: false },
    ],
  };
}

const n = (v: Valor) => { assert.equal(v.tipo, "conteo"); return (v as { n: number }).n; };
const c = (v: Valor) => { assert.equal(v.tipo, "dinero"); return (v as { c: number }).c; };
const r = (v: Valor) => { assert.equal(v.tipo, "razon"); const x = v as { num: number; den: number; v: number | null }; return [x.num, x.den, x.v] as const; };

async function main() {
  const ctx = preparar(escenario(), AHORA);
  const t = (p: Periodo, f: Filtros = SIN_FILTROS) => tablero(ctx, p, f, AHORA);

  // ── Fechas de SIM, medianoche y cierre de mes ─────────────────────────
  {
    assert.equal(ctx.hoy, "2026-12-10");
    assert.equal(fechaSim("2026-11-01T02:30:00Z"), "2026-10-31", "23:30 del 31/10 en Córdoba es octubre");
    assert.equal(fechaSim("2026-11-01T02:59:59Z"), "2026-10-31");
    assert.equal(fechaSim("2026-11-01T03:00:00Z"), "2026-11-01", "medianoche de SIM = 03:00 UTC");
    assert.deepEqual([periodoDe("mes_anterior", "2026-12-10").desde, periodoDe("mes_anterior", "2026-12-10").hasta], ["2026-11-01", "2026-11-30"]);
    assert.deepEqual([periodoDe("mes_anterior", "2026-03-15").desde, periodoDe("mes_anterior", "2026-03-15").hasta], ["2026-02-01", "2026-02-28"]);
    assert.deepEqual([periodoDe("90d", "2026-12-10").desde, periodoDe("90d", "2026-12-10").dias, periodoDe("90d", "2026-12-10").incompleto], ["2026-09-12", 90, true]);
    assert.equal(periodoDe("personalizado", "2026-12-10", { desde: "2026-12-05", hasta: "2027-01-31" }).hasta, "2026-12-10", "no se mira el futuro");
    assert.equal(periodoDe("personalizado", "2026-12-10", { desde: "x", hasta: null }).desde, "2026-12-01", "fechas inválidas → mes en curso");
  }

  // ── Octubre: prospección ──────────────────────────────────────────────
  const oct = t(OCT);
  {
    const m = oct.metricas;
    assert.equal(n(m.visitas.valor), 8, "8 visitas válidas (la anulada no; la de las 00:15 del 01/11 es de noviembre)");
    assert.equal(n(m.negocios_visitados.valor), 7, "varias visitas al mismo negocio = un negocio; el importado sin visita no");
    assert.equal(n(m.responsables.valor), 6);
    assert.equal(n(m.decisores.valor), 5, "el teléfono conseguido por un empleado no es hablar con el decisor");
    assert.equal(n(m.leads.valor), 7, "el lead de las 23:30 del 31/10 es de octubre; el de origen anulado no cuenta");
    assert.deepEqual([m.leads.extra.nuevas, m.leads.extra.clientes], [7, 0]);
    assert.equal(n(m.interesados.valor), 5, "señales: tibio/caliente en visitas o «Interesado» en el seguimiento (también de un ciclo anterior); «frío» y «no evaluado» no");
    assert.deepEqual(r(m.visitas_con_lead.valor).slice(0, 2), [7, 8], "por visita: 7 de 8 originaron un lead");
    assert.deepEqual(r(m.cohorte_interesados.valor).slice(0, 2), [5, 7], "la oportunidad que saltó a negociación y se vendió sin señal no cuenta como interesada");
    assert.deepEqual(r(m.cohorte_ventas.valor).slice(0, 2), [4, 7], "o1 vendió en noviembre: cuenta para su cohorte de octubre; la reabierta y vendida, una vez");
    assert.deepEqual(r(m.negocios_compradores.valor).slice(0, 2), [4, 7], "por negocio: 4 de 7 negocios de primera visita en octubre compraron");
    assert.deepEqual([oct.cohorte.abiertas, oct.cohorte.ganadas, oct.cohorte.perdidas, oct.cohorte.observado_hasta], [2, 4, 1, "2026-12-10"]);
    assert.deepEqual(oct.cohorte.antiguedad, { minima: 40, maxima: 61 });
    assert.equal(n(m.recompras_admin.valor), 0);
  }
  // ── Octubre: económico ────────────────────────────────────────────────
  {
    const m = oct.metricas;
    assert.equal(n(m.ventas.valor), 2, "por fecha del acuerdo: V3 (archivado: sigue contando) y V6a");
    assert.equal(c(m.importe_acordado.valor), 51_000_000);
    assert.equal(n(m.experiencias.valor), 35);
    assert.equal(c(m.cobrado.valor), 51_000_000);
    assert.equal(c(m.comision_generada.valor), 13_000_000);
    assert.equal(c(m.comision_pagada.valor), 5_000_000);
    assert.equal(c(m.cobros_menos_comisiones.valor), 46_000_000);
    assert.deepEqual([c(m.saldo_actual.valor), c(m.comision_prevista.valor), c(m.comision_a_pagar.valor)], [0, 0, 0]);
  }
  // ── Noviembre y diciembre: lead de un mes, venta del siguiente, cobros en dos meses ──
  {
    const nov = t(NOV).metricas;
    assert.equal(n(nov.ventas.valor), 3, "V1, V5b y V6b (V5a anulada no)");
    assert.equal(c(nov.importe_acordado.valor), 45_000_000);
    assert.equal(c(nov.cobrado.valor), 27_500_000, "el cobro anulado no suma");
    assert.equal(c(nov.comision_generada.valor), 0, "V1 recién se completó en diciembre");
    assert.equal(c(nov.comision_pagada.valor), 8_000_000, "el pago anulado no suma");
    assert.equal(c(nov.saldo_actual.valor), 10_000_000, "lectura de hoy: V5b todavía debe $100.000");
    assert.equal(c(nov.comision_prevista.valor), 4_000_000, "V5b: pactada y sin generar; V6b no lleva comisión");
    assert.equal(n(nov.recompras_admin.valor), 1);
    assert.equal(n(nov.leads.valor), 0, "la recompra de Administración no es un lead de calle");
    const dic = t(DIC).metricas;
    assert.equal(c(dic.cobrado.valor), 15_000_050, "centavos exactos");
    assert.equal(c(dic.comision_generada.valor), 4_000_000, "V1: generada el 02/12 (el cobro que la completó)");
    assert.equal(c(dic.comision_pagada.valor), 4_000_000, "y pagada el 08/12: sigue figurando como generada");
    assert.deepEqual([n(dic.leads.valor), dic.leads.extra.clientes], [1, 1], "la visita de Bruno a un cliente: lead de un cliente");
  }

  // ── Jornadas y eficiencia ──────────────────────────────────────────────
  {
    const js = oct.jornadas;
    assert.equal(js.length, 4, "incluye la jornada sin visitas");
    const j = (id: string) => js.find((x) => x.id === id)!;
    assert.deepEqual([j("J1").visitas, j("J1").negocios, j("J1").responsables, j("J1").decisores, j("J1").leads, j("J1").interesados, j("J1").ventas, j("J1").importe], [4, 3, 2, 2, 3, 2, 2, 30_000_000]);
    assert.deepEqual([j("J2").visitas, j("J2").km, j("J2").movilidad], [0, null, null], "sin datos no es 0");
    assert.deepEqual(j("J2").pendientes, ["km sin cargar", "gastos sin cargar"]);
    assert.deepEqual([j("J3").visitas, j("J3").ventas, j("J3").importe, j("J3").movilidad], [3, 2, 51_000_000, 6_000]);
    assert.deepEqual([j("J4").visitas, j("J4").movilidad, j("J4").movilidad_parcial], [2, null, 2_000], "la visita de las 00:15 es de su jornada aunque sea de otro día");
    const m = oct.metricas;
    assert.deepEqual(r(m.visitas_por_jornada.valor).slice(0, 2), [9, 4]);
    assert.deepEqual(r(m.km_por_visita.valor).slice(0, 2), [75, 9], "mismo subconjunto (jornadas con km) arriba y abajo");
    assert.deepEqual(r(m.km_por_lead.valor).slice(0, 2), [75, 7]);
    assert.equal(m.km_por_visita.extra.pendientes, 1);
    assert.deepEqual(r(m.movilidad_por_visita.valor).slice(0, 2), [16_000, 7]);
    assert.deepEqual(r(m.movilidad_por_lead.valor).slice(0, 2), [16_000, 6]);
    assert.deepEqual(r(m.movilidad_por_venta.valor), [16_000, 4, 4_000]);
    assert.deepEqual([c(m.movilidad.valor), m.movilidad.extra.pendientes, m.movilidad.extra.parcial], [16_000, 2, 2_000]);
    assert.deepEqual(r(m.ventas_por_jornada.valor).slice(0, 2), [4, 4]);
    assert.deepEqual(r(m.importe_por_jornada.valor).slice(0, 2), [81_000_000, 4]);
    assert.equal(n(m.ventas_jornadas.valor), 4, "ventas obtenidas hasta hoy por jornadas de octubre ≠ ventas cerradas en octubre (2)");
    assert.equal(n(m.ventas.valor), 2);
    const nov = t(NOV);
    assert.deepEqual(nov.sin_jornada, { ventas: 1, importe: 15_000_000 }, "la recompra espontánea de Administración no tiene jornada");
    const dic = t(DIC);
    assert.equal(dic.jornadas[0].ventas, 1, "la recompra trabajada se atribuye a la jornada de su propia visita, no a la de la primera compra");
    assert.deepEqual(r(dic.metricas.km_por_visita.valor), [0, 0, null], "sin jornadas con km → «Sin datos», no 0");
    const sinJornadas = t(P("2026-12-09", "2026-12-10"));
    assert.deepEqual(r(sinJornadas.metricas.visitas_por_jornada.valor), [0, 0, null]);
  }

  // ── Segmentos, necesidades múltiples y pérdidas ───────────────────────
  {
    const nec = oct.segmentos.necesidad;
    assert.equal(nec.sumable, false);
    assert.equal(nec.total.oportunidades, 7, "total deduplicado");
    assert.ok(nec.filas.reduce((s, f) => s + f.oportunidades, 0) > nec.total.oportunidades, "las filas se superponen");
    const sorteos = nec.filas.find((f) => f.valor === "sorteos")!;
    assert.deepEqual([sorteos.oportunidades, sorteos.ventas, sorteos.importe], [2, 2, 30_000_000]);
    assert.equal(nec.filas.find((f) => f.valor === "sin_necesidad")!.oportunidades, 4, "sin necesidad anotada no se deduce");
    assert.deepEqual(oct.segmentos.rubro.filas.map((f) => [f.valor, f.oportunidades]).sort(), [["rC", 4], ["rG", 3]]);
    assert.deepEqual(oct.segmentos.comercial.filas.map((f) => [f.valor, f.oportunidades]).sort(), [["bru", 3], ["tob", 4]], "comercial de origen, no el responsable");
    assert.equal(oct.segmentos.interes.filas.find((f) => f.valor === "no_evaluado")!.oportunidades, 2, "«No evaluado» es su propia fila, no «sin interés»");
    const todo = t(TODO).perdidas;
    assert.deepEqual([todo.episodios, todo.oportunidades, todo.reabiertas], [3, 2, 1], "dos pérdidas de o4 = dos episodios de una oportunidad");
    assert.deepEqual(todo.filas.map((f) => [f.motivo, f.episodios, f.oportunidades]), [["precio", 2, 2], ["sin_presupuesto", 1, 1]]);
    assert.deepEqual([oct.perdidas.episodios, t(NOV).perdidas.episodios], [2, 1], "por fecha del episodio");
    assert.equal(n(t(TODO).metricas.leads.valor), 8, "reabrir no crea leads: 8 en todo el año");
  }

  // ── Filtros ────────────────────────────────────────────────────────────
  {
    const tob = t(OCT, { ...SIN_FILTROS, comercial: "tob" }).metricas;
    assert.deepEqual([n(tob.visitas.valor), n(tob.leads.valor), n(tob.ventas.valor), c(tob.comision_generada.valor), n(tob.jornadas.valor)], [5, 4, 1, 4_000_000, 3]);
    assert.equal(tob.recompras_admin.valor.tipo, "no_aplica");
    const norte = t(OCT, { ...SIN_FILTROS, zona: "zN" });
    assert.equal(n(norte.metricas.ventas.valor), 1, "zona del negocio: V3 (Norte), no V6a (Sur)");
    for (const id of ["km", "movilidad", "km_por_visita", "movilidad_por_lead", "visitas_por_jornada"] as IdMetrica[]) {
      assert.equal(norte.metricas[id].valor.tipo, "no_aplica", `${id} no reparte gastos de la jornada entre negocios`);
    }
    assert.ok(norte.jornadas.every((j) => j.km === null && j.movilidad === null));
    const sorteos = t(OCT, { ...SIN_FILTROS, necesidad: "sorteos" }).metricas;
    assert.deepEqual([n(sorteos.leads.valor), n(sorteos.visitas.valor)], [2, 2], "oportunidades: alguna necesidad; visitas: la anotada en esa visita");
    const arch = t(OCT, { ...SIN_FILTROS, rubro: "rG" }).metricas;
    assert.equal(c(arch.importe_acordado.valor), 51_000_000, "el negocio archivado conserva sus resultados");
  }

  // ── Contrato de conciliación (todas las métricas, varios filtros) ─────
  const casos: Array<[Periodo, Filtros]> = [[OCT, SIN_FILTROS], [NOV, SIN_FILTROS], [DIC, SIN_FILTROS], [TODO, SIN_FILTROS],
    [OCT, { ...SIN_FILTROS, comercial: "tob" }], [TODO, { ...SIN_FILTROS, comercial: "bru" }], [OCT, { ...SIN_FILTROS, zona: "zN" }],
    [TODO, { ...SIN_FILTROS, necesidad: "sorteos" }], [TODO, { ...SIN_FILTROS, rubro: "rC", zona: "zS" }]];
  const columnaDe: Partial<Record<IdMetrica, string>> = {
    importe_acordado: "Importe acordado", experiencias: "Experiencias", saldo_actual: "Saldo hoy", cobrado: "Importe", comision_pagada: "Importe",
    cobros_menos_comisiones: "Importe", comision_generada: "Comisión pactada", comision_prevista: "Comisión pactada", comision_a_pagar: "A pagar hoy",
  };
  let chequeos = 0;
  for (const [p, f] of casos) {
    const tb: Tablero = t(p, f);
    for (const id of Object.keys(DEFINICIONES) as IdMetrica[]) {
      const res = tb.metricas[id];
      const d = detalle(ctx, p, f, id);
      assert.ok(d, `hay detalle de ${id}`);
      const v = res.valor;
      if (v.tipo === "conteo") {
        const col = columnaDe[id];
        const total = col ? d!.totales[d!.columnas.findIndex((x) => x.titulo === col)] : id === "interesados" || id === "leads" || id === "recompras_admin" || id === "ventas" || id === "ventas_jornadas"
          || id === "negocios_visitados" || id === "responsables" || id === "decisores" || id === "visitas" || id === "jornadas" || id === "perdidas" ? d!.filas.length : null;
        if (total !== null) { assert.equal(v.n, total, `${id}: cifra = detalle (${p.desde}..${p.hasta} ${JSON.stringify(f)})`); chequeos++; }
      } else if (v.tipo === "dinero" && columnaDe[id]) {
        const i = d!.columnas.findIndex((x) => x.titulo === columnaDe[id]);
        assert.equal(v.c, d!.totales[i], `${id}: cifra = suma del detalle (${p.desde}..${p.hasta} ${JSON.stringify(f)})`);
        chequeos++;
      } else if (v.tipo === "razon" && (id === "cohorte_ventas" || id === "cohorte_interesados")) {
        const col = id === "cohorte_ventas" ? "Venta (acuerdo)" : "Primera señal de interés";
        const i = d!.columnas.findIndex((x) => x.titulo === col);
        assert.equal(v.den, d!.filas.length, `${id}: el denominador es el detalle`);
        assert.equal(v.num, d!.filas.filter((x) => x.celdas[i] !== null).length, `${id}: el numerador sale del MISMO grupo`);
        chequeos += 2;
      }
    }
    // Desgloses excluyentes = total; superpuestos marcados.
    for (const dd of DIMENSIONES) {
      const s = tb.segmentos[dd.valor];
      assert.equal(s.total.oportunidades, n(tb.metricas.leads.valor), `${dd.valor}: el total es la cohorte`);
      if (s.sumable) {
        assert.equal(s.filas.reduce((a, x) => a + x.oportunidades, 0), s.total.oportunidades, `${dd.valor}: filas suman el total`);
        assert.equal(s.filas.reduce((a, x) => a + x.ventas, 0), s.total.ventas);
        assert.equal(s.filas.reduce((a, x) => a + x.importe, 0), s.total.importe);
        chequeos += 3;
      } else assert.ok(s.filas.reduce((a, x) => a + x.oportunidades, 0) >= s.total.oportunidades);
    }
    assert.equal(tb.productos.reduce((a, x) => a + x.importe, 0), c(tb.metricas.importe_acordado.valor), "productos suman el importe");
    assert.equal((tb.metricas.leads.extra.nuevas ?? 0) + (tb.metricas.leads.extra.clientes ?? 0), n(tb.metricas.leads.valor));
    assert.equal(tb.cohorte.por_clase.filter((x) => x.clase !== "recompra_admin").reduce((a, x) => a + x.leads, 0), tb.cohorte.leads);
    assert.equal(tb.perdidas.filas.reduce((a, x) => a + x.episodios, 0), tb.perdidas.episodios, "episodios suman; oportunidades distintas no");
    chequeos += 4;
  }
  // Ninguna venta acreditada dos veces entre jornadas.
  {
    const js = filasJornadas(ctx, "2026-01-01", "2026-12-10", SIN_FILTROS);
    const conJornada = ctx.ventas.filter((x) => x.jornada);
    assert.equal(js.reduce((a, j) => a + j.ventas, 0), conJornada.length, "Σ ventas por jornada = ventas con jornada (cada una una sola vez)");
    assert.equal(new Set(conJornada.map((x) => x.v.id)).size, conJornada.length);
    assert.equal(ctx.ventas.filter((x) => !x.jornada).map((x) => x.v.id).join(), "V6b", "sin jornada: solo la recompra espontánea de Administración");
    assert.equal(ctx.ventas.find((x) => x.v.id === "V6c")!.jornada, "J5");
    chequeos += 4;
  }
  // Detalles especiales.
  {
    const s = detalle(ctx, OCT, SIN_FILTROS, "segmento", { dimension: "necesidad", valor: "sorteos" })!;
    assert.equal(s.filas.length, 2);
    const j = detalle(ctx, OCT, SIN_FILTROS, "jornada", { jornada: "J4" })!;
    assert.equal(j.filas.length, 2, "la jornada muestra sus visitas");
    assert.equal(detalle(ctx, OCT, SIN_FILTROS, "inexistente"), null);
    assert.ok(!JSON.stringify(t(TODO)).includes("observacion"), "sin notas privadas");
  }

  // ── Paginación: ninguna lectura se corta en el máximo de filas de PostgREST ──
  {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sin-uso";
    const { todasLasFilas } = await import("@/lib/crmB1Server");
    const filas = Array.from({ length: 2_345 }, (_, i) => ({ i }));
    const pedidas: Array<[number, number]> = [];
    const todas = await todasLasFilas<{ i: number }>(async (a, b) => { pedidas.push([a, b]); return { data: filas.slice(a, b + 1), error: null }; }, "prueba");
    assert.equal(todas.length, 2_345, "lee todas las páginas");
    assert.deepEqual(pedidas, [[0, 999], [1000, 1999], [2000, 2999]]);
    const exactas = await todasLasFilas<{ i: number }>(async (a, b) => ({ data: filas.slice(0, 2000).slice(a, b + 1), error: null }), "prueba");
    assert.equal(exactas.length, 2_000, "con un múltiplo exacto pide una página más y corta");
    await assert.rejects(todasLasFilas(async () => ({ data: null, error: { message: "x" } }), "prueba"), /prueba: x/);
  }

  // ── Aislamiento estático ──────────────────────────────────────────────
  {
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = join(d, e.name);
        if (e.isDirectory()) walk(q, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(q.split(sep).join("/"));
      }
      return out;
    };
    const leer = (f: string) => readFileSync(f, "utf8");
    assert.ok(walk("app/comercial").every((f) => !/crmB4|crm\/Metricas/.test(leer(f))), "el área comercial no toca métricas");
    const usan = walk("app").filter((f) => /crmB4Rutas|crmB4Server/.test(leer(f)));
    assert.deepEqual(usan, ["app/api/admin/crm/metricas/route.ts"], "solo la ruta de administración");
    assert.match(leer(usan[0]), /const a = await actorAdmin\(\);\s*if \(!a\.ok\) return a\.response;/);
    assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(leer("lib/crmB4Server.ts")), "B4 solo lee");
    assert.ok(!/limit\(/.test(leer("lib/crmB4Server.ts")), "sin límites de filas");
  }

  console.log(`OK — crmB4 puro: escenario controlado (hoy fijo 10/12/2026), prospección, cohortes, económico, jornadas, segmentos, pérdidas, filtros y ${chequeos} chequeos de conciliación.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
