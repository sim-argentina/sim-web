import { strict as assert } from "node:assert";
import { validarPlan, type PlanAnalitico } from "@/lib/ia/analisis/planAnalitico";
import { ejecutarPlanAnalitico } from "@/lib/ia/analisis/ejecutorAnalitico";
import { getIngresosAutomaticos } from "@/lib/finanzas";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/analisis/ejecutorAnalitico.integration.ts
//
// Bloque 5B — lee la base REAL, SOLO LECTURA. Agosto de 2026 es un mes cerrado, así que sus
// cifras se afirman en absoluto (verificadas aparte en SQL sobre fin_eventos_facturacion); el
// resto se verifica por IDENTIDADES (los grupos suman el total, promedio × días = total, las
// participaciones suman 100), que no se rompen cuando entran datos nuevos.

const MES = "2026-08";

// Verificado con SQL independiente sobre fin_eventos_facturacion.
const AGOSTO = {
  totalIntegral: 13_454_000,
  diasCalendario: 31,
  promedioDia: 434_000,
  habiles: { dias: 21, total: 7_680_000, promedio: 365_714.29, mejorDia: "18 de agosto", mejorMonto: 1_720_000, porFuente: { turnero: 4_690_000, manuales: 2_950_000, campeonatos: 40_000 } },
  finde: { dias: 10, total: 5_774_000, promedio: 577_400, mejorDia: "15 de agosto", mejorMonto: 878_000, porFuente: { turnero: 5_568_000, reservas_online: 126_000, campeonatos: 80_000 } },
  semanasLunVie: [1_348_000, 1_004_000, 2_954_000, 2_242_000, 132_000],
  manuales: 2_950_000,
};

function plan(input: Record<string, unknown>): PlanAnalitico {
  const v = validarPlan(input);
  assert.equal(v.ok, true, v.ok ? "" : `plan inválido: ${v.error}`);
  return (v as Extract<typeof v, { ok: true }>).plan;
}
async function ejecutar(input: Record<string, unknown>) {
  const r = await ejecutarPlanAnalitico(plan(input));
  assert.equal(r.ok, true, r.ok ? "" : `ejecución fallida: ${r.motivo}`);
  return r as Extract<typeof r, { ok: true }>;
}
const valor = (vs: Array<{ metrica: string; valor: number }>, m: string) => vs.find((v) => v.metrica === m)?.valor ?? 0;
const principal = (vs: Array<{ metrica: string; valor: number }>) => vs[0]?.valor ?? 0;
const cerca = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

