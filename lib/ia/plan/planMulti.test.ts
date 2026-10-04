import { strict as assert } from "node:assert";
import { validarPlanMulti, tandas, MAX_PASOS, MAX_PROFUNDIDAD, MAX_CALCULOS, PRESENTACIONES } from "@/lib/ia/plan/planMulti";
import { CAPACIDADES, CAPACIDADES_IDS, FUERA_DEL_PLANIFICADOR, UNIVERSOS_PLAN, accesoDesdeRegistro, type AccesoSchemas } from "@/lib/ia/plan/capacidades";
import {
  relacionEntreUniversos, RELACIONES_PROHIBIDAS, motivoProhibicion,
  magnitud, fraseMagnitud, etiquetaEsPlural, cambioSimilar, leerDemandaDisponibilidad, afirmaCausa,
  UMBRAL_ESTABLE_PCT, UMBRAL_CLARO_PCT, CALCULOS_PLAN_IDS,
} from "@/lib/ia/plan/compatibilidad";
import { clasificarComplejidad, claseEfectiva } from "@/lib/ia/plan/complejidad";
import { validarSintesis, MAX_AFIRMACIONES } from "@/lib/ia/plan/sintesis";
import { clausulas, marcadoresDe, direccionReal, aliasDeMetrica, DIRECCIONES } from "@/lib/ia/plan/direccion";
import { contextoDesdeAnalisis, pistaDeContexto, heredar, CONTEXTO_VACIO } from "@/lib/ia/plan/contexto";
import type { Evidencia, ComparacionCalculada } from "@/lib/ia/plan/ejecutorPlan";

// Ejecutar: npx tsx lib/ia/plan/planMulti.test.ts — puro.
//
// Bloque 5C — el plan es la única superficie por la que el modelo arma un análisis de varios
// pasos. Acá se verifica que siga siendo cerrado: sin SQL, sin herramientas inventadas, sin
// ciclos, sin referencias al futuro, con límites, y que la síntesis que propone el modelo no
// pueda publicar un número que el servidor no calculó.

// Acceso a schemas FALSO pero con la forma real: así el test es puro (no toca el registro ni la
// base). La prueba contractual aparte verifica que el registro real coincida.
const ACCESO: AccesoSchemas = accesoDesdeRegistro({
  consulta_analitica_interna: { schema: { properties: { metricas: {}, periodo: {}, filtros: {}, dimensiones: {}, calculos: {}, segmentacion: {}, ranking: {}, orden: {}, limite: {} }, required: ["metricas", "periodo"] } },
  consultar_cronograma: { schema: { properties: { anio: {}, mes: {} }, required: ["anio", "mes"] } },
  consultar_metricas_stand_reservas: { schema: { properties: { anio: {}, mes: {} }, required: ["anio", "mes"] } },
  consultar_finanzas: { schema: { properties: { anio: {}, mes: {} }, required: ["anio", "mes"] } },
  detectar_anomalias: { schema: { properties: { anio: {}, mes: {} }, required: ["anio", "mes"] } },
  proyectar_periodo: { schema: { properties: { anio: {}, mes: {} }, required: ["anio", "mes"] } },
});

const ok = (x: ReturnType<typeof validarPlanMulti>) => {
  assert.equal(x.ok, true, x.ok ? "" : `esperaba plan válido y falló: ${x.error}`);
  return (x as Extract<typeof x, { ok: true }>).plan;
};
const falla = (x: ReturnType<typeof validarPlanMulti>, campo?: string) => {
  assert.equal(x.ok, false, "esperaba un plan RECHAZADO");
  const e = x as Extract<typeof x, { ok: false }>;
  assert.ok(e.error && e.error.length > 0, "el rechazo trae un mensaje accionable");
  if (campo) assert.equal(e.campo, campo);
  return e;
};
const v = (input: Record<string, unknown>) => validarPlanMulti(input, ACCESO);

const pasoFact = (id: string, mes: string, dims = true) => ({
  id, herramienta: "consulta_analitica_interna",
  argumentos: { metricas: ["facturacion_bruta"], periodo: { mes }, ...(dims ? { dimensiones: ["fuente"] } : {}) },
});
const pasoCron = (id: string, mes: number) => ({ id, herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes } });

