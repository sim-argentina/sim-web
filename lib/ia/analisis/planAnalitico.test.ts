import { strict as assert } from "node:assert";
import { validarPlan, LIMITE_DEFAULT, LIMITE_MAX, RANGO_MAX_DIAS, MAX_METRICAS, MAX_DIMENSIONES } from "@/lib/ia/analisis/planAnalitico";
import { METRICAS_IDS, DIMENSIONES_VALIDAS, CALCULOS_VALIDOS, FILTROS_VALIDOS, METRICAS_SEMANTICAS } from "@/lib/ia/analisis/catalogoSemantico";
import { FUENTES_FACTURACION } from "@/lib/facturacionFuentes";

// Ejecutar: npx tsx lib/ia/analisis/planAnalitico.test.ts — puro.
//
// Bloque 5B — el plan es la ÚNICA superficie por la que el modelo llega a los datos. Acá se
// verifica que siga siendo un contrato cerrado —sin SQL, sin tablas, sin columnas, sin fórmulas
// del modelo— ahora que admite varias métricas, dos dimensiones, cálculos y segmentación.

const ok = (x: ReturnType<typeof validarPlan>) => {
  assert.equal(x.ok, true, x.ok ? "" : `esperaba plan válido y falló: ${x.error}`);
  return (x as Extract<typeof x, { ok: true }>).plan;
};
const falla = (x: ReturnType<typeof validarPlan>, campo?: string) => {
  assert.equal(x.ok, false, "esperaba un plan RECHAZADO");
  const e = x as Extract<typeof x, { ok: false }>;
  assert.ok(e.error && e.error.length > 0, "el rechazo trae un mensaje accionable");
  if (campo) assert.equal(e.campo, campo);
  return e;
};