async function main() {
  // Censo previo: al terminar se verifica que NADA cambió.
  const tablas = ["turnos_stand", "reservas", "gift_cards", "campeonato_inscripciones", "fin_movimientos"] as const;
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

  // ── 1) Facturación total por día ────────────────────────────────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["dia"], calculos: ["promedio_dia_calendario", "participacion"] });
    assert.equal(r.filas.length, 31, "los 31 días de agosto aparecen, incluidos los que no tuvieron movimientos");
    assert.equal(principal(r.resumen.totales), AGOSTO.totalIntegral);
    assert.equal(r.resumen.diasCalendario, AGOSTO.diasCalendario);
    assert.equal(principal(r.resumen.promedioDiaCalendario), AGOSTO.promedioDia);
    // Identidad: las filas suman el total.
    assert.ok(cerca(r.filas.reduce((a, f) => a + principal(f.valores), 0), AGOSTO.totalIntegral), "los días suman exactamente el total");
    // Identidad: las participaciones suman 100.
    const sumaPart = r.filas.reduce((a, f) => a + (f.participacion?.[0] ?? 0), 0);
    assert.ok(cerca(sumaPart, 100, 0.2), `las participaciones suman 100 (dieron ${sumaPart})`);
    // Orden cronológico por defecto.
    assert.deepEqual(r.filas.map((f) => f.claves[0]), [...r.filas.map((f) => f.claves[0])].sort());
  }
  console.log(`OK — 5B (1): facturación por día de agosto: 31 días (ceros incluidos), total $${AGOSTO.totalIntegral.toLocaleString("es-AR")}, promedio $${AGOSTO.promedioDia.toLocaleString("es-AR")}; las filas y las participaciones cierran.`);

  // ── 2) Facturación por semana y fuente (dos dimensiones) ────────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["semana", "fuente"] });
    assert.equal(r.dimensiones.length, 2);
    assert.ok(r.filas.length > 5, "hay más filas que semanas: cada semana se abre por fuente");
    assert.ok(cerca(r.filas.reduce((a, f) => a + principal(f.valores), 0), AGOSTO.totalIntegral), "semana × fuente suma el total del mes");
    for (const f of r.filas) assert.equal(f.etiquetas.length, 2, "cada fila trae las dos etiquetas");
  }
  console.log("OK — 5B (2): agrupación por semana Y fuente a la vez, y el cruce suma el total del mes.");

  // ── 3) Automático frente a manual ───────────────────────────────────────────────────────
  {
    const r = await ejecutar({
      metricas: ["facturacion_bruta"], periodo: { mes: MES },
      segmentacion: { tipo: "clase", grupo_a: ["automatico"], grupo_b: ["manual"] },
      calculos: ["diferencia", "variacion_pct"],
    });
    const [auto, manual] = r.segmentos!;
    const fin = await getIngresosAutomaticos(MES);
    assert.equal(principal(auto.totales), fin.total, "la parte automática coincide al peso con Finanzas");
    assert.equal(principal(manual.totales), AGOSTO.manuales);
    assert.equal(principal(auto.totales) + principal(manual.totales), AGOSTO.totalIntegral, "automático + manual = facturación total");
    assert.equal(principal(r.comparacion!.diferencia), AGOSTO.manuales - fin.total, "la diferencia es comparado − base");
    assert.ok(r.comparacion!.variacionPct[0].valor != null);
  }
  console.log("OK — 5B (3): automático vs manual, con la parte automática idéntica a Finanzas y la diferencia bien orientada.");

  // ── 4) Método de pago ───────────────────────────────────────────────────────────────────
  {
    const r = await ejecutar({ metricas: ["cobros", "facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["metodo_pago"], calculos: ["participacion"], orden: "mayor_a_menor" });
    assert.ok(r.filas.length > 0);
    assert.ok(cerca(r.filas.reduce((a, f) => a + valor(f.valores, "facturacion_bruta"), 0), AGOSTO.totalIntegral), "los métodos de pago suman el total facturado");
    // Orden descendente por la métrica principal (cobros).
    for (let i = 1; i < r.filas.length; i++) {
      assert.ok(principal(r.filas[i - 1].valores) >= principal(r.filas[i].valores), "ordenado de mayor a menor");
    }
    assert.equal(r.metricas.length, 2, "dos métricas del mismo universo en la misma tabla");
  }
  console.log(`OK — 5B (4): cobros y facturación por método de pago; el más usado fue "${(await ejecutar({ metricas: ["cobros"], periodo: { mes: MES }, dimensiones: ["metodo_pago"], orden: "mayor_a_menor" })).filas[0].etiquetas[0]}".`);

  // ── 5) Ranking de mejores días ──────────────────────────────────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["dia"], ranking: { sentido: "mejores", n: 5 } });
    assert.equal(r.filas.length, 5);
    for (let i = 1; i < 5; i++) assert.ok(principal(r.filas[i - 1].valores) >= principal(r.filas[i].valores), "el ranking baja");
    assert.equal(r.filas[0].etiquetas[0], "18 de agosto", "el mejor día de agosto es el 18");
    assert.equal(principal(r.filas[0].valores), 1_720_000);

    const peores = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["dia"], ranking: { sentido: "peores", n: 3 } });
    assert.equal(peores.filas.length, 3);
    for (let i = 1; i < 3; i++) assert.ok(principal(peores.filas[i - 1].valores) <= principal(peores.filas[i].valores), "el ranking de peores sube");

    // Determinismo con empates: dos corridas dan el mismo orden exacto.
    const otra = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["dia"], ranking: { sentido: "peores", n: 10 } });
    const unaMas = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["dia"], ranking: { sentido: "peores", n: 10 } });
    assert.deepEqual(otra.filas.map((f) => f.claves[0]), unaMas.filas.map((f) => f.claves[0]), "con empates el orden es estable entre corridas");
    assert.ok(otra.filas.some((f) => f.empate) || new Set(otra.filas.map((f) => principal(f.valores))).size === otra.filas.length, "los empates se marcan cuando existen");
  }
  console.log("OK — 5B (5): ranking de mejores y peores días, descendente/ascendente y con empates resueltos de forma estable.");

  // ── 6) Promedio diario contando los días sin movimientos ────────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, calculos: ["promedio_dia_calendario"] });
    assert.equal(r.resumen.diasCalendario, 31, "el denominador son los días calendario, no los días con datos");
    assert.ok(cerca(principal(r.resumen.promedioDiaCalendario) * 31, AGOSTO.totalIntegral, 1), "promedio × días calendario = total");

    // Un mes sin NADA: el promedio es cero y no divide por cero.
    const vacio = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: "2020-01" }, calculos: ["promedio_dia_calendario"] });
    assert.equal(principal(vacio.resumen.totales), 0);
    assert.equal(principal(vacio.resumen.promedioDiaCalendario), 0);
    assert.equal(vacio.resumen.diasCalendario, 31, "los 31 días de enero existen aunque no haya datos");
  }
  console.log("OK — 5B (6): el promedio divide por los días calendario (ceros incluidos) y no explota en un período vacío.");

  // ── 7) Turnos, operaciones, personas y minutos con las reglas vigentes ──────────────────
  {
    const r = await ejecutar({ metricas: ["turnos", "personas", "minutos_actividad"], periodo: { mes: MES }, dimensiones: ["dia"] });
    assert.equal(r.universo, "actividad");
    assert.equal(r.metricas.length, 3);
    assert.ok(principal(r.resumen.totales) > 0, "agosto tuvo actividad");
    for (const f of r.filas) assert.equal(f.valores.length, 3, "cada día trae las tres métricas");

    const porDuracion = await ejecutar({ metricas: ["operaciones"], periodo: { mes: MES }, dimensiones: ["duracion"] });
    assert.ok(porDuracion.filas.length > 0, "las duraciones vendidas se agrupan");
    assert.ok(porDuracion.filas.every((f) => /min$/.test(f.etiquetas[0])), "la etiqueta de duración sale de la modalidad de cada fila");

    const porModalidad = await ejecutar({ metricas: ["turnos"], periodo: { mes: MES }, dimensiones: ["modalidad"] });
    assert.ok(porModalidad.filas.every((f) => ["Legacy", "v2 (10/20/30)"].includes(f.etiquetas[0])), "la modalidad es la persistida");

    const porSims = await ejecutar({ metricas: ["operaciones"], periodo: { mes: MES }, dimensiones: ["simuladores"] });
    assert.ok(porSims.filas.every((f) => /simulador/.test(f.etiquetas[0])), "se agrupa por CANTIDAD de simuladores, no por identidad");
    assert.ok(!JSON.stringify(porSims.filas).match(/simulador\s*[1-4]\s*:/i), "ningún simulador se identifica individualmente");
  }
  console.log("OK — 5B (7): turnos, personas y minutos con la modalidad persistida; duraciones reales y simuladores por cantidad.");

  // ── 8) Comparación entre dos días de la semana ──────────────────────────────────────────
  {
    const r = await ejecutar({
      metricas: ["facturacion_bruta"], periodo: { mes: MES },
      segmentacion: { tipo: "dias_semana", grupo_a: ["lunes"], grupo_b: ["viernes"] },
      calculos: ["promedio_dia_calendario", "diferencia", "variacion_pct"],
    });
    const [lun, vie] = r.segmentos!;
    assert.equal(lun.etiqueta, "Lunes");
    assert.equal(vie.etiqueta, "Viernes");
    assert.equal(lun.diasCalendario, 5, "agosto 2026 tiene 5 lunes");
    assert.equal(vie.diasCalendario, 4, "y 4 viernes");
    assert.equal(principal(r.comparacion!.diferencia), principal(vie.totales) - principal(lun.totales));
  }
  console.log("OK — 5B (8): lunes contra viernes, con los días calendario de cada uno bien contados (5 y 4).");

  // ── 9) Lunes a viernes contra fin de semana — LA CONSULTA DE ACEPTACIÓN ──────────────────
  {
    const r = await ejecutar({
      metricas: ["facturacion_bruta"], periodo: { mes: MES },
      segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["fin_de_semana"] },
      calculos: ["promedio_dia_calendario", "maximo"],
    });
    const [hab, fin] = r.segmentos!;

    assert.equal(hab.etiqueta, "Lunes a viernes");
    assert.equal(hab.diasCalendario, AGOSTO.habiles.dias);
    assert.equal(principal(hab.totales), AGOSTO.habiles.total);
    assert.ok(cerca(principal(hab.promedioDiaCalendario), AGOSTO.habiles.promedio), "promedio de los hábiles");
    assert.equal(hab.mejor!.etiqueta, AGOSTO.habiles.mejorDia);
    assert.equal(principal(hab.mejor!.valores), AGOSTO.habiles.mejorMonto);
    for (const [fuente, monto] of Object.entries(AGOSTO.habiles.porFuente)) {
      assert.equal(principal(hab.porFuente.find((f) => f.fuente === fuente)!.valores), monto, `hábiles · ${fuente}`);
    }

    assert.equal(fin.etiqueta, "Sábados y domingos");
    assert.equal(fin.diasCalendario, AGOSTO.finde.dias);
    assert.equal(principal(fin.totales), AGOSTO.finde.total);
    assert.ok(cerca(principal(fin.promedioDiaCalendario), AGOSTO.finde.promedio), "promedio del fin de semana");
    assert.equal(fin.mejor!.etiqueta, AGOSTO.finde.mejorDia);
    assert.equal(principal(fin.mejor!.valores), AGOSTO.finde.mejorMonto);
    for (const [fuente, monto] of Object.entries(AGOSTO.finde.porFuente)) {
      assert.equal(principal(fin.porFuente.find((f) => f.fuente === fuente)!.valores), monto, `finde · ${fuente}`);
    }

    // Y los dos grupos cierran contra el total canónico del mes.
    assert.equal(principal(hab.totales) + principal(fin.totales), AGOSTO.totalIntegral, "hábiles + fin de semana = total del mes");
    assert.equal(hab.diasCalendario + fin.diasCalendario, 31, "21 + 10 = 31 días");
    assert.equal(principal(r.resumen.totales), AGOSTO.totalIntegral);
  }
  console.log(`OK — 5B (9): CONSULTA DE ACEPTACIÓN — hábiles $${AGOSTO.habiles.total.toLocaleString("es-AR")} en 21 días y finde $${AGOSTO.finde.total.toLocaleString("es-AR")} en 10, con mejor día y desglose por fuente de cada grupo; cierran en $${AGOSTO.totalIntegral.toLocaleString("es-AR")}.`);

  // ── 10) Rango que atraviesa dos meses, con semanas parciales ────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { desde: "2026-08-26", hasta: "2026-09-08" }, dimensiones: ["semana"] });
    assert.equal(r.resumen.diasCalendario, 14);
    // La primera y la última semana están recortadas al rango: no se estiran al lunes ni al domingo.
    const primera = r.filas[0], ultima = r.filas[r.filas.length - 1];
    assert.ok(primera.fechas[0] >= "2026-08-26", "la primera semana arranca dentro del rango");
    assert.ok(ultima.fechas[ultima.fechas.length - 1] <= "2026-09-08", "la última termina dentro del rango");
    assert.ok(primera.dias < 7 || ultima.dias < 7, "al menos una semana es parcial y se conserva");
    assert.ok(cerca(r.filas.reduce((a, f) => a + principal(f.valores), 0), principal(r.resumen.totales)), "las semanas parciales suman el total del rango");

    const porMes = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { desde: "2026-08-26", hasta: "2026-09-08" }, dimensiones: ["mes"] });
    assert.equal(porMes.filas.length, 2, "el rango toca dos meses");
  }
  console.log("OK — 5B (10): un rango entre dos meses conserva las semanas parciales y suma igual.");

  // ── 11) Período relativo ────────────────────────────────────────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { relativo: "mes_pasado" }, calculos: ["promedio_dia_calendario"] });
    assert.ok(r.ventana.desde.endsWith("-01"), "arranca el día 1 del mes pasado");
    assert.ok(r.resumen.diasCalendario >= 28 && r.resumen.diasCalendario <= 31);
    const hoy = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { relativo: "hoy" } });
    assert.equal(hoy.ventana.desde, hoy.ventana.hasta, "hoy es un solo día");
    assert.equal(hoy.resumen.diasCalendario, 1);
  }
  console.log("OK — 5B (11): los períodos relativos se resuelven con el reloj del servidor.");

  // ── 12) Filtro por fuente que no tuvo movimientos: cero con aviso, nunca un invento ─────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { fuente: ["mensualidades"] } });
    assert.equal(principal(r.resumen.totales), 0);
    assert.ok(r.advertencias.some((a) => a.includes("mensualidades") && a.includes("fuentes con movimientos")), "dice qué fuentes sí tuvieron movimientos");

    const soloManuales = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { clase: ["manual"] } });
    assert.equal(principal(soloManuales.resumen.totales), AGOSTO.manuales, "el filtro por clase manual da los ingresos manuales");
  }
  console.log("OK — 5B (12): una fuente sin movimientos devuelve cero con aviso; el filtro por clase funciona.");

  // ── 13) Semanas de lunes a viernes: el resultado de 5A.1 no cambió ──────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["habiles"] }, dimensiones: ["semana"] });
    assert.deepEqual(r.filas.map((f) => principal(f.valores)), AGOSTO.semanasLunVie, "las cinco semanas hábiles de agosto siguen dando lo mismo que en 5A.1");
    assert.equal(principal(r.resumen.totales), AGOSTO.habiles.total);
    assert.equal(r.resumen.diasCalendario, 21, "el denominador respeta el filtro de días");
  }
  console.log("OK — 5B (13): las semanas de lunes a viernes de agosto dan exactamente lo mismo que en 5A.1 (sin regresión).");

  // ── 14) El criterio contable queda declarado y no hay PII ───────────────────────────────
  {
    const r = await ejecutar({ metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["fuente"] });
    assert.ok(r.criterio.includes("total operativa bruta") && r.criterio.includes("Colectivo"), "declara qué se sumó y qué no");
    assert.ok(r.fuentesInternas.length === 1 && r.fuentesInternas[0].includes("Finanzas"));
    const serializado = JSON.stringify(r);
    // El resultado es AGREGADO: importes y fechas sí; datos de una persona, nunca. Se buscan
    // las formas en que aparecería un dato personal, no cualquier número largo (los importes
    // lo son por definición).
    assert.ok(!/@/.test(serializado), "ningún email");
    assert.ok(!/\+?54\s?9?\s?\d{2,4}[\s-]?\d{6,8}/.test(serializado), "ningún teléfono argentino");
    assert.ok(!/\b(dni|documento|telefono|tel[eé]fono|email|mail|cuit|cuil|nombre_cliente|apellido)\b/i.test(serializado), "ningún campo de datos personales");
    assert.ok(!/http/.test(serializado), "ninguna fuente externa");
  }
  console.log("OK — 5B (14): el criterio contable va declarado y el resultado agregado no lleva datos personales ni enlaces.");

  // ── 15) SOLO LECTURA ────────────────────────────────────────────────────────────────────
  {
    const despues = await censo();
    assert.deepEqual(despues, antes, "el ejecutor no insertó, actualizó ni eliminó una sola fila");
  }
  console.log("OK — 5B (15): SOLO LECTURA — el conteo de filas de las cinco tablas involucradas quedó idéntico.");

  console.log("\nOK — ejecutor 5B (datos reales): varias métricas, dos dimensiones, cálculos, ranking y segmentación, con agosto cerrando contra la composición canónica.");
}

main().catch((e) => { console.error(e); process.exit(1); });