function main() {
  // ── 1) Plan válido de varios pasos ──────────────────────────────────────────────────────
  {
    const plan = ok(v({
      objetivo: "Agosto contra septiembre",
      pasos: [pasoFact("p1", "2026-08"), pasoFact("p2", "2026-09"), pasoCron("p3", 8), pasoCron("p4", 9)],
      calculos: [
        { tipo: "diferencia", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } },
        { tipo: "delta_por_fuente", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } },
        { tipo: "diferencia", base: { paso: "p3", metrica: "horas_programadas" }, comparado: { paso: "p4", metrica: "horas_programadas" } },
      ],
      presentacion: { tipo: "comparacion_multidominio" },
    }));
    assert.equal(plan.pasos.length, 4);
    assert.equal(plan.calculos.length, 3);
    assert.equal(plan.presentacion, "comparacion_multidominio");
    assert.deepEqual(plan.deduplicados, []);
  }
  console.log("OK — 5C (1): plan de cuatro pasos con tres cálculos y presentación válida.");

  // ── 2 y 3) Ids únicos y dependencias válidas ────────────────────────────────────────────
  {
    falla(v({ objetivo: "x", pasos: [pasoFact("p1", "2026-08"), pasoFact("p1", "2026-09")] }), "pasos[1].id");
    falla(v({ objetivo: "x", pasos: [{ ...pasoFact("pA", "2026-08") }] }), "pasos[0].id");
    const plan = ok(v({ objetivo: "x", pasos: [pasoFact("p1", "2026-08"), { ...pasoCron("p2", 8), dependeDe: ["p1"] }] }));
    assert.deepEqual(plan.pasos[1].dependeDe, ["p1"]);
  }
  console.log("OK — 5C (2,3): ids con la forma pN, sin repetir, y dependencias que apuntan a un paso real.");

  // ── 4 y 5) Ciclos y referencias al futuro ───────────────────────────────────────────────
  {
    const futuro = falla(v({ objetivo: "x", pasos: [{ ...pasoFact("p1", "2026-08"), dependeDe: ["p2"] }, pasoFact("p2", "2026-09")] }), "pasos[0].dependeDe");
    assert.ok(/hacia atr[áa]s/.test(futuro.error), "explica que las dependencias solo miran atrás");
    falla(v({ objetivo: "x", pasos: [{ ...pasoFact("p1", "2026-08"), dependeDe: ["p1"] }] }), "pasos[0].dependeDe");
  }
  console.log("OK — 5C (4,5): un ciclo y una referencia a un paso futuro se rechazan (las dependencias solo apuntan hacia atrás).");

  // ── 6) Herramientas inexistentes o fuera del planificador ───────────────────────────────
  {
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_la_bola_de_cristal", argumentos: {} }] }), "pasos[0].herramienta");
    const ajena = falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_metricas_equipo", argumentos: { anio: 2026, mes: 8 } }] }), "pasos[0].herramienta");
    assert.ok(/cronograma/.test(ajena.error), "explica POR QUÉ métricas de equipo no entra en un plan");
    for (const nombre of Object.keys(FUERA_DEL_PLANIFICADOR)) {
      const e = falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: nombre, argumentos: {} }] }), "pasos[0].herramienta");
      assert.ok(e.error.length > 40, `${nombre}: el rechazo explica el motivo`);
    }
  }
  console.log("OK — 5C (6): una herramienta inventada se rechaza, y las que existen pero no participan explican por qué.");

  // ── 7) Argumentos inventados y requeridos que faltan ────────────────────────────────────
  {
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 8, incluir_sueldos: true } }] }), "pasos[0].argumentos");
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_cronograma", argumentos: { anio: 2026 } }] }), "pasos[0].argumentos");
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_cronograma", argumentos: [1, 2] }] }), "pasos[0].argumentos");
  }
  console.log("OK — 5C (7): argumentos que la herramienta no declara, requeridos ausentes y formas raras se rechazan.");

  // ── 8) SEGURIDAD · SQL, tablas, columnas y código ───────────────────────────────────────
  {
    falla(v({ objetivo: "select * from turnos_stand", pasos: [pasoFact("p1", "2026-08")] }), "el objetivo del plan");
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta; drop table reservas"], periodo: { mes: "2026-08" } } }] }), "pasos[0].argumentos");
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { fuente: ["turnero' union select 1 --"] } } }] }), "pasos[0].argumentos");
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { "fuente; delete from x": ["a"] } } }] }), "pasos[0].argumentos");
    // Campos ajenos al contrato: el plan se reconstruye desde cero.
    const plan = ok(v({ objetivo: "x", pasos: [pasoFact("p1", "2026-08")], sql: "select 1", tabla: "usuarios", formula: "a/b" } as Record<string, unknown>));
    const serial = JSON.stringify(plan).toLowerCase();
    for (const prohibido of ["sql", "tabla", "usuarios", "formula", "select"]) {
      assert.ok(!serial.includes(prohibido), `el plan validado no arrastra "${prohibido}"`);
    }
  }
  console.log("OK — 5C (8): SEGURIDAD — SQL, nombres de tablas, columnas y campos extra se rechazan o se descartan.");

  // ── 9) Máximo de pasos y de profundidad ─────────────────────────────────────────────────
  {
    const siete = Array.from({ length: MAX_PASOS + 1 }, (_, i) => pasoCron(`p${i + 1}`, (i % 12) + 1));
    falla(v({ objetivo: "x", pasos: siete }), "pasos");
    // Cadena de 4 niveles: p1 → p2 → p3 → p4.
    const cadena = [
      pasoCron("p1", 1),
      { ...pasoCron("p2", 2), dependeDe: ["p1"] },
      { ...pasoCron("p3", 3), dependeDe: ["p2"] },
      { ...pasoCron("p4", 4), dependeDe: ["p3"] },
    ];
    const e = falla(v({ objetivo: "x", pasos: cadena }), "pasos");
    assert.ok(new RegExp(String(MAX_PROFUNDIDAD)).test(e.error), "el mensaje dice cuál es el máximo de niveles");
    // Tres niveles sí entran.
    ok(v({ objetivo: "x", pasos: cadena.slice(0, 3) }));
    falla(v({ objetivo: "x", pasos: [pasoFact("p1", "2026-08")], calculos: Array.from({ length: MAX_CALCULOS + 1 }, () => ({ tipo: "diferencia", base: { paso: "p1", metrica: "a" }, comparado: { paso: "p1", metrica: "b" } })) }), "calculos");
  }
  console.log(`OK — 5C (9): topes de ${MAX_PASOS} pasos, ${MAX_PROFUNDIDAD} niveles y ${MAX_CALCULOS} cálculos.`);

  // ── 10) Deduplicación de pasos equivalentes ─────────────────────────────────────────────
  {
    const plan = ok(v({
      objetivo: "x",
      // p3 pide exactamente lo mismo que p1, con las claves en otro orden.
      pasos: [
        pasoFact("p1", "2026-08"),
        pasoFact("p2", "2026-09"),
        { id: "p3", herramienta: "consulta_analitica_interna", argumentos: { periodo: { mes: "2026-08" }, dimensiones: ["fuente"], metricas: ["facturacion_bruta"] } },
        { ...pasoCron("p4", 9), dependeDe: ["p3"] },
      ],
      calculos: [{ tipo: "diferencia", base: { paso: "p3", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } }],
    }));
    assert.equal(plan.pasos.length, 3, "el paso repetido no se ejecuta dos veces");
    assert.deepEqual(plan.deduplicados, [{ descartado: "p3", reutiliza: "p1" }]);
    assert.deepEqual(plan.pasos.find((p) => p.id === "p4")!.dependeDe, ["p1"], "la dependencia se remapea al paso que se conserva");
    assert.equal(plan.calculos[0].base.paso, "p1", "y la referencia del cálculo también");
  }
  console.log("OK — 5C (10): dos pasos que piden lo mismo se ejecutan una vez, y las dependencias y los cálculos se remapean.");

  // ── 11 y 12) Tandas: lo independiente en paralelo, lo dependiente en orden ───────────────
  {
    const plan = ok(v({
      objetivo: "x",
      pasos: [pasoFact("p1", "2026-08"), pasoFact("p2", "2026-09"), { ...pasoCron("p3", 8), dependeDe: ["p1"] }, { ...pasoCron("p4", 9), dependeDe: ["p3"] }],
    }));
    const t = tandas(plan);
    assert.equal(t.length, 3, "tres tandas: dos independientes, después p3, después p4");
    assert.deepEqual(t[0].map((p) => p.id), ["p1", "p2"], "p1 y p2 van juntos");
    assert.deepEqual(t[1].map((p) => p.id), ["p3"]);
    assert.deepEqual(t[2].map((p) => p.id), ["p4"]);
    // Un plan sin dependencias es una sola tanda.
    const plano = ok(v({ objetivo: "x", pasos: [pasoFact("p1", "2026-08"), pasoFact("p2", "2026-09"), pasoCron("p3", 8)] }));
    assert.equal(tandas(plano).length, 1);
  }
  console.log("OK — 5C (11,12): los pasos independientes quedan en una misma tanda y las dependencias se ordenan.");

  // ── 15) Matriz de compatibilidad entre universos ─────────────────────────────────────────
  {
    assert.equal(relacionEntreUniversos("facturacion", "facturacion").tipo, "permitida");
    const cruce = relacionEntreUniversos("facturacion", "actividad");
    assert.equal(cruce.tipo, "solo_descriptiva");
    assert.ok(cruce.tipo === "solo_descriptiva" && /no dividir ni restar/.test(cruce.nota));
    assert.equal(relacionEntreUniversos("equipo", "facturacion").tipo, "solo_descriptiva");
    // Las prohibiciones están declaradas y explican el motivo.
    for (const id of ["ratio_entre_universos", "atribucion_por_cronograma", "causa_sin_datos", "union_por_texto", "fechas_distintas_sin_declarar", "manual_como_demanda"]) {
      const m = motivoProhibicion(id);
      assert.ok(m && m.length > 60, `${id} está declarada con su motivo`);
    }
    assert.equal(RELACIONES_PROHIBIDAS.length, 6);
    // Un cálculo entre métricas distintas se rechaza en el plan.
    const e = falla(v({ objetivo: "x", pasos: [pasoFact("p1", "2026-08"), pasoCron("p2", 8)], calculos: [{ tipo: "diferencia", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "horas_programadas" } }] }), "calculos[0]");
    assert.ok(/MISMA m[eé]trica/.test(e.error), "explica que una diferencia va sobre la misma métrica");
    // Proyección y cierre financiero no se mezclan.
    falla(v({ objetivo: "x", pasos: [{ id: "p1", herramienta: "proyectar_periodo", argumentos: { anio: 2026, mes: 10 } }, { id: "p2", herramienta: "consultar_finanzas", argumentos: { anio: 2026, mes: 9 } }] }), "pasos");
  }
  console.log("OK — 5C (15): universos iguales se restan, distintos solo se miran lado a lado, y las seis relaciones prohibidas están declaradas.");

  // ── 17) Umbrales y base cero ────────────────────────────────────────────────────────────
  {
    assert.equal(magnitud(null), "no_calculable");
    assert.equal(magnitud(0), "estable");
    assert.equal(magnitud(-4.9), "estable");
    assert.equal(magnitud(-5), "leve");
    assert.equal(magnitud(-9.4), "leve");
    assert.equal(magnitud(-10), "clara");
    assert.equal(magnitud(-22.4), "clara");
    assert.equal(fraseMagnitud(null), "no es calculable");
    assert.equal(fraseMagnitud(-2.2), "se mantuvo estable");
    assert.equal(fraseMagnitud(-9.4), "bajó levemente");
    assert.equal(fraseMagnitud(-22.4), "bajó claramente");
    assert.equal(fraseMagnitud(31), "subió claramente");
    // La frase que se publica concuerda en número con la métrica: "los turnos bajaron", no "bajó".
    assert.equal(etiquetaEsPlural("Turnos comerciales"), true);
    assert.equal(etiquetaEsPlural("Horas programadas"), true);
    assert.equal(etiquetaEsPlural("Facturación bruta"), false);
    assert.equal(etiquetaEsPlural("Ganancia SIM"), false);
    assert.equal(fraseMagnitud(-9.4, true), "bajaron levemente");
    assert.equal(fraseMagnitud(-2.2, true), "se mantuvieron estables");
    assert.equal(fraseMagnitud(22.4, true), "subieron claramente");
    assert.equal(fraseMagnitud(null, true), "no son calculables");
    assert.equal(UMBRAL_ESTABLE_PCT, 5);
    assert.equal(UMBRAL_CLARO_PCT, 10);
    // Cambio similar: mismo signo y proporción parecida.
    assert.equal(cambioSimilar(-10, -9), true);
    assert.equal(cambioSimilar(-10, 9), false, "signos opuestos no son un cambio similar");
    assert.equal(cambioSimilar(-22.4, -2.2), false, "diez veces más no es parecido");
    assert.equal(cambioSimilar(null, -5), false);
    assert.equal(cambioSimilar(-5, 0), false);
  }
  console.log("OK — 5C (17): los umbrales son números escritos (5% estable, 10% claro) y el 'cambio similar' tiene regla propia.");

  // ── Reglas de demanda / disponibilidad ──────────────────────────────────────────────────
  {
    const caso = leerDemandaDisponibilidad(-9.4, -2.2);
    assert.equal(caso.veredicto, "compatible_menor_demanda");
    assert.ok(/no prueban la causa/.test(caso.texto), "nunca afirma la causa");
    assert.deepEqual(caso.base, { actividadPct: -9.4, disponibilidadPct: -2.2, umbralEstable: 5, umbralClaro: 10 });

    assert.equal(leerDemandaDisponibilidad(-10, -9).veredicto, "ambas_contribuyen");
    assert.equal(leerDemandaDisponibilidad(-1, -1).veredicto, "sin_cambio_relevante");
    assert.equal(leerDemandaDisponibilidad(-2, -20).veredicto, "compatible_menor_disponibilidad");
    assert.equal(leerDemandaDisponibilidad(-20, 20).veredicto, "inconcluso");
    assert.equal(leerDemandaDisponibilidad(null, -10).veredicto, "inconcluso");
    assert.equal(leerDemandaDisponibilidad(-10, null).veredicto, "inconcluso");
    for (const pct of [-30, -9, 0, 9, 30]) {
      const l = leerDemandaDisponibilidad(pct, -2);
      assert.ok(!/\bporque\b/.test(l.texto), "ninguna lectura usa 'porque'");
    }
  }
  console.log("OK — 5C: la lectura de demanda/disponibilidad sale de una regla escrita y siempre se enuncia como evidencia compatible.");

  // ── 22) Causalidad presentada como hecho ────────────────────────────────────────────────
  {
    assert.equal(afirmaCausa("La facturación cayó porque hubo menos demanda."), true);
    assert.equal(afirmaCausa("La caída se explica por la competencia."), true);
    assert.equal(afirmaCausa("Fue consecuencia de la lluvia."), true);
    assert.equal(afirmaCausa("La actividad cayó; es compatible con menor demanda, aunque los datos no prueban la causa."), false);
    assert.equal(afirmaCausa("Podría deberse a menor demanda."), false);
    assert.equal(afirmaCausa("La facturación bajó 22,4%."), false);
  }
  console.log("OK — 5C (22): una causa afirmada se detecta; una lectura relativizada no.");

  // ── 20 y 21) La síntesis se valida contra la evidencia ──────────────────────────────────
  {
    const evidencias: Evidencia[] = [
      { evidenciaId: "p1.facturacion_bruta", paso: "p1", herramienta: "consulta_analitica_interna", dominio: "Analítica interna", universo: "facturacion", metrica: "facturacion_bruta", etiqueta: "Facturación bruta", periodo: "2026-08", valor: 13_454_000, unidad: "ars", valorFormateado: "$13.454.000", criterio: "—", fuenteInterna: "Analítica interna" },
      { evidenciaId: "p2.facturacion_bruta", paso: "p2", herramienta: "consulta_analitica_interna", dominio: "Analítica interna", universo: "facturacion", metrica: "facturacion_bruta", etiqueta: "Facturación bruta", periodo: "2026-09", valor: 10_440_000, unidad: "ars", valorFormateado: "$10.440.000", criterio: "—", fuenteInterna: "Analítica interna" },
    ];
    const comparaciones: ComparacionCalculada[] = [{
      calculoId: "c1", tipo: "diferencia", metrica: "facturacion_bruta", etiqueta: "Facturación bruta", unidad: "ars", universo: "facturacion",
      base: { evidenciaId: "p1.facturacion_bruta", periodo: "2026-08", valor: 13_454_000 },
      comparado: { evidenciaId: "p2.facturacion_bruta", periodo: "2026-09", valor: 10_440_000 },
      diferencia: -3_014_000, variacionPct: -22.4, porFuente: null, huboCompensacion: false,
    }];

    // Un segundo universo para probar varias métricas en la misma oración, y un desglose por
    // fuente para probar los alias de una fuente.
    const compHoras: ComparacionCalculada = {
      calculoId: "c2", tipo: "diferencia", metrica: "horas_programadas", etiqueta: "Horas programadas", unidad: "horas", universo: "equipo",
      base: { evidenciaId: "p5.horas_programadas", periodo: "2026-08", valor: 414 },
      comparado: { evidenciaId: "p6.horas_programadas", periodo: "2026-09", valor: 405.08 },
      diferencia: -8.92, variacionPct: -2.2, porFuente: null, huboCompensacion: false,
    };
    const evHoras: Evidencia[] = [
      { ...evidencias[0], evidenciaId: "p5.horas_programadas", paso: "p5", herramienta: "consultar_cronograma", dominio: "Cronograma", universo: "equipo", metrica: "horas_programadas", etiqueta: "Horas programadas", valor: 414, unidad: "horas", valorFormateado: "414 h" },
      { ...evidencias[1], evidenciaId: "p6.horas_programadas", paso: "p6", herramienta: "consultar_cronograma", dominio: "Cronograma", universo: "equipo", metrica: "horas_programadas", etiqueta: "Horas programadas", valor: 405.08, unidad: "horas", valorFormateado: "405,08 h" },
    ];
    const compTurnos: ComparacionCalculada = {
      calculoId: "c3", tipo: "diferencia", metrica: "turnos", etiqueta: "Turnos comerciales", unidad: "turnos", universo: "actividad",
      base: { evidenciaId: "p3.turnos", periodo: "2026-08", valor: 912 },
      comparado: { evidenciaId: "p4.turnos", periodo: "2026-09", valor: 826 },
      diferencia: -86, variacionPct: -9.4, porFuente: null, huboCompensacion: false,
    };
    const evTurnos: Evidencia[] = [
      { ...evidencias[0], evidenciaId: "p3.turnos", paso: "p3", metrica: "turnos", etiqueta: "Turnos comerciales", valor: 912, unidad: "turnos", valorFormateado: "912", universo: "actividad" },
      { ...evidencias[1], evidenciaId: "p4.turnos", paso: "p4", metrica: "turnos", etiqueta: "Turnos comerciales", valor: 826, unidad: "turnos", valorFormateado: "826", universo: "actividad" },
    ];
    // La facturación con su desglose: campeonatos SUBE mientras el resto baja.
    const compFuentes: ComparacionCalculada = {
      ...comparaciones[0],
      calculoId: "c4", tipo: "delta_por_fuente", huboCompensacion: true,
      porFuente: [
        { fuente: "manuales", etiqueta: "Ingresos manuales", base: 2_950_000, comparado: 670_000, delta: -2_280_000 },
        { fuente: "turnero", etiqueta: "Turnero del stand", base: 10_258_000, comparado: 9_454_000, delta: -804_000 },
        { fuente: "campeonatos", etiqueta: "Campeonatos", base: 120_000, comparado: 240_000, delta: 120_000 },
      ],
    };
    const TODAS_EV = [...evidencias, ...evTurnos, ...evHoras];
    const TODAS_COMP = [compFuentes, compTurnos, compHoras];

    // ── Las piezas de la verificación de dirección, por separado ──────────────────────────
    {
      // El corte en cláusulas NO parte un importe ni un porcentaje: son un solo dato.
      assert.deepEqual(clausulas("la facturacion cayo $3.014.000").map((c) => c.texto), ["la facturacion cayo $3.014.000"]);
      assert.deepEqual(clausulas("vario -22,4% en el mes").map((c) => c.texto), ["vario -22,4% en el mes"]);
      // Y sí corta donde empieza otra idea: coma, punto y los conectores.
      assert.equal(clausulas("mientras las horas se mantuvieron, la facturacion cayo").length, 2);
      assert.equal(clausulas("la facturacion cayo y campeonatos subio").length, 2);
      assert.equal(clausulas("bajo. despues subio").length, 2);
      // Cada cláusula sabe dónde empieza, para ubicar el verbo dentro de ella.
      const partes = clausulas("la facturacion cayo y campeonatos subio");
      assert.equal(partes[0].inicio, 0);
      assert.ok(partes[1].inicio > 0 && partes[1].texto.startsWith("campeonatos"));

      // Los marcadores traen dirección, negación y énfasis.
      const m1 = marcadoresDe("La facturación no subió claramente.");
      assert.equal(m1.length, 1);
      assert.equal(m1[0].direccion, "subio");
      assert.equal(m1[0].negada, true);
      assert.equal(m1[0].enfasis, true);
      const m2 = marcadoresDe("Los turnos bajaron levemente.");
      assert.equal(m2[0].negada, false);
      assert.equal(m2[0].enfasis, false);
      // Un texto sin verbos de dirección no tiene marcadores.
      assert.equal(marcadoresDe("El desglose muestra cuatro fuentes.").length, 0);

      // La dirección real respeta el umbral de estabilidad antes que el signo.
      assert.equal(direccionReal({ diferencia: -3_014_000, variacionPct: -22.4 }), "bajo");
      assert.equal(direccionReal({ diferencia: 120_000, variacionPct: 100 }), "subio");
      assert.equal(direccionReal({ diferencia: -8.92, variacionPct: -2.2 }), "estable");
      assert.equal(direccionReal({ diferencia: 0, variacionPct: 0 }), "estable");
      // Sin porcentaje calculable (base cero) manda el signo de la diferencia.
      assert.equal(direccionReal({ diferencia: 50_000, variacionPct: null }), "subio");

      // Los alias salen del catálogo cuando la métrica está ahí, y de la etiqueta si no.
      assert.ok(aliasDeMetrica("facturacion_bruta", "Facturación bruta").includes("ingresos"));
      assert.ok(aliasDeMetrica("turnos", "Turnos comerciales").includes("la actividad"));
      assert.ok(aliasDeMetrica("horas_programadas", "Horas programadas").includes("disponibilidad"));
      assert.ok(aliasDeMetrica("fuente:campeonatos", "Campeonatos").includes("campeonatos"));
      // Y nunca quedan acentos ni mayúsculas, para poder ubicarlos en el texto normalizado.
      for (const a of aliasDeMetrica("facturacion_bruta", "Facturación bruta")) {
        assert.equal(a, a.toLowerCase(), "los alias se guardan en minúscula");
        assert.ok(!/[áéíóúñ]/.test(a), "los alias se guardan sin acentos");
      }

      // La lista de direcciones es cerrada y es la que va al schema de la herramienta.
      assert.deepEqual([...DIRECCIONES], ["subio", "bajo", "estable", "sin_direccion"]);
    }

    // ── Síntesis correcta, con la dirección DECLARADA ─────────────────────────────────────
    const buena = validarSintesis(
      {
        conclusion: "La facturación bajó $3.014.000 entre los dos meses.",
        afirmaciones: [
          { texto: "Septiembre cerró en $10.440.000.", metrica: "facturacion_bruta", direccion: "bajo", evidencias: ["p2.facturacion_bruta"] },
        ],
      },
      evidencias, comparaciones,
    );
    assert.equal(buena.ok, true, buena.ok ? "" : buena.motivo);
    assert.ok(buena.ok && buena.texto.includes("**La facturación bajó"));

    // Una afirmación que no habla de un cambio declara sin_direccion y no necesita métrica.
    const neutral = validarSintesis(
      { conclusion: "La facturación bajó $3.014.000.", afirmaciones: [{ texto: "Hubo fuentes que se compensaron entre sí.", direccion: "sin_direccion", evidencias: ["p1.facturacion_bruta"] }] },
      evidencias, comparaciones,
    );
    assert.equal(neutral.ok, true, neutral.ok ? "" : neutral.motivo);

    // ── 2a) La dirección DECLARADA se valida contra el dato, antes de renderizar ───────────
    {
      // Declara que subió y bajó.
      const alReves = validarSintesis(
        { conclusion: "Hubo cambios entre los dos meses.", afirmaciones: [{ texto: "La facturación se movió.", metrica: "facturacion_bruta", direccion: "subio", evidencias: ["p1.facturacion_bruta"] }] },
        evidencias, comparaciones,
      );
      assert.equal(alReves.ok, false);
      assert.ok(!alReves.ok && /subió y en realidad bajó/.test(alReves.motivo), alReves.ok ? "" : alReves.motivo);

      // Declara estable algo que cambió 22,4%.
      const falsaEstable = validarSintesis(
        { conclusion: "Hubo cambios entre los dos meses.", afirmaciones: [{ texto: "La facturación se movió poco.", metrica: "facturacion_bruta", direccion: "estable", evidencias: ["p1.facturacion_bruta"] }] },
        evidencias, comparaciones,
      );
      assert.equal(falsaEstable.ok, false);
      assert.ok(!falsaEstable.ok && /en realidad bajó/.test(falsaEstable.motivo));

      // Declara una baja donde el dato es estable (-2,2% está por debajo del umbral).
      const estableReal = validarSintesis(
        { conclusion: "Hubo cambios entre los dos meses.", afirmaciones: [{ texto: "Las horas se movieron.", metrica: "horas_programadas", direccion: "bajo", evidencias: ["p5.horas_programadas"] }] },
        evHoras, [compHoras],
      );
      assert.equal(estableReal.ok, false);
      assert.ok(!estableReal.ok && /estable/.test(estableReal.motivo) && new RegExp(String(UMBRAL_ESTABLE_PCT) + "%").test(estableReal.motivo), estableReal.ok ? "" : estableReal.motivo);

      // Un enum que no existe, y una métrica que no se comparó.
      assert.equal(validarSintesis({ conclusion: "Bajó.", afirmaciones: [{ texto: "x", metrica: "facturacion_bruta", direccion: "se_hundio", evidencias: ["p1.facturacion_bruta"] }] }, evidencias, comparaciones).ok, false);
      assert.equal(validarSintesis({ conclusion: "Bajó.", afirmaciones: [{ texto: "x", metrica: "facturacion_bruta", evidencias: ["p1.facturacion_bruta"] }] }, evidencias, comparaciones).ok, false);
      const ajena = validarSintesis({ conclusion: "Bajó.", afirmaciones: [{ texto: "x", metrica: "ganancia_sim", direccion: "bajo", evidencias: ["p1.facturacion_bruta"] }] }, evidencias, comparaciones);
      assert.equal(ajena.ok, false);
      assert.ok(!ajena.ok && /no es una métrica comparada/.test(ajena.motivo));
      // Y una dirección declarada sin métrica.
      assert.equal(validarSintesis({ conclusion: "Bajó.", afirmaciones: [{ texto: "x", direccion: "bajo", evidencias: ["p1.facturacion_bruta"] }] }, evidencias, comparaciones).ok, false);

      // La dirección declarada se valida también sobre una FUENTE del desglose.
      const fuenteOk = validarSintesis(
        { conclusion: "La facturación bajó $3.014.000.", afirmaciones: [{ texto: "Campeonatos aportó $120.000 más.", metrica: "fuente:campeonatos", direccion: "subio", evidencias: ["p1.facturacion_bruta"] }] },
        evidencias, [compFuentes],
      );
      assert.equal(fuenteOk.ok, true, fuenteOk.ok ? "" : fuenteOk.motivo);
      const fuenteMal = validarSintesis(
        { conclusion: "La facturación bajó $3.014.000.", afirmaciones: [{ texto: "Campeonatos aportó menos.", metrica: "fuente:campeonatos", direccion: "bajo", evidencias: ["p1.facturacion_bruta"] }] },
        evidencias, [compFuentes],
      );
      assert.equal(fuenteMal.ok, false);
      assert.ok(!fuenteMal.ok && /en realidad subió/.test(fuenteMal.motivo));
    }

    // ── 2b) La PROSA: varias métricas, orden inverso, negación, umbrales y alias ───────────
    {
      const ok = (texto: string) => validarSintesis({ conclusion: texto }, TODAS_EV, TODAS_COMP);
      const esperarOk = (texto: string, por: string) => {
        const r = ok(texto);
        assert.equal(r.ok, true, por + " → " + (r.ok ? "" : r.motivo));
      };
      const esperarRechazo = (texto: string, patron: RegExp, por: string) => {
        const r = ok(texto);
        assert.equal(r.ok, false, por + ": tendría que rechazarse");
        assert.ok(!r.ok && patron.test(r.motivo), por + " → motivo inesperado: " + (r.ok ? "" : r.motivo));
      };

      // Dos métricas con direcciones DISTINTAS en la misma oración: campeonatos sube, la
      // facturación baja. Cada verbo se atribuye a lo que nombra más cerca.
      esperarOk(
        "La facturación cayó $3.014.000 y Campeonatos subió $120.000.",
        "dos direcciones distintas en una oración",
      );
      esperarRechazo(
        "La facturación subió $3.014.000 y Campeonatos cayó $120.000.",
        /facturación bruta subió y en realidad bajó/,
        "las dos direcciones invertidas",
      );
      // Tres métricas, tres direcciones.
      esperarOk(
        "La facturación cayó, los turnos bajaron y las horas programadas se mantuvieron casi iguales.",
        "tres métricas en una oración",
      );

      // CLÁUSULAS EN ORDEN INVERSO: el sujeto después del verbo, y la métrica estable primero.
      esperarOk(
        "Mientras las horas programadas se mantuvieron estables, la facturación cayó claramente.",
        "orden inverso de cláusulas",
      );
      esperarRechazo(
        "Mientras las horas programadas cayeron claramente, la facturación se mantuvo estable.",
        /horas programadas|facturación bruta/,
        "orden inverso con las dos direcciones mal",
      );

      // "NO SUBIÓ" y "NO CAYÓ": la negación invierte lo que se afirma.
      esperarOk("La facturación no subió entre los dos meses.", "'no subió' sobre algo que bajó");
      esperarRechazo("La facturación no cayó entre los dos meses.", /no bajó y los datos muestran que sí/, "'no cayó' sobre algo que cayó");
      esperarOk("Campeonatos no cayó.", "'no cayó' sobre algo que subió");
      esperarRechazo("Campeonatos no subió.", /no subió y los datos muestran que sí/, "'no subió' sobre algo que subió");
      esperarOk("Las horas programadas tampoco bajaron de forma apreciable.", "'tampoco bajaron' sobre algo estable");

      // "SE MANTUVO ESTABLE" contra el umbral publicado.
      esperarOk("Las horas programadas se mantuvieron estables.", "estable de verdad (-2,2%)");
      esperarRechazo(
        "La facturación se mantuvo estable.",
        new RegExp("se mantuvo estable.*" + String(UMBRAL_ESTABLE_PCT) + "%"),
        "estabilidad falsa (-22,4%)",
      );

      // "CAYÓ CLARAMENTE" contra el umbral de cambio claro.
      esperarOk("La facturación cayó claramente.", "-22,4% sí es un cambio claro");
      esperarRechazo(
        "Los turnos cayeron fuertemente.",
        new RegExp("no llega al " + String(UMBRAL_CLARO_PCT) + "%"),
        "-9,4% no llega al umbral de cambio claro",
      );
      esperarOk("Los turnos cayeron levemente.", "-9,4% sin énfasis");

      // ALIAS: el administrador no usa la etiqueta exacta.
      esperarOk("Los ingresos cayeron $3.014.000.", "alias 'ingresos' de facturacion_bruta");
      esperarOk("La actividad bajó 86 turnos.", "alias 'la actividad' de turnos");
      esperarOk("La disponibilidad se mantuvo estable.", "alias 'disponibilidad' de horas_programadas");
      esperarRechazo("La actividad subió 86 turnos.", /turnos comerciales subió y en realidad bajó/, "alias con la dirección mal");
      // Un alias largo gana sobre uno corto que también matchea.
      esperarOk("Los ingresos manuales cayeron $2.280.000.", "'ingresos manuales' es la fuente, no 'ingresos'");

      // UNA CIFRA CORRECTA CON EL VERBO EQUIVOCADO: el número pasa, la dirección no.
      const cifraBienVerboMal = ok("La facturación subió 22,4%.");
      assert.equal(cifraBienVerboMal.ok, false, "22,4% sale de la evidencia pero el verbo miente");
      assert.ok(!cifraBienVerboMal.ok && /subió y en realidad bajó/.test(cifraBienVerboMal.motivo));
      // Y la misma cifra con el verbo correcto sí pasa.
      esperarOk("La facturación bajó 22,4%.", "la misma cifra con el verbo correcto");

      // SIN MÉTRICA CERCA: no se puede verificar, así que no se publica (fallback determinístico).
      esperarRechazo("Todo bajó bastante este mes.", /sin decir de qué métrica/, "un cambio sin sujeto");
      esperarRechazo(
        "La facturación cayó $3.014.000. " + "Lo demás ".repeat(20) + "también subió.",
        /sin decir de qué métrica/,
        "un sujeto demasiado lejos del verbo",
      );
      // Un texto sin ningún verbo de dirección no necesita sujeto.
      esperarOk("El desglose por fuente muestra cuatro fuentes con pesos distintos.", "sin verbos de dirección");
    }

    // ── Número inventado, causa, evidencia fantasma, ids internos ─────────────────────────
    const inventado = validarSintesis({ conclusion: "La facturación bajó $9.999.999." }, evidencias, comparaciones);
    assert.equal(inventado.ok, false);
    assert.ok(!inventado.ok && /no sale de la evidencia/.test(inventado.motivo));

    const causal = validarSintesis({ conclusion: "Bajó $3.014.000 porque hubo menos demanda." }, evidencias, comparaciones);
    assert.equal(causal.ok, false);
    assert.ok(!causal.ok && /causa/.test(causal.motivo));

    const fantasma = validarSintesis({ conclusion: "Bajó.", afirmaciones: [{ texto: "Algo pasó.", direccion: "sin_direccion", evidencias: ["p9.inventada"] }] }, evidencias, comparaciones);
    assert.equal(fantasma.ok, false);

    const sinCita = validarSintesis({ conclusion: "Bajó.", afirmaciones: [{ texto: "Algo pasó.", direccion: "sin_direccion", evidencias: [] }] }, evidencias, comparaciones);
    assert.equal(sinCita.ok, false);

    assert.equal(validarSintesis({ conclusion: "" }, evidencias, comparaciones).ok, false);
    assert.equal(validarSintesis({ conclusion: "Bajó.", afirmaciones: Array.from({ length: MAX_AFIRMACIONES + 1 }, () => ({ texto: "x", direccion: "sin_direccion", evidencias: ["p1.facturacion_bruta"] })) }, evidencias, comparaciones).ok, false);
    assert.equal(validarSintesis({ conclusion: "Según p1.facturacion_bruta bajó." }, evidencias, comparaciones).ok, false);
    assert.equal(validarSintesis({ conclusion: 'Resultado: {"total": 1}.' }, evidencias, comparaciones).ok, false);

    // Un valor redondeado del MISMO dato sí se acepta; una magnitud distinta no.
    assert.equal(validarSintesis({ conclusion: "La variación de la facturación fue de -22,4%." }, evidencias, comparaciones).ok, true);
    assert.equal(validarSintesis({ conclusion: "La variación de la facturación fue de -31,5%." }, evidencias, comparaciones).ok, false);
  }
  console.log("OK — 5C (20,21,22): la síntesis declara métrica y dirección con enums validados contra el dato, y la prosa se revisa aparte (varias métricas, orden inverso, negación, umbrales, alias, cifra correcta con verbo malo y fallback sin métrica cerca).");

  // ── 29 y 30) Complejidad y selección de modelo ──────────────────────────────────────────
  {
    const multi = clasificarComplejidad("Compará agosto y septiembre de 2026. Decime cómo cambiaron la facturación bruta total, los turnos comerciales y las horas programadas. Después identificá qué fuentes explican la variación de facturación y decime si la diferencia parece relacionarse más con menor demanda o con menor disponibilidad.");
    assert.equal(multi.complejidad, "multiherramienta");
    assert.equal(multi.clase, "potente");
    assert.ok(multi.senales.some((s) => s.startsWith("dom:")) && multi.senales.some((s) => s.startsWith("multi:")));

    for (const q of [
      "¿Qué fuentes explican la diferencia de facturación entre dos meses?",
      "¿La caída de facturación coincidió con menos actividad o solamente con menos ingresos manuales?",
      "¿Los días con más horas programadas también tuvieron más turnos?",
      "¿Por qué septiembre rindió distinto de agosto según nuestros datos?",
    ]) {
      assert.equal(clasificarComplejidad(q).complejidad, "multiherramienta", `"${q}" es multiherramienta`);
    }

    // Lo que resuelve 5B NO escala.
    for (const q of [
      "¿Cuánto facturamos en agosto?",
      "Separame la facturación de agosto entre semana y fin de semana.",
      "Mostrame los cinco mejores días de septiembre.",
      "¿Cuál fue el método de pago más utilizado?",
    ]) {
      const d = clasificarComplejidad(q);
      assert.notEqual(d.complejidad, "multiherramienta", `"${q}" no debería escalar`);
      assert.equal(d.clase, "economico", `"${q}" sigue con el modelo económico`);
    }
    assert.equal(clasificarComplejidad("hola").complejidad, "simple");

    // Fallback de modelo.
    assert.deepEqual(claseEfectiva("potente", { economico: "eco", potente: "pot" }), { clase: "potente", degradado: false });
    assert.deepEqual(claseEfectiva("potente", { economico: "eco", potente: "" }), { clase: "economico", degradado: true });
    assert.deepEqual(claseEfectiva("economico", { economico: "", potente: "pot" }), { clase: "potente", degradado: true });
  }
  console.log("OK — 5C (29,30): la complejidad se clasifica con señales auditables, 5B no escala y hay fallback si falta el modelo pedido.");

  // ── 25, 26, 27, 28) Contexto conversacional ─────────────────────────────────────────────
  {
    // Una conversación nueva no tiene contexto.
    assert.equal(contextoDesdeAnalisis(null), null);
    assert.equal(contextoDesdeAnalisis({ ok: false }), null);
    assert.equal(pistaDeContexto(null), null);

    // Contexto desde un análisis simple de 5B.
    const ctx5b = contextoDesdeAnalisis({
      ok: true,
      ventana: { desde: "2026-08-01", hasta: "2026-08-31" },
      metricas: [{ id: "facturacion_bruta" }],
      filtros: { diasSemana: [1, 2, 3, 4, 5], fuentes: null },
      dimensiones: ["semana"],
    });
    assert.ok(ctx5b);
    assert.deepEqual(ctx5b!.periodos, ["2026-08-01..2026-08-31"]);
    assert.deepEqual(ctx5b!.metricas, ["facturacion_bruta"]);
    assert.deepEqual(ctx5b!.dimensiones, ["semana"]);
    // El filtro se guarda con su nombre PÚBLICO (el del contrato), no con el interno del plan
    // resuelto: si el modelo reusa lo que lee, tiene que poder escribirlo como argumento válido.
    assert.deepEqual(ctx5b!.filtros.dias_semana, ["1", "2", "3", "4", "5"]);
    assert.equal(ctx5b!.filtros.diasSemana, undefined, "el nombre interno no se publica");

    // Nada de razonamiento ni de datos personales entra al contexto.
    const sucio = contextoDesdeAnalisis({ ok: true, ventana: { desde: "2026-08-01", hasta: "2026-08-31" }, metricas: [], filtros: { razonamiento: "pensé que…", email: "a@b.c", diasSemana: [6, 7] }, dimensiones: [] });
    assert.ok(sucio && !("razonamiento" in sucio.filtros) && !("email" in sucio.filtros), "los campos prohibidos no se guardan");

    // La pista explica que lo nuevo reemplaza.
    const pista = pistaDeContexto(ctx5b);
    assert.ok(pista && /REEMPLAZA/.test(pista) && /pregunt[áa]/.test(pista));

    // Herencia: lo nuevo reemplaza, lo no mencionado se mantiene, y un filtro vaciado se saca.
    const base = { ...CONTEXTO_VACIO, periodos: ["2026-08"], metricas: ["facturacion_bruta"], filtros: { diasSemana: ["1", "2", "3", "4", "5"] }, dimensiones: ["semana"] };
    const conFinde = heredar(base, { filtros: { diasSemana: ["6", "7"] } });
    assert.deepEqual(conFinde.filtros.diasSemana, ["6", "7"], "el filtro nuevo reemplaza al viejo");
    assert.deepEqual(conFinde.periodos, ["2026-08"], "el período no mencionado se mantiene");
    const otroPeriodo = heredar(base, { periodos: ["2026-09"] });
    assert.deepEqual(otroPeriodo.periodos, ["2026-09"], "un período nuevo reemplaza al anterior");
    assert.deepEqual(otroPeriodo.filtros.diasSemana, ["1", "2", "3", "4", "5"], "y el filtro se hereda");
    const sinFiltro = heredar(base, { filtros: { diasSemana: [] } });
    assert.equal(sinFiltro.filtros.diasSemana, undefined, "vaciar un filtro lo saca");
  }
  console.log("OK — 5C (25,26,27,28): el contexto guarda solo la forma estructurada, lo nuevo reemplaza, lo vaciado se saca y una conversación nueva arranca sin nada.");

  // ── El catálogo de capacidades es coherente ─────────────────────────────────────────────
  {
    assert.ok(CAPACIDADES_IDS.length >= 5);
    for (const id of CAPACIDADES_IDS) {
      const c = CAPACIDADES[id];
      assert.equal(c.id, id);
      assert.ok(c.dominio && c.descripcion.length > 20, `${id} declara dominio y descripción`);
      assert.ok(UNIVERSOS_PLAN[c.universo], `${id} declara un universo real`);
      assert.equal(c.web, "prohibida", `${id} no puede salir a internet`);
      assert.ok(["estructurada", "texto"].includes(c.salida));
      assert.ok([1, 2, 3].includes(c.costo));
      assert.equal(typeof c.paralelizable, "boolean");
      assert.ok(["ninguno", "nombres_equipo", "documental"].includes(c.datosSensibles));
    }
    // Ninguna capacidad y ninguna exclusión se solapan.
    for (const id of Object.keys(FUERA_DEL_PLANIFICADOR)) {
      assert.ok(!CAPACIDADES_IDS.includes(id), `${id} no puede estar en las dos listas`);
    }
    assert.deepEqual([...CALCULOS_PLAN_IDS].sort(), ["delta_por_fuente", "diferencia", "variacion_pct"]);
    assert.ok(PRESENTACIONES.length >= 3);
  }
  console.log("OK — 5C: cada capacidad declara dominio, universo, salida, costo, paralelismo, datos sensibles y política de web.");

  console.log("\nOK — planificador 5C (puro): plan cerrado y acíclico, matriz de compatibilidad, umbrales escritos, síntesis validada contra evidencia y contexto aislado.");
}
main();