function main() {
  // ── 1) El contrato nuevo ────────────────────────────────────────────────────────────────
  {
    const plan = ok(validarPlan({
      metricas: ["facturacion_bruta"],
      periodo: { mes: "2026-08" },
      filtros: { dias_semana: ["habiles"] },
      dimensiones: ["semana"],
      calculos: ["promedio_dia_calendario", "participacion"],
    }));
    assert.deepEqual(plan.metricas, ["facturacion_bruta"]);
    assert.equal(plan.universo, "facturacion");
    assert.deepEqual(plan.ventana, { desde: "2026-08-01", hasta: "2026-08-31" });
    assert.deepEqual(plan.filtros.diasSemana, [1, 2, 3, 4, 5], '"habiles" se expande a lunes-viernes');
    assert.deepEqual(plan.dimensiones, ["semana"]);
    assert.ok(plan.calculos.includes("total"), "el total va siempre");
    assert.ok(plan.calculos.includes("promedio_dia_calendario") && plan.calculos.includes("participacion"));
    assert.equal(plan.orden, "cronologico", "una dimensión temporal ordena cronológicamente por defecto");
    assert.equal(plan.limite, LIMITE_DEFAULT);
    assert.equal(plan.segmentacion, null);
    assert.equal(plan.ranking, null);
  }
  console.log("OK — 5B (1): contrato nuevo con varias métricas, dimensiones, cálculos y atajos de días.");

  // ── Varias métricas del mismo universo, y dos dimensiones ───────────────────────────────
  {
    const plan = ok(validarPlan({
      metricas: ["turnos", "personas", "minutos_actividad"],
      periodo: { mes: "2026-08" },
      dimensiones: ["dia_semana", "fuente"],
    }));
    assert.equal(plan.metricas.length, 3);
    assert.equal(plan.universo, "actividad");
    assert.deepEqual(plan.dimensiones, ["dia_semana", "fuente"]);
    assert.equal(plan.orden, "mayor_a_menor", "sin dimensión temporal ordena por valor");
  }
  console.log("OK — 5B: tres métricas de actividad agrupadas por dos dimensiones compatibles.");

  // ── 2) Métricas, dimensiones y filtros inventados ───────────────────────────────────────
  {
    falla(validarPlan({ metricas: ["facturacion_arcoiris"], periodo: { mes: "2026-08" } }), "metricas");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["color_del_simulador"] }), "dimensiones");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { humor_del_cliente: ["bueno"] } }), "filtros");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, calculos: ["regresion_lineal"] }), "calculos");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "signo_zodiacal", grupo_a: ["a"], grupo_b: ["b"] } }), "segmentacion.tipo");
  }
  console.log("OK — 5B (2): métricas, dimensiones, filtros, cálculos y segmentaciones inventadas se rechazan.");

  // ── 3) SEGURIDAD · SQL, tablas, columnas y campos de más ────────────────────────────────
  {
    falla(validarPlan({ metricas: ["facturacion_bruta; DROP TABLE turnos_stand"], periodo: { mes: "2026-08" } }), "metricas");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08' UNION SELECT * FROM usuarios --" } }), "periodo.mes");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["fuente; DELETE FROM reservas"] }), "dimensiones");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { metodo_pago: ["efectivo' OR 1=1--"] } }), "filtros.metodo_pago");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { fuente: ["turnos_stand"] } }), "filtros.fuente");

    // Campos ajenos al contrato: el plan se reconstruye desde cero, no se copia el input.
    const plan = ok(validarPlan({
      metricas: ["facturacion_bruta"],
      periodo: { mes: "2026-08" },
      tabla: "usuarios",
      columnas: ["email", "telefono"],
      sql: "select * from pagos",
      where: "1=1",
      formula: "facturacion / operaciones",
    } as Record<string, unknown>));
    const serializado = JSON.stringify(plan).toLowerCase();
    for (const prohibido of ["tabla", "columna", "sql", "where", "usuarios", "select", "email", "formula"]) {
      assert.ok(!serializado.includes(prohibido), `el plan validado no arrastra "${prohibido}"`);
    }
  }
  console.log("OK — 5B (3): SEGURIDAD — SQL, nombres de tablas/columnas, fórmulas y campos extra se descartan.");

  // ── 4) MATRIZ DE COMPATIBILIDAD ─────────────────────────────────────────────────────────
  {
    // No se mezclan universos: eso es lo que evita el "ticket promedio" inventado.
    const e = falla(validarPlan({ metricas: ["facturacion_bruta", "operaciones"], periodo: { mes: "2026-08" } }), "metricas");
    assert.ok(/no se pueden combinar/i.test(e.error), "explica por qué no se pueden combinar");

    // Y la métrica inventada "ticket_promedio" deriva con una explicación, no con un error seco.
    const t = falla(validarPlan({ metricas: ["ticket_promedio"], periodo: { mes: "2026-08" } }), "metricas");
    assert.ok(/universos/i.test(t.error), "dice que cruzaría dos universos distintos");

    // Dimensiones y filtros que no aplican al universo de la métrica.
    falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, dimensiones: ["metodo_pago"] }), "dimensiones");
    falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, dimensiones: ["clase"] }), "dimensiones");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["modalidad"] }), "dimensiones");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["duracion"] }), "dimensiones");
    falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, filtros: { metodo_pago: ["efectivo"] } }), "filtros.metodo_pago");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { modalidad: ["v2_10"] } }), "filtros.modalidad");

    // Dos dimensiones temporales juntas no aportan.
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["dia", "semana"] }), "dimensiones");

    // Cálculos sin el contexto que necesitan.
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, calculos: ["participacion"] }), "calculos");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, calculos: ["diferencia"] }), "calculos");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, ranking: { sentido: "mejores", n: 5 } }), "ranking");

    // Y las combinaciones que SÍ son compatibles pasan.
    ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["dia"], calculos: ["participacion"], ranking: { sentido: "mejores", n: 5 } }));
    ok(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, dimensiones: ["duracion", "fuente"], filtros: { modalidad: ["v2_10"] } }));
  }
  console.log("OK — 5B (4): la matriz de compatibilidad bloquea universos mezclados, dimensiones y filtros ajenos, dos dimensiones temporales y cálculos sin contexto.");

  // ── Empleados: no se inventa una atribución ─────────────────────────────────────────────
  {
    for (const clave of ["empleado", "integrante", "vendedor", "persona"]) {
      const e = falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { [clave]: ["Federico"] } }), "filtros.empleado");
      assert.ok(/cronograma/i.test(e.error), "explica que estar en el cronograma no demuestra la venta");
      assert.ok(/consultar_metricas_equipo|consultar_cronograma/.test(e.error), "ofrece qué SÍ se puede responder");
    }
  }
  console.log("OK — 5B: preguntar por un empleado no atribuye ventas; se explica y se ofrece el análisis válido.");

  // ── 5) Máximos ──────────────────────────────────────────────────────────────────────────
  {
    falla(validarPlan({ metricas: ["turnos", "personas", "operaciones", "minutos_actividad"], periodo: { mes: "2026-08" } }), "metricas");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["dia", "fuente", "metodo_pago"] }), "dimensiones");
    assert.equal(ok(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, limite: LIMITE_MAX })).limite, LIMITE_MAX);
    falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, limite: LIMITE_MAX + 1 }), "limite");
    falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, limite: 0 }), "limite");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { desde: "2020-01-01", hasta: "2026-12-31" } }), "periodo");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["dia"], ranking: { sentido: "mejores", n: LIMITE_MAX + 1 } }), "ranking.n");
    assert.equal(MAX_METRICAS, 3);
    assert.equal(MAX_DIMENSIONES, 2);
    // El borde exacto del rango máximo entra.
    const hasta = new Date(Date.UTC(2025, 0, 1) + (RANGO_MAX_DIAS - 1) * 86_400_000).toISOString().slice(0, 10);
    ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { desde: "2025-01-01", hasta } }));
  }
  console.log(`OK — 5B (5): topes de ${MAX_METRICAS} métricas, ${MAX_DIMENSIONES} dimensiones, ${LIMITE_MAX} filas y ${RANGO_MAX_DIAS} días.`);

  // ── 6) Fechas relativas en Córdoba, con reloj inyectado ─────────────────────────────────
  {
    const ahora = new Date("2026-08-19T15:00:00Z"); // miércoles 19/08/2026 en Córdoba
    const v = (relativo: string) => ok(validarPlan({ metricas: ["turnos"], periodo: { relativo } }, ahora)).ventana;
    assert.deepEqual(v("este_mes"), { desde: "2026-08-01", hasta: "2026-08-31" });
    assert.deepEqual(v("mes_pasado"), { desde: "2026-07-01", hasta: "2026-07-31" });
    assert.deepEqual(v("mismo_mes_anio_pasado"), { desde: "2025-08-01", hasta: "2025-08-31" });
    assert.equal(v("esta_semana").desde, "2026-08-17", "la semana arranca el lunes");
    assert.equal(v("semana_pasada").desde, "2026-08-10");
    assert.equal(v("hoy").desde, "2026-08-19");
    assert.equal(v("ayer").desde, "2026-08-18");
    assert.deepEqual(v("este_anio"), { desde: "2026-01-01", hasta: "2026-08-19" }, "el año en curso llega hasta hoy, no hasta diciembre");
    falla(validarPlan({ metricas: ["turnos"], periodo: { relativo: "la_semana_que_viene" } }, ahora), "periodo.relativo");
  }
  console.log("OK — 5B (6): los períodos relativos se resuelven con el reloj de Córdoba del servidor.");

  // ── 7) Semanas parciales: el período se respeta tal cual se pidió ───────────────────────
  {
    // Un rango que arranca y termina a mitad de semana no se estira al lunes ni al domingo.
    const plan = ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { desde: "2026-08-05", hasta: "2026-08-18" }, dimensiones: ["semana"] }));
    assert.deepEqual(plan.ventana, { desde: "2026-08-05", hasta: "2026-08-18" });
  }
  console.log("OK — 5B (7): el período pedido no se redondea a semanas completas.");

  // ── 8 y 9) Lunes a viernes, sábados y domingos ──────────────────────────────────────────
  {
    for (const forma of [["habiles"], ["entre_semana"], [1, 2, 3, 4, 5], ["lunes", "martes", "miércoles", "jueves", "viernes"]]) {
      assert.deepEqual(ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: forma } })).filtros.diasSemana, [1, 2, 3, 4, 5], `"${JSON.stringify(forma)}" son los días hábiles`);
    }
    for (const forma of [["fin_de_semana"], ["finde"], [6, 7], ["sábado", "domingo"], ["sabado", "domingo"]]) {
      assert.deepEqual(ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: forma } })).filtros.diasSemana, [6, 7], `"${JSON.stringify(forma)}" es el fin de semana`);
    }
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: ["feriados"] } }), "filtros.dias_semana");
  }
  console.log("OK — 5B (8,9): 'habiles', 'entre_semana', nombres y números ISO dan lo mismo; igual para el fin de semana.");

  // ── Segmentación ────────────────────────────────────────────────────────────────────────
  {
    const plan = ok(validarPlan({
      metricas: ["facturacion_bruta"],
      periodo: { mes: "2026-08" },
      segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["fin_de_semana"] },
      calculos: ["promedio_dia_calendario", "maximo", "diferencia", "variacion_pct"],
    }));
    assert.equal(plan.segmentacion!.tipo, "dias_semana");
    assert.deepEqual(plan.segmentacion!.grupoA, ["1", "2", "3", "4", "5"]);
    assert.deepEqual(plan.segmentacion!.grupoB, ["6", "7"]);
    assert.equal(plan.segmentacion!.etiquetaA, "Lunes a viernes");
    assert.equal(plan.segmentacion!.etiquetaB, "Sábados y domingos");

    const porClase = ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "clase", grupo_a: ["automatico"], grupo_b: ["manual"] } }));
    assert.equal(porClase.segmentacion!.etiquetaA, "Automático");

    const dosDias = ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "dias_semana", grupo_a: ["lunes"], grupo_b: ["viernes"] } }));
    assert.equal(dosDias.segmentacion!.etiquetaA, "Lunes");
    assert.equal(dosDias.segmentacion!.etiquetaB, "Viernes");

    // Grupos que se solapan contarían dos veces: se rechaza.
    const e = falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["viernes"] } }), "segmentacion");
    assert.ok(/dos veces/.test(e.error), "explica el riesgo de contar dos veces");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"] } }), "segmentacion");
    // Segmentar por clase no aplica a actividad.
    falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, segmentacion: { tipo: "clase", grupo_a: ["automatico"], grupo_b: ["manual"] } }), "segmentacion.tipo");
  }
  console.log("OK — 5B: segmentación por días, por clase y entre dos días; los grupos solapados se rechazan.");

  // ── Aclaraciones: una sola pregunta concreta, no un error técnico ────────────────────────
  {
    const sinMetrica = falla(validarPlan({ periodo: { mes: "2026-08" } }), "metricas");
    assert.equal(sinMetrica.aclaracion, true, "sin métrica se PIDE una aclaración");
    assert.ok(sinMetrica.error.includes("¿Qué querés medir?"), "y la pregunta es concreta");

    const sinPeriodo = falla(validarPlan({ metricas: ["facturacion_bruta"] }), "periodo");
    assert.equal(sinPeriodo.aclaracion, true);
    assert.ok(sinPeriodo.error.includes("¿De qué período?"));

    // "¿Cuál fue el mejor?" — sin métrica ni período: lo primero que falta es la métrica.
    const elMejor = falla(validarPlan({ calculos: ["maximo"] }));
    assert.equal(elMejor.aclaracion, true);

    // Un rechazo por incompatibilidad NO es una aclaración: el modelo puede repararlo solo.
    const incompatible = falla(validarPlan({ metricas: ["turnos"], periodo: { mes: "2026-08" }, dimensiones: ["metodo_pago"] }));
    assert.notEqual(incompatible.aclaracion, true, "una incompatibilidad se repara, no se pregunta");
    assert.ok(!/error|exception|sql|undefined/i.test(incompatible.error), "el mensaje no es técnico");
  }
  console.log("OK — 5B: falta de métrica o período pide UNA aclaración concreta; una incompatibilidad se devuelve como reparable.");

  // ── Ranking ─────────────────────────────────────────────────────────────────────────────
  {
    const plan = ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-09" }, dimensiones: ["dia"], ranking: { sentido: "mejores", n: 5 } }));
    assert.deepEqual(plan.ranking, { sentido: "mejores", n: 5 });
    assert.ok(plan.calculos.includes("ranking"));
    assert.equal(ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-09" }, dimensiones: ["dia"], ranking: {} })).ranking!.n, 5, "por defecto son 5");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-09" }, dimensiones: ["dia"], ranking: { sentido: "regulares" } }), "ranking.sentido");
  }
  console.log("OK — 5B: ranking de mejores y peores, con tamaño por defecto y sentido validado.");

  // ── Derivaciones a la herramienta correcta ──────────────────────────────────────────────
  {
    for (const [m, esperado] of [
      ["facturacion_neta", "consultar_finanzas"],
      ["ganancia", "consultar_finanzas"],
      ["rentabilidad", "consultar_finanzas"],
      ["horas_cronograma", "consultar_metricas_equipo"],
      ["horas_trabajadas", "consultar_metricas_equipo"],
      ["ocupacion", "Finanzas"],
    ] as const) {
      const e = falla(validarPlan({ metricas: [m], periodo: { mes: "2026-08" } }), "metricas");
      assert.ok(e.error.includes(esperado), `"${m}" deriva a ${esperado}`);
    }
  }
  console.log("OK — 5B: neta, ganancia, rentabilidad, horas de cronograma y ocupación derivan a su herramienta, sin inventar una fórmula.");

  // ── El catálogo está completo y coherente ───────────────────────────────────────────────
  {
    assert.ok(METRICAS_IDS.length >= 7, "hay al menos siete métricas declaradas");
    for (const id of METRICAS_IDS) {
      const d = METRICAS_SEMANTICAS[id];
      assert.ok(d.definicion.length > 40, `${id} declara su definición de negocio`);
      assert.ok(d.reglaTemporal.length > 10, `${id} declara su regla temporal`);
      assert.ok(d.dimensiones.length > 0, `${id} declara dimensiones compatibles`);
      assert.ok(d.filtros.length > 0, `${id} declara filtros compatibles`);
      assert.ok(d.unidad.length > 0 && d.universo.length > 0, `${id} declara unidad y universo`);
      assert.equal(d.ceros, "cuentan_como_cero", `${id} declara cómo trata los ceros`);
      for (const dim of d.dimensiones) assert.ok(DIMENSIONES_VALIDAS.includes(dim), `la dimensión ${dim} de ${id} existe`);
      for (const f of d.filtros) assert.ok(FILTROS_VALIDOS.includes(f), `el filtro ${f} de ${id} existe`);
    }
    assert.ok(CALCULOS_VALIDOS.includes("promedio_dia_calendario") && CALCULOS_VALIDOS.includes("participacion") && CALCULOS_VALIDOS.includes("variacion_pct"));
    // Ninguna métrica puede mencionar la identidad de un simulador.
    for (const id of METRICAS_IDS) {
      assert.ok(!/simulador\s*(1|2|3|4|a|b)\b/i.test(METRICAS_SEMANTICAS[id].definicion), "los simuladores son recursos equivalentes: no se los identifica");
    }
    // Las fuentes de facturación que admite el filtro son las del catálogo canónico.
    const plan = ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { fuente: [...FUENTES_FACTURACION] } }));
    assert.equal(plan.filtros.fuentes!.length, FUENTES_FACTURACION.length);
  }
  console.log("OK — 5B: cada métrica declara definición, unidad, universo, regla temporal, dimensiones, filtros y tratamiento de ceros.");

  // ── Rangos y fechas inválidas ───────────────────────────────────────────────────────────
  {
    ok(validarPlan({ metricas: ["facturacion_bruta"], periodo: { desde: "2026-08-01", hasta: "2026-09-15" } }));
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { desde: "2026-08-31", hasta: "2026-08-01" } }), "periodo");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { desde: "2026-02-30", hasta: "2026-03-01" } }), "periodo");
    falla(validarPlan({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-13" } }), "periodo.mes");
  }
  console.log("OK — 5B: rango invertido, fecha inexistente y mes fuera de rango se rechazan.");

  console.log("\nOK — plan analítico 5B (puro): capa semántica cerrada, validada contra el catálogo y reconstruida desde cero.");
}
main();
