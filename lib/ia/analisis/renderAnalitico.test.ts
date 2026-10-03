import { strict as assert } from "node:assert";
import { renderResultadoAnalitico, formatearValor } from "@/lib/ia/analisis/renderAnalitico";
import type { ResultadoAnalitico, ResumenGrupo, ValorMetrica } from "@/lib/ia/analisis/ejecutorAnalitico";

// Ejecutar: npx tsx lib/ia/analisis/renderAnalitico.test.ts — puro (el tipo del ejecutor se
// importa solo como tipo: no se toca la base de datos).
//
// Bloque 5B — la respuesta la arma el SERVIDOR, con un orden fijo: respuesta directa, tabla,
// criterio y uno o dos hallazgos. Las cifras son las reales de agosto 2026, verificadas aparte.

type ResOk = Extract<ResultadoAnalitico, { ok: true }>;

const ars = (valor: number): ValorMetrica => ({ metrica: "facturacion_bruta", etiqueta: "Facturación bruta", unidad: "ars", valor });

const CRITERIO = "Facturación total operativa bruta, con la composición canónica de Finanzas: el Turnero del stand se imputa por fecha de servicio; Reservas online, Gift cards, Campeonatos y Mensualidades por fecha de pago; los ingresos manuales por su fecha contable. No incluye transferencias entre cuentas, préstamos, ajustes de saldo ni el Colectivo.";

const grupo = (etiqueta: string, dias: number, total: number, mejor: [string, string, number] | null, fuentes: Array<[string, string, number]>): ResumenGrupo => ({
  etiqueta,
  diasCalendario: dias,
  diasConDatos: dias,
  totales: [ars(total)],
  promedioDiaCalendario: [ars(Math.round((total / dias) * 100) / 100)],
  mejor: mejor ? { etiqueta: mejor[0], detalle: mejor[1], valores: [ars(mejor[2])] } : null,
  peor: null,
  porFuente: fuentes.map(([fuente, etiq, valor]) => ({ fuente, etiqueta: etiq, valores: [ars(valor)] })),
});

const BASE: ResOk = {
  ok: true,
  universo: "facturacion",
  metricas: [{ id: "facturacion_bruta", etiqueta: "Facturación bruta", unidad: "ars", definicion: "Facturación total operativa bruta." }],
  ventana: { desde: "2026-08-01", hasta: "2026-08-31" },
  filtros: { diasSemana: null, fuentes: null, clases: null, metodosPago: null, modalidades: null, duraciones: null, simuladores: null },
  dimensiones: [],
  etiquetasDimensiones: [],
  calculos: ["total"],
  filas: [],
  resumen: grupo("Total del período", 31, 13_454_000, ["18 de agosto", "martes", 1_720_000], [["turnero", "Turnero del stand", 10_258_000], ["manuales", "Ingresos manuales", 2_950_000], ["reservas_online", "Reservas online", 126_000], ["campeonatos", "Campeonatos", 120_000]]),
  segmentos: null,
  comparacion: null,
  ranking: null,
  fuentesInternas: ["Finanzas SIM · facturación total operativa bruta, composición canónica"],
  criterio: CRITERIO,
  advertencias: [],
  truncado: false,
};

