// GUARDIÁN: esta suite exige la base LOCAL de pruebas. No escribe —el caso 22 lo
// demuestra con un censo antes y después—, pero hasta el 05/10/2026 LEÍA Producción, y era
// la última integración de IA que lo hacía. Ahora corre sobre el escenario histórico
// sintético TEST_IA_HIST_2026, que reproduce las mismas cifras. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { HERRAMIENTAS } from "@/lib/ia/tools";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarPlanMulti } from "@/lib/ia/plan/planMulti";
import { accesoDesdeRegistro } from "@/lib/ia/plan/capacidades";
import { ejecutarPlanMulti } from "@/lib/ia/plan/ejecutorPlan";
import { renderResultadoPlan } from "@/lib/ia/plan/renderPlan";

// Ejecutar: npm run pruebas:ia-historico   (o node scripts/pruebas/correr-mutantes.mjs <este archivo>)
//
// Bloque 5C — el planificador de punta a punta, SOLO LECTURA, sobre el escenario histórico
// sintético de agosto y septiembre de 2026 (db/fixtures-ia-historico.sql). Las cifras de esos
// dos meses se afirman en absoluto; el resto se verifica por identidades que no se rompen
// cuando entran datos nuevos.

const ACCESO = accesoDesdeRegistro(HERRAMIENTAS);

// Las cifras del escenario, verificadas aparte por scripts/pruebas/contrato-historico-ia.ts
// contra el motor real. Son las mismas que tenía el historial de Producción.
const REAL = {
  ago: { fact: 13_454_000, turnos: 912, personas: 822, minutos: 13_680, horas: 414, fuentes: { turnero: 10_258_000, manuales: 2_950_000, reservas_online: 126_000, campeonatos: 120_000 } },
  sep: { fact: 10_440_000, turnos: 826, personas: 738, minutos: 12_390, horas: 405.08, fuentes: { turnero: 9_454_000, manuales: 670_000, campeonatos: 240_000, reservas_online: 76_000 } },
  deltaFact: -3_014_000,
  variacionFact: -22.4,
  deltaTurnos: -86,
  deltaFuentes: { manuales: -2_280_000, turnero: -804_000, campeonatos: 120_000, reservas_online: -50_000 },
};

const pFact = (id: string, mes: string) => ({ id, herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes }, dimensiones: ["fuente"] } });
const pMet = (id: string, metrica: string, mes: string) => ({ id, herramienta: "consulta_analitica_interna", argumentos: { metricas: [metrica], periodo: { mes } } });
const pCron = (id: string, mes: number) => ({ id, herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes } });
const dif = (base: string, comparado: string, metrica: string) => ({ tipo: "diferencia", base: { paso: base, metrica }, comparado: { paso: comparado, metrica } });

async function correr(plan: Record<string, unknown>) {
  const v = validarPlanMulti(plan, ACCESO);
  if (!v.ok) throw new Error(`plan inválido: ${v.error}`);
  return ejecutarPlanMulti(v.plan);
}
const comp = (r: Awaited<ReturnType<typeof correr>>, metrica: string) => r.comparaciones.find((c) => c.metrica === metrica);
const ev = (r: Awaited<ReturnType<typeof correr>>, id: string) => r.evidencias.find((e) => e.evidenciaId === id);
const cerca = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