function main() {
  // ── 14) Formato argentino y signos ──────────────────────────────────────────────────────
  {
    assert.equal(formatearValor(13_454_000, "ars"), "$13.454.000");
    assert.equal(formatearValor(-12_500, "ars"), "-$12.500", "el signo va ANTES del símbolo de moneda");
    assert.equal(formatearValor(365_714.29, "ars"), "$365.714,29");
    assert.equal(formatearValor(90, "minutos"), "90 min");
    assert.equal(formatearValor(21, "turnos"), "21");
    assert.equal(formatearValor(57.1, "porcentaje"), "57,1%");
    assert.equal(formatearValor(-8.5, "porcentaje"), "-8,5%", "el porcentaje negativo conserva el signo");
    assert.equal(formatearValor(NaN, "ars"), "—");
  }
  console.log("OK — 5B (14): formato es-AR con el signo antes del símbolo y el porcentaje con su signo.");

  // ── Estructura fija: respuesta directa, tabla, criterio, hallazgos ──────────────────────
  {
    const r: ResOk = {
      ...BASE,
      dimensiones: ["dia_semana"],
      etiquetasDimensiones: ["Día de la semana"],
      calculos: ["total", "participacion"],
      filas: [
        { claves: ["6"], etiquetas: ["Sábado"], detalle: "5 días con datos", fechas: [], dias: 5, valores: [ars(4_000_000)], participacion: [29.7], empate: false },
        { claves: ["5"], etiquetas: ["Viernes"], detalle: "4 días con datos", fechas: [], dias: 4, valores: [ars(3_000_000)], participacion: [22.3], empate: false },
      ],
    };
    const md = renderResultadoAnalitico(r);
    const lineas = md.split("\n");
    assert.ok(md.startsWith("### "), "arranca con el título, sin ningún marcador interno adelante");
    assert.ok(!md.includes("<!--"), "5B.1: no queda ningún comentario HTML en la respuesta visible");
    assert.ok(lineas[0].startsWith("### Facturación bruta"), "el título es la PRIMERA línea, con la métrica y el período");
    const iRespuesta = lineas.findIndex((l) => l.startsWith("**") && !l.startsWith("**Fuentes") && !l.startsWith("**Desglose"));
    const iTabla = lineas.findIndex((l) => l.startsWith("| Día de la semana"));
    const iCriterio = lineas.findIndex((l) => l.includes("total operativa bruta"));
    assert.ok(iRespuesta > 0 && iRespuesta < iTabla, "la respuesta directa va ANTES de la tabla");
    assert.ok(iTabla < iCriterio, "el criterio va DESPUÉS de la tabla");
    assert.ok(md.includes("| Sábado | 5 días con datos | $4.000.000 | 29,7% |"), "la fila trae etiqueta, detalle, valor y participación");
    assert.ok(md.includes("**100,0%**"), "el total de participación es 100%");
  }
  console.log("OK — 5B: orden fijo (respuesta directa → tabla → criterio → hallazgos) y participación en la tabla.");

  // ── Segmentación: la consulta de aceptación ─────────────────────────────────────────────
  {
    const hab = grupo("Lunes a viernes", 21, 7_680_000, ["18 de agosto", "martes", 1_720_000], [["turnero", "Turnero del stand", 4_690_000], ["manuales", "Ingresos manuales", 2_950_000], ["campeonatos", "Campeonatos", 40_000]]);
    const fin = grupo("Sábados y domingos", 10, 5_774_000, ["15 de agosto", "sábado", 878_000], [["turnero", "Turnero del stand", 5_568_000], ["reservas_online", "Reservas online", 126_000], ["campeonatos", "Campeonatos", 80_000]]);
    const r: ResOk = { ...BASE, calculos: ["total", "promedio_dia_calendario", "maximo"], segmentos: [hab, fin] };
    const md = renderResultadoAnalitico(r);

    assert.ok(md.includes("**Lunes a viernes: $7.680.000 en 21 días. Sábados y domingos: $5.774.000 en 10 días. En total, $13.454.000.**"), "la respuesta directa resume los dos grupos y el total");
    assert.ok(md.includes("| Lunes a viernes | 21 | $7.680.000 | $365.714,29 | 18 de agosto — $1.720.000 |"), "fila de hábiles con total, promedio y mejor día");
    assert.ok(md.includes("| Sábados y domingos | 10 | $5.774.000 | $577.400 | 15 de agosto — $878.000 |"), "fila del fin de semana");
    assert.ok(md.includes("| **Total** | **31** | **$13.454.000** |"), "la fila de total cierra los 31 días");
    assert.ok(md.includes("**Desglose por fuente**"), "desglosa por fuente");
    assert.ok(md.includes("| Turnero del stand | $4.690.000 | $5.568.000 | $10.258.000 |"), "cada fuente, por grupo y su total");
    assert.ok(md.includes("| Ingresos manuales | $2.950.000 | $0 | $2.950.000 |"), "los manuales aparecen con cero en el grupo que no los tuvo");
    assert.ok(md.includes("Promedio por día calendario"), "se dice que el promedio es por día calendario");
    assert.ok(md.includes(CRITERIO.slice(0, 40)), "el criterio contable va declarado");
  }
  console.log("OK — 5B: la consulta de aceptación rinde dos grupos con total, promedio, mejor día y desglose por fuente que cierra.");

  // ── Base cero: la variación no se inventa ───────────────────────────────────────────────
  {
    const a = grupo("Automático", 31, 0, null, []);
    const b = grupo("Manual", 31, 2_950_000, null, []);
    const r: ResOk = {
      ...BASE,
      calculos: ["total", "diferencia", "variacion_pct"],
      segmentos: [a, b],
      comparacion: {
        etiquetaBase: "Automático",
        etiquetaComparado: "Manual",
        diferencia: [ars(2_950_000)],
        variacionPct: [{ metrica: "facturacion_bruta", etiqueta: "Facturación bruta", valor: null, motivo: "la base es cero: la variación porcentual no es calculable" }],
      },
    };
    const md = renderResultadoAnalitico(r);
    assert.ok(md.includes("la base es cero: la variación porcentual no es calculable"), "con base cero se explica, no se inventa un porcentaje");
    assert.ok(!/\bInfinity\b|\bNaN\b/.test(md), "nunca sale Infinity ni NaN");
    assert.ok(md.includes("$2.950.000"), "la diferencia absoluta sí se muestra");
  }
  console.log("OK — 5B: base cero → la variación se declara no calculable y no aparece Infinity ni NaN.");

  // ── Variación negativa: conserva el signo ───────────────────────────────────────────────
  {
    const r: ResOk = {
      ...BASE,
      calculos: ["total", "diferencia", "variacion_pct"],
      segmentos: [grupo("Lunes a viernes", 21, 7_680_000, null, []), grupo("Sábados y domingos", 10, 5_774_000, null, [])],
      comparacion: {
        etiquetaBase: "Lunes a viernes",
        etiquetaComparado: "Sábados y domingos",
        diferencia: [ars(-1_906_000)],
        variacionPct: [{ metrica: "facturacion_bruta", etiqueta: "Facturación bruta", valor: -24.8 }],
      },
    };
    const md = renderResultadoAnalitico(r);
    assert.ok(md.includes("-$1.906.000"), "la diferencia negativa conserva el signo antes del símbolo");
    assert.ok(md.includes("-24,8%"), "y la variación negativa también");
  }
  console.log("OK — 5B: una diferencia negativa conserva el signo en el importe y en el porcentaje.");

  // ── Empates: se avisa y el orden no cambia ──────────────────────────────────────────────
  {
    const r: ResOk = {
      ...BASE,
      dimensiones: ["dia"],
      etiquetasDimensiones: ["Día"],
      filas: [
        { claves: ["2026-08-04"], etiquetas: ["4 de agosto"], detalle: "martes", fechas: ["2026-08-04"], dias: 1, valores: [ars(200_000)], participacion: null, empate: true },
        { claves: ["2026-08-11"], etiquetas: ["11 de agosto"], detalle: "martes", fechas: ["2026-08-11"], dias: 1, valores: [ars(200_000)], participacion: null, empate: true },
      ],
    };
    const md = renderResultadoAnalitico(r);
    assert.ok(md.includes("Hay grupos con el mismo valor"), "el empate se declara");
    assert.ok(md.includes("alfabético"), "y se dice cómo se desempata");
    assert.equal(renderResultadoAnalitico(r), md, "el render es determinístico");
  }
  console.log("OK — 5B: los empates se muestran con su criterio de desempate y el render no cambia entre llamadas.");

  // ── Ranking: nombra el extremo y no publica un total parcial ────────────────────────────
  {
    const r: ResOk = {
      ...BASE,
      dimensiones: ["dia"],
      etiquetasDimensiones: ["Día"],
      ranking: { sentido: "mejores", n: 2 },
      calculos: ["total", "ranking"],
      filas: [
        { claves: ["2026-08-18"], etiquetas: ["18 de agosto"], detalle: "martes", fechas: ["2026-08-18"], dias: 1, valores: [ars(1_720_000)], participacion: null, empate: false },
        { claves: ["2026-08-15"], etiquetas: ["15 de agosto"], detalle: "sábado", fechas: ["2026-08-15"], dias: 1, valores: [ars(878_000)], participacion: null, empate: false },
      ],
    };
    const md = renderResultadoAnalitico(r);
    assert.ok(md.includes("El más alto fue 18 de agosto con $1.720.000"), "la respuesta directa nombra el mejor");
    assert.ok(!md.includes("**Total**"), "un ranking recorta el universo: no se pone una fila de total que sumaría mal");
  }
  console.log("OK — 5B: en un ranking la respuesta directa nombra el extremo y no se publica un total parcial.");

  // ── Sin datos: lo dice, no inventa una tabla de ceros ───────────────────────────────────
  {
    const r: ResOk = { ...BASE, resumen: grupo("Total del período", 31, 0, null, []), advertencias: ["No hay ingresos registrados en el período pedido."] };
    const md = renderResultadoAnalitico(r);
    assert.ok(md.includes("No hay datos registrados"), "sin datos lo dice");
    assert.ok(md.includes("No hay ingresos registrados en el período pedido."), "y publica la advertencia del ejecutor");
    assert.ok(!md.includes("| **$0** |"), "no arma una tabla de ceros");
  }
  console.log("OK — 5B: un período sin datos se informa, sin tabla de ceros.");

  // ── Hallazgos: descriptivos y acotados, nunca causales ─────────────────────────────────
  {
    const hab = grupo("Lunes a viernes", 21, 7_680_000, null, []);
    const fin = grupo("Sábados y domingos", 10, 5_774_000, null, []);
    const md = renderResultadoAnalitico({ ...BASE, calculos: ["total", "promedio_dia_calendario"], segmentos: [hab, fin] });
    assert.ok(/concentró el \d+,\d%/.test(md), "un hallazgo cuantifica la concentración");
    assert.ok(/por día calendario/i.test(md), "y otro compara el rendimiento por día");
    for (const causal of ["porque", "debido a", "campaña", "gracias a", "la causa"]) {
      assert.ok(!md.toLowerCase().includes(causal), `no afirma causas ("${causal}")`);
    }
    const hallazgos = md.split("\n").filter((l) => l.startsWith("_") && !l.includes("total operativa bruta") && !l.includes("mismo valor"));
    assert.ok(hallazgos.length <= 2, "a lo sumo dos hallazgos");
  }
  console.log("OK — 5B: los hallazgos describen lo que los datos muestran, son a lo sumo dos y no afirman causas.");

  // ── Nada de JSON, SQL, nombres de tablas ni identificadores internos ───────────────────
  {
    const md = renderResultadoAnalitico({
      ...BASE,
      dimensiones: ["fuente"],
      etiquetasDimensiones: ["Fuente"],
      filas: [{ claves: ["turnero"], etiquetas: ["Turnero del stand"], detalle: "20 días con datos", fechas: [], dias: 20, valores: [ars(10_258_000)], participacion: null, empate: false }],
    });
    for (const prohibido of ["select ", "{", "turnos_stand", "fin_eventos", "facturacion_bruta", "undefined"]) {
      assert.ok(!md.toLowerCase().includes(prohibido.toLowerCase()), `la respuesta no muestra "${prohibido}"`);
    }
  }
  console.log("OK — 5B: la respuesta no muestra JSON, SQL, nombres de tablas ni identificadores internos.");

  console.log("\nOK — render 5B (puro): respuesta determinística, formato argentino, segmentos, empates, base cero y hallazgos acotados.");
}
main();