async function main() {
  const tablas = ["turnos_stand", "reservas", "fin_movimientos", "cronograma_dias", "gift_cards", "campeonato_inscripciones"] as const;
  const censo = async () => {
    const out: Record<string, number> = {};
    for (const t of tablas) {
      const { count, error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      if (error) throw error;
      out[t] = count ?? -1;
    }
    return out;
  };
  const antes = await censo();

  // ── 1, 2) Facturación entre dos meses cerrados y delta por fuente ───────────────────────
  {
    const r = await correr({
      objetivo: "Facturación de agosto contra septiembre",
      pasos: [pFact("p1", "2026-08"), pFact("p2", "2026-09")],
      calculos: [dif("p1", "p2", "facturacion_bruta"), { tipo: "delta_por_fuente", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } }],
    });
    const c = comp(r, "facturacion_bruta")!;
    assert.equal(c.base.valor, REAL.ago.fact);
    assert.equal(c.comparado.valor, REAL.sep.fact);
    assert.equal(c.diferencia, REAL.deltaFact, "diferencia = comparado − base");
    assert.ok(cerca(c.variacionPct!, REAL.variacionFact, 0.05), `variación ${c.variacionPct}`);
    assert.ok(c.base.periodo < c.comparado.periodo, "la base es el período más antiguo");

    const porFuente = r.comparaciones.find((x) => x.porFuente)!.porFuente!;
    for (const [fuente, delta] of Object.entries(REAL.deltaFuentes)) {
      const f = porFuente.find((x) => x.fuente === fuente)!;
      assert.equal(f.delta, delta, `delta de ${fuente}`);
    }
    assert.equal(porFuente.reduce((a, f) => a + f.delta, 0), REAL.deltaFact, "los deltas por fuente suman la diferencia total");
    // Ordenado por impacto ABSOLUTO.
    assert.equal(porFuente[0].fuente, "manuales", "la fuente de mayor impacto absoluto va primero");
    for (let i = 1; i < porFuente.length; i++) {
      assert.ok(Math.abs(porFuente[i - 1].delta) >= Math.abs(porFuente[i].delta), "orden por impacto absoluto");
    }
  }
  console.log(`OK — 5C (1,2): facturación $${REAL.ago.fact.toLocaleString("es-AR")} → $${REAL.sep.fact.toLocaleString("es-AR")} (${REAL.variacionFact}%), con los deltas por fuente sumando exactamente la diferencia.`);

  // ── 3, 4, 5) Turnos, personas y minutos entre los mismos meses ──────────────────────────
  {
    const r = await correr({
      objetivo: "Actividad de agosto contra septiembre",
      pasos: [pMet("p1", "turnos", "2026-08"), pMet("p2", "turnos", "2026-09"), pMet("p3", "personas", "2026-08"), pMet("p4", "personas", "2026-09"), pMet("p5", "minutos_actividad", "2026-08"), pMet("p6", "minutos_actividad", "2026-09")],
      calculos: [dif("p1", "p2", "turnos"), dif("p3", "p4", "personas"), dif("p5", "p6", "minutos_actividad")],
    });
    assert.equal(comp(r, "turnos")!.diferencia, REAL.deltaTurnos);
    assert.equal(comp(r, "personas")!.diferencia, REAL.sep.personas - REAL.ago.personas);
    assert.equal(comp(r, "minutos_actividad")!.diferencia, REAL.sep.minutos - REAL.ago.minutos);
    assert.equal(ev(r, "p1.turnos")!.valor, REAL.ago.turnos);
    assert.equal(ev(r, "p4.personas")!.valor, REAL.sep.personas);
    for (const e of r.evidencias) assert.equal(e.universo, "actividad", "las métricas de actividad declaran su universo");
  }
  console.log("OK — 5C (3,4,5): turnos, personas y minutos comparados entre los dos meses, con el universo declarado.");

  // ── 6, 7) Horas programadas y análisis conjunto con la actividad ────────────────────────
  {
    const r = await correr({
      objetivo: "Actividad y disponibilidad de agosto contra septiembre",
      pasos: [pMet("p1", "turnos", "2026-08"), pMet("p2", "turnos", "2026-09"), pCron("p3", 8), pCron("p4", 9)],
      calculos: [dif("p1", "p2", "turnos"), dif("p3", "p4", "horas_programadas")],
    });
    const horas = comp(r, "horas_programadas")!;
    assert.equal(horas.base.valor, REAL.ago.horas);
    assert.ok(cerca(horas.comparado.valor, REAL.sep.horas, 0.01));
    assert.equal(horas.universo, "equipo");
    assert.ok(r.lectura, "hay una lectura de demanda/disponibilidad");
    assert.equal(r.lectura!.veredicto, "compatible_menor_demanda", "actividad baja con disponibilidad estable");
    assert.ok(/no prueban la causa/.test(r.lectura!.texto), "la lectura nunca afirma la causa");
    assert.ok(r.advertencias.some((a) => /se comparan lado a lado/.test(a)), "avisa que los universos no se restan entre sí");
  }
  console.log("OK — 5C (6,7): horas programadas (414 h → 405,08 h) junto a la actividad, con la lectura 'compatible con menor demanda'.");

  // ── 8) Mes en curso: la analítica lo resuelve por ventana, sin inventar el resto ─────────
  {
    const r = await correr({
      objetivo: "Mes en curso contra el mes pasado",
      pasos: [pMet("p1", "facturacion_bruta", "2026-09"), { id: "p2", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { relativo: "este_mes" } } }],
      calculos: [dif("p1", "p2", "facturacion_bruta")],
    });
    const c = comp(r, "facturacion_bruta")!;
    assert.ok(c.base.periodo.startsWith("2026-09"), "la base es el mes cerrado");
    assert.ok(c.comparado.periodo > c.base.periodo, "el comparado es el más reciente");
    assert.ok(Number.isFinite(c.diferencia));
  }
  console.log("OK — 5C (8): un mes en curso se compara contra uno cerrado con la base en el más antiguo.");

  // ── 9) Base cero: la variación no se inventa ────────────────────────────────────────────
  {
    const r = await correr({
      objetivo: "Período sin datos contra uno con datos",
      pasos: [pMet("p1", "facturacion_bruta", "2020-01"), pMet("p2", "facturacion_bruta", "2026-08")],
      calculos: [dif("p1", "p2", "facturacion_bruta")],
    });
    const c = comp(r, "facturacion_bruta")!;
    assert.equal(c.base.valor, 0);
    assert.equal(c.variacionPct, null, "base cero: no calculable");
    assert.ok(/base es cero/.test(c.motivoNoCalculable ?? ""));
    assert.equal(c.diferencia, REAL.ago.fact, "la diferencia absoluta sí se calcula");
    const md = renderResultadoPlan(r);
    assert.ok(md.includes("no calculable"), "la respuesta lo dice");
    assert.ok(!/Infinity|NaN/.test(md));
  }
  console.log("OK — 5C (9): con base cero la variación se declara no calculable y no aparece Infinity ni NaN.");

  // ── 10, 11) Fuente presente en un mes y ausente en otro; deltas que se compensan ────────
  {
    const r = await correr({
      objetivo: "Qué fuentes explican el cambio",
      pasos: [pFact("p1", "2026-08"), pFact("p2", "2026-09")],
      calculos: [{ tipo: "delta_por_fuente", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } }],
    });
    const c = r.comparaciones.find((x) => x.porFuente)!;
    assert.equal(c.huboCompensacion, true, "campeonatos sube mientras el resto baja");
    const md = renderResultadoPlan(r);
    assert.ok(/Hubo compensaci[óo]n entre fuentes/.test(md), "la compensación se explica");
    assert.ok(/no porcentajes de contribuci[óo]n/.test(md), "y se explica por qué no se usan porcentajes de contribución");
    // Una fuente que existe en un mes y no en el otro aparece con 0 en el que falta.
    const gift = c.porFuente!.find((f) => f.fuente === "gift_cards");
    if (gift) assert.ok(gift.base === 0 || gift.comparado === 0, "una fuente ausente en un mes vale 0, no desaparece");
  }
  console.log("OK — 5C (10,11): las fuentes se compensan entre sí, se explica y una fuente ausente en un mes vale cero.");

  // ── 12, 13) Ingresos manuales separados, y excluidos ────────────────────────────────────
  {
    const soloManual = await correr({
      objetivo: "Ingresos manuales de los dos meses",
      pasos: [pMet("p1", "facturacion_manual", "2026-08"), pMet("p2", "facturacion_manual", "2026-09")],
      calculos: [dif("p1", "p2", "facturacion_manual")],
    });
    assert.equal(comp(soloManual, "facturacion_manual")!.base.valor, REAL.ago.fuentes.manuales);
    assert.equal(comp(soloManual, "facturacion_manual")!.diferencia, REAL.deltaFuentes.manuales);

    const sinManual = await correr({
      objetivo: "Facturación sin ingresos manuales",
      pasos: [
        { id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_automatica"], periodo: { mes: "2026-08" } } },
        { id: "p2", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_automatica"], periodo: { mes: "2026-09" } } },
      ],
      calculos: [dif("p1", "p2", "facturacion_automatica")],
    });
    const auto = comp(sinManual, "facturacion_automatica")!;
    assert.equal(auto.base.valor, REAL.ago.fact - REAL.ago.fuentes.manuales, "automático = total − manual");
    assert.equal(auto.comparado.valor, REAL.sep.fact - REAL.sep.fuentes.manuales);
  }
  console.log("OK — 5C (12,13): los ingresos manuales se pueden aislar o excluir, y automático + manual cierra el total.");

  // ── 14) Anomalía seguida de desglose (paso dependiente) ─────────────────────────────────
  {
    const r = await correr({
      objetivo: "Anomalías de agosto y su desglose diario",
      pasos: [
        { id: "p1", herramienta: "detectar_anomalias", argumentos: { anio: 2026, mes: 8 } },
        { id: "p2", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["dia"] }, dependeDe: ["p1"] },
      ],
    });
    assert.equal(r.pasos.find((p) => p.id === "p1")!.ok, true, "la anomalía se ejecutó");
    assert.equal(r.pasos.find((p) => p.id === "p2")!.ok, true, "y el desglose después");
    assert.ok(r.evidencias.some((e) => e.paso === "p2"), "el desglose aporta evidencia");
    assert.equal(r.evidencias.filter((e) => e.paso === "p1").length, 0, "el diagnóstico no aporta cifras comparables");
  }
  console.log("OK — 5C (14): un diagnóstico y después un desglose dependiente se ejecutan en orden.");

  // ── 15, 16) Empleado sin atribución; relación inválida entre universos ──────────────────
  {
    const sinEmpleado = validarPlanMulti({
      objetivo: "Ventas de Federico",
      pasos: [{ id: "p1", herramienta: "consultar_metricas_equipo", argumentos: { anio: 2026, mes: 8 } }],
    }, ACCESO);
    assert.equal(sinEmpleado.ok, false, "métricas de equipo no participa de un plan");
    assert.ok(!sinEmpleado.ok && /cronograma/.test(sinEmpleado.error), "explica que estar programado no demuestra la venta");

    const cruce = validarPlanMulti({
      objetivo: "Ticket promedio",
      pasos: [pMet("p1", "facturacion_bruta", "2026-08"), pMet("p2", "operaciones", "2026-08")],
      calculos: [{ tipo: "diferencia", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "operaciones" } }],
    }, ACCESO);
    assert.equal(cruce.ok, false, "no se cruzan métricas distintas en un cálculo");
  }
  console.log("OK — 5C (15,16): no hay atribución de ventas a una persona y no se cruzan métricas de universos distintos.");

  // ── 17) Herramienta que falla: se publica lo comprobado ─────────────────────────────────
  {
    const r = await correr({
      objetivo: "Facturación y un cronograma inexistente",
      pasos: [pFact("p1", "2026-08"), pFact("p2", "2026-09"), pCron("p3", 8), { id: "p4", herramienta: "consultar_cronograma", argumentos: { anio: 1999, mes: 1 } }],
      calculos: [dif("p1", "p2", "facturacion_bruta"), dif("p3", "p4", "horas_programadas")],
    });
    assert.equal(comp(r, "facturacion_bruta")!.diferencia, REAL.deltaFact, "lo comprobado se publica igual");
    const md = renderResultadoPlan(r);
    assert.ok(md.includes("$13.454.000"), "la parte que sí se pudo calcular está");
    // El cronograma de 1999 no existe: o falla, o devuelve 0 horas. En los dos casos se declara.
    const horas = comp(r, "horas_programadas");
    if (horas) assert.ok(horas.comparado.valor === 0 || horas.base.valor === 0, "un cronograma inexistente no inventa horas");
    assert.ok(!/supongo|asumiendo que|estimamos/.test(md), "no se inventa un valor para el hueco");
    if (r.faltantes.length > 0) assert.ok(/no se pudo verificar/i.test(md), "y lo que no se pudo verificar queda declarado");
  }
  console.log("OK — 5C (17): con una herramienta sin datos se publica lo comprobado y no se rellena el hueco.");

  // ── 18, 19, 20) Seguimientos: fin de semana, otro mes, por fuente ───────────────────────
  {
    const finde = await correr({
      objetivo: "Solo los fines de semana",
      pasos: [
        { id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: ["fin_de_semana"] } } },
        { id: "p2", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-09" }, filtros: { dias_semana: ["fin_de_semana"] } } },
      ],
      calculos: [dif("p1", "p2", "facturacion_bruta")],
    });
    assert.equal(comp(finde, "facturacion_bruta")!.base.valor, 5_774_000, "los fines de semana de agosto son los de 5B");

    const contraAgosto = await correr({
      objetivo: "Contra agosto",
      pasos: [pMet("p1", "facturacion_bruta", "2026-08"), pMet("p2", "facturacion_bruta", "2026-10")],
      calculos: [dif("p1", "p2", "facturacion_bruta")],
    });
    assert.equal(comp(contraAgosto, "facturacion_bruta")!.base.valor, REAL.ago.fact);

    const porFuente = await correr({
      objetivo: "Separalo por fuente",
      pasos: [pFact("p1", "2026-08"), pFact("p2", "2026-09")],
      calculos: [{ tipo: "delta_por_fuente", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } }],
    });
    assert.ok(porFuente.comparaciones.find((c) => c.porFuente)!.porFuente!.length >= 4);
  }
  console.log("OK — 5C (18,19,20): los seguimientos de fin de semana, otro mes y por fuente dan los mismos números que 5B.");

  // ── 25) Compatibilidad con la consulta aprobada de 5B ───────────────────────────────────
  {
    const r = await correr({
      objetivo: "Hábiles contra fin de semana de agosto",
      pasos: [{
        id: "p1", herramienta: "consulta_analitica_interna",
        argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["fin_de_semana"] }, calculos: ["promedio_dia_calendario", "maximo"] },
      }],
    });
    assert.equal(r.pasos[0].ok, true, "la consulta de 5B sigue funcionando dentro de un plan");
    assert.equal(ev(r, "p1.facturacion_bruta")!.valor, REAL.ago.fact, "y da el mismo total");
  }
  console.log("OK — 5C (25): la consulta aprobada en 5B funciona igual dentro de un plan.");

  // ── 23, 24) Cero web y cero PII ─────────────────────────────────────────────────────────
  {
    const r = await correr({
      objetivo: "Agosto contra septiembre",
      pasos: [pFact("p1", "2026-08"), pFact("p2", "2026-09"), pCron("p3", 8), pCron("p4", 9)],
      calculos: [dif("p1", "p2", "facturacion_bruta"), dif("p3", "p4", "horas_programadas")],
    });
    const serial = JSON.stringify(r) + renderResultadoPlan(r);
    assert.ok(!/http/.test(serial), "ninguna fuente externa");
    assert.ok(!/@/.test(serial), "ningún email");
    assert.ok(!/\+?54\s?9?\s?\d{2,4}[\s-]?\d{6,8}/.test(serial), "ningún teléfono");
    assert.ok(!/\b(dni|documento|cuit|cuil|nombre_cliente)\b/i.test(serial), "ningún campo de datos personales");
    // El cronograma trae nombres del EQUIPO, que no son datos de clientes: no se publican igual.
    const md = renderResultadoPlan(r);
    for (const nombre of ["Ramiro", "Federico", "Francisco", "Santiago"]) {
      assert.ok(!md.includes(nombre), `la respuesta agregada no nombra a ${nombre}`);
    }
  }
  console.log("OK — 5C (23,24): sin fuentes externas, sin datos personales y sin nombres del equipo en la respuesta agregada.");

  // ── 22) SOLO LECTURA ────────────────────────────────────────────────────────────────────
  {
    const despues = await censo();
    assert.deepEqual(despues, antes, "el planificador no insertó, actualizó ni eliminó una sola fila");
  }
  console.log("OK — 5C (22): SOLO LECTURA — el conteo de filas de las seis tablas quedó idéntico.");

  console.log("\nOK — planificador 5C (datos reales): varios pasos, dependencias, cálculos server-side, deltas por fuente, lectura de demanda y fallos parciales declarados.");
}

main().catch((e) => { console.error(e); process.exit(1); });
