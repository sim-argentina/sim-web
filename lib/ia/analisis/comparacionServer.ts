// IA SIM · Bloque 4E — Motor de comparación de PERÍODOS, ejes y fuentes. Ensambla datos REALES
// (metricasEquipoServer/finanzas, ya probados) y aplica los módulos puros de comparacion.ts /
// periodos.ts / inflacion.ts. Toda la aritmética queda acá — el modelo solo narra el resultado.

import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { calcularMes, getCierreMes } from "@/lib/finanzas";
import { estadoPeriodoCalendario } from "@/lib/ia/periodo";
import { resolverPeriodos, ventanaMes, type VentanaPeriodo } from "@/lib/ia/analisis/periodos";
import { compararSetMetricas, type MetricaComparada, type DefinicionMetrica } from "@/lib/ia/analisis/comparacion";
import { leerSerieIpc, listarSerieIpc } from "@/lib/ia/analisis/ipc";
import { ajustarPorInflacion, ajusteEsRelevante, type ResultadoAjusteInflacion } from "@/lib/ia/analisis/inflacion";

export type EjeComparacion = "periodo" | "integrante" | "fuente";
export type ModoMetricas = "equipo" | "financiero";

export type ParamsComparar = {
  modo: ModoMetricas;
  periodoA: { anio: number; mes: number };
  periodoB?: { anio: number; mes: number };
  integranteA?: string;
  integranteB?: string;
  compararFuentes?: boolean;
  ajustarInflacion?: boolean;
};

export type LadoComparacion = {
  etiqueta: string;
  periodo: string;
  ventana: VentanaPeriodo;
  estadoPeriodo: "finalizado" | "en_curso";
  fechaCorte: string;
  modulos: string[];
  registros: number;
};

export type ResultadoComparar = {
  ok: true;
  eje: EjeComparacion;
  modo: ModoMetricas;
  ladoA: LadoComparacion;
  ladoB: LadoComparacion;
  metricas: MetricaComparada[];
  modoPeriodo: "completos" | "equivalente" | "mismo_periodo";
  referenciaCompleta: { etiqueta: string; metricas: MetricaComparada[] } | null;
  inflacion: (ResultadoAjusteInflacion & { metrica: string })[] | null;
  advertencias: string[];
} | { ok: false; motivo: string };

const ETIQUETAS_MES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const etiquetaMes = (anio: number, mes: number) => `${ETIQUETAS_MES[mes]} ${anio}`;

async function ladoDesdeMetricasEquipo(ventana: VentanaPeriodo, etiqueta: string, periodoStr: string, fuentes?: "stand" | "reservas"): Promise<{ lado: LadoComparacion; metricas: Record<string, number>; integrantes: Awaited<ReturnType<typeof consultarMetricasEquipo>>["integrantes"] }> {
  const r = await consultarMetricasEquipo({ desde: ventana.desde, hasta: ventana.hasta, fuentes: fuentes ?? "todas" });
  const [anio, mes] = periodoStr.split("-").map(Number);
  const cal = estadoPeriodoCalendario(anio, mes);
  const horasTrabajadas = r.integrantes.reduce((a, i) => a + i.horas_minutos, 0);
  const t = r.totalesAtribuidos;
  return {
    lado: { etiqueta, periodo: periodoStr, ventana, estadoPeriodo: cal.periodo_calendario, fechaCorte: r.corte, modulos: ["Métricas Equipo"], registros: r.registros.stand + r.registros.reservas },
    metricas: {
      turnos: t.turnos, personas: t.personas, operaciones: t.operaciones,
      minutos_actividad_clientes: t.minutos, horas_trabajadas_cronograma: horasTrabajadas / 60,
      facturacion_bruta: t.bruto, comisiones: t.comision, facturacion_neta: t.neto,
    },
    integrantes: r.integrantes,
  };
}

async function ladoDesdeFinanzas(periodoStr: string, etiqueta: string): Promise<{ lado: LadoComparacion; metricas: Record<string, number> }> {
  const { resumen } = await calcularMes(periodoStr);
  const cierre = await getCierreMes(periodoStr);
  const [anio, mes] = periodoStr.split("-").map(Number);
  const cal = estadoPeriodoCalendario(anio, mes);
  const gananciaSim = resumen.ingresos - resumen.costos - resumen.gastos - resumen.inversiones - resumen.sueldoAsignado;
  return {
    lado: { etiqueta, periodo: periodoStr, ventana: ventanaMes(anio, mes), estadoPeriodo: cal.periodo_calendario, fechaCorte: new Date().toISOString(), modulos: ["Finanzas SIM", cierre ? `cierre:${cierre.estado}` : "cierre:abierto"], registros: resumen.turnosDelMes ?? 0 },
    metricas: {
      ingresos_brutos: resumen.ingresosBruto, reembolsos: resumen.reembolsosReservas,
      ingresos_despues_reembolsos: resumen.ingresosDespuesReembolsos, comisiones_cobro: resumen.comisionesCobro,
      ingresos_netos: resumen.ingresos, costos: resumen.costos, gastos: resumen.gastos,
      inversiones: resumen.inversiones, mi_sueldo: resumen.sueldoAsignado, ganancia_sim: gananciaSim,
    },
  };
}

const ETIQUETAS_METRICA: Record<string, { etiqueta: string; unidad: DefinicionMetrica["unidad"] }> = {
  turnos: { etiqueta: "Turnos", unidad: "turnos" },
  personas: { etiqueta: "Personas", unidad: "personas" },
  operaciones: { etiqueta: "Operaciones", unidad: "cantidad" },
  minutos_actividad_clientes: { etiqueta: "Minutos de actividad (clientes)", unidad: "minutos" },
  horas_trabajadas_cronograma: { etiqueta: "Horas trabajadas (cronograma)", unidad: "horas" },
  facturacion_bruta: { etiqueta: "Facturación bruta", unidad: "ars" },
  comisiones: { etiqueta: "Comisiones", unidad: "ars" },
  facturacion_neta: { etiqueta: "Facturación neta", unidad: "ars" },
  ingresos_brutos: { etiqueta: "Ingresos brutos", unidad: "ars" },
  reembolsos: { etiqueta: "Reembolsos", unidad: "ars" },
  ingresos_despues_reembolsos: { etiqueta: "Ingresos después de reembolsos", unidad: "ars" },
  comisiones_cobro: { etiqueta: "Comisiones de cobro", unidad: "ars" },
  ingresos_netos: { etiqueta: "Ingresos netos", unidad: "ars" },
  costos: { etiqueta: "Costos", unidad: "ars" },
  gastos: { etiqueta: "Gastos", unidad: "ars" },
  inversiones: { etiqueta: "Inversiones", unidad: "ars" },
  mi_sueldo: { etiqueta: "Mi sueldo", unidad: "ars" },
  ganancia_sim: { etiqueta: "Ganancia SIM", unidad: "ars" },
};

function metricasComparadas(mA: Record<string, number>, mB: Record<string, number>): MetricaComparada[] {
  const claves = Object.keys(mA);
  return compararSetMetricas(claves.map((clave) => ({ clave, etiqueta: ETIQUETAS_METRICA[clave]?.etiqueta ?? clave, unidad: ETIQUETAS_METRICA[clave]?.unidad ?? "cantidad", valorA: mA[clave] ?? 0, valorB: mB[clave] ?? 0 })));
}

export async function ejecutarComparacion(p: ParamsComparar): Promise<ResultadoComparar> {
  const advertencias: string[] = [];

  // ── Eje "integrante": dos integrantes DENTRO del mismo período ──────────────────────────
  if (p.integranteA && p.integranteB && !p.periodoB) {
    if (p.modo !== "equipo") return { ok: false, motivo: "La comparación entre integrantes usa métricas de equipo (no financiero)." };
    const periodoStr = `${p.periodoA.anio}-${String(p.periodoA.mes).padStart(2, "0")}`;
    const ventana = ventanaMes(p.periodoA.anio, p.periodoA.mes);
    const r = await consultarMetricasEquipo({ desde: ventana.desde, hasta: ventana.hasta });
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const iA = r.integrantes.find((i) => norm(i.nombre).includes(norm(p.integranteA!)));
    const iB = r.integrantes.find((i) => norm(i.nombre).includes(norm(p.integranteB!)));
    if (!iA || !iB) return { ok: false, motivo: `No encontré a "${!iA ? p.integranteA : p.integranteB}" entre los integrantes de ${periodoStr}.` };
    const cal = estadoPeriodoCalendario(p.periodoA.anio, p.periodoA.mes);
    const mA = { turnos: iA.total.turnos, personas: iA.total.personas, operaciones: iA.total.operaciones, minutos_actividad_clientes: iA.total.minutos, horas_trabajadas_cronograma: iA.horas_minutos / 60, facturacion_bruta: iA.total.bruto, comisiones: iA.total.comision, facturacion_neta: iA.total.neto };
    const mB = { turnos: iB.total.turnos, personas: iB.total.personas, operaciones: iB.total.operaciones, minutos_actividad_clientes: iB.total.minutos, horas_trabajadas_cronograma: iB.horas_minutos / 60, facturacion_bruta: iB.total.bruto, comisiones: iB.total.comision, facturacion_neta: iB.total.neto };
    const ladoBase: Omit<LadoComparacion, "etiqueta"> = { periodo: periodoStr, ventana, estadoPeriodo: cal.periodo_calendario, fechaCorte: r.corte, modulos: ["Métricas Equipo"], registros: r.registros.stand + r.registros.reservas };
    return { ok: true, eje: "integrante", modo: "equipo", ladoA: { etiqueta: iA.nombre, ...ladoBase }, ladoB: { etiqueta: iB.nombre, ...ladoBase }, metricas: metricasComparadas(mA, mB), modoPeriodo: "mismo_periodo", referenciaCompleta: null, inflacion: null, advertencias };
  }

  // ── Eje "fuente": Stand vs Reservas DENTRO del mismo período ─────────────────────────────
  if (p.compararFuentes && !p.periodoB) {
    if (p.modo !== "equipo") return { ok: false, motivo: "Stand vs Reservas usa métricas de equipo (no financiero)." };
    const periodoStr = `${p.periodoA.anio}-${String(p.periodoA.mes).padStart(2, "0")}`;
    const ventana = ventanaMes(p.periodoA.anio, p.periodoA.mes);
    const [stand, reservas] = await Promise.all([
      ladoDesdeMetricasEquipo(ventana, "Turnero Stand", periodoStr, "stand"),
      ladoDesdeMetricasEquipo(ventana, "Reservas web", periodoStr, "reservas"),
    ]);
    return { ok: true, eje: "fuente", modo: "equipo", ladoA: stand.lado, ladoB: reservas.lado, metricas: metricasComparadas(stand.metricas, reservas.metricas), modoPeriodo: "mismo_periodo", referenciaCompleta: null, inflacion: null, advertencias };
  }

  // ── Eje "periodo": mes A vs mes B (completos o equivalentes) ─────────────────────────────
  if (!p.periodoB) return { ok: false, motivo: "Falta periodo_b (o integrante_a/integrante_b, o comparar_fuentes) para saber qué comparar." };
  // Bloque 4E (hotfix 2) — A es SIEMPRE el período más antiguo (base/referencia) y B el más
  // reciente (actual/comparado), SIN IMPORTAR en qué parámetro (periodo_a/periodo_b) los haya
  // puesto el modelo. Así la variación es SIEMPRE (B-A)/|A|, nunca al revés: antes, con "este
  // mes" en periodo_a y "mes pasado" en periodo_b (orden natural de la frase), A terminaba
  // siendo el mes ACTUAL y la variación salía calculada contra el denominador equivocado.
  const claveMes = (per: { anio: number; mes: number }) => per.anio * 12 + per.mes;
  const [periodoA, periodoB] = claveMes(p.periodoB) < claveMes(p.periodoA) ? [p.periodoB, p.periodoA] : [p.periodoA, p.periodoB];
  const resol = resolverPeriodos(periodoA, periodoB);
  const periodoAStr = `${periodoA.anio}-${String(periodoA.mes).padStart(2, "0")}`;
  const periodoBStr = `${periodoB.anio}-${String(periodoB.mes).padStart(2, "0")}`;

  if (p.modo === "equipo") {
    const [ladoA, ladoB] = await Promise.all([
      ladoDesdeMetricasEquipo(resol.ventanaA, etiquetaMes(periodoA.anio, periodoA.mes) + (resol.modo === "equivalente" && resol.aEnCurso ? " (real hasta hoy)" : resol.modo === "equivalente" ? " (tramo equivalente)" : ""), periodoAStr),
      ladoDesdeMetricasEquipo(resol.ventanaB, etiquetaMes(periodoB.anio, periodoB.mes) + (resol.modo === "equivalente" && resol.bEnCurso ? " (real hasta hoy)" : resol.modo === "equivalente" ? " (tramo equivalente)" : ""), periodoBStr),
    ]);
    let refCompletaOut: { etiqueta: string; metricas: MetricaComparada[] } | null = null;
    if (resol.modo === "equivalente" && resol.referenciaCompletaLado) {
      const esA = resol.referenciaCompletaLado === "A";
      const per = esA ? periodoA : periodoB;
      const full = await ladoDesdeMetricasEquipo(ventanaMes(per.anio, per.mes), `${etiquetaMes(per.anio, per.mes)} (mes completo, referencia histórica)`, esA ? periodoAStr : periodoBStr);
      // Referencia completa se muestra sola (no como "diferencia" contra nada): metricas = valores de A=B=ese mismo mes para reusar el render de tabla. Se anula también el
      // texto formateado de diferencia/variación (si no, "variacionFormateada" diría "0,00 %" mientras "variacionPct" dice null: la misma inconsistencia de signo que este hotfix corrige).
      refCompletaOut = { etiqueta: full.lado.etiqueta, metricas: metricasComparadas(full.metricas, full.metricas).map((m) => ({ ...m, diferencia: 0, variacionPct: null, diferenciaFormateada: "—", variacionFormateada: "no aplica (referencia)" })) };
      advertencias.push(`${esA ? periodoAStr : periodoBStr} se comparó por tramo EQUIVALENTE (mismos ${resol.diasTranscurridos} días); el mes completo de esa referencia se muestra aparte, no mezclado en la variación.`);
    }
    return { ok: true, eje: "periodo", modo: "equipo", ladoA: ladoA.lado, ladoB: ladoB.lado, metricas: metricasComparadas(ladoA.metricas, ladoB.metricas), modoPeriodo: resol.modo, referenciaCompleta: refCompletaOut, inflacion: null, advertencias };
  }

  // modo === "financiero": la Finanzas es mensual (no hay recorte por día); si uno de los meses
  // está en curso, se compara igual con lo real acumulado a hoy, pero se ADVIERTE que no es un
  // tramo equivalente (limitación real del motor de Finanzas, no del comparador).
  const [ladoA, ladoB] = await Promise.all([ladoDesdeFinanzas(periodoAStr, etiquetaMes(periodoA.anio, periodoA.mes)), ladoDesdeFinanzas(periodoBStr, etiquetaMes(periodoB.anio, periodoB.mes))]);
  if (resol.aEnCurso || resol.bEnCurso) {
    advertencias.push("Finanzas no admite un recorte por día: el mes en curso se compara con lo real acumulado HASTA HOY, contra el mes de referencia COMPLETO. No es un tramo equivalente (a diferencia de la comparación de actividad de equipo).");
  }

  let inflacion: (ResultadoAjusteInflacion & { metrica: string })[] | null = null;
  if (p.ajustarInflacion || ajusteEsRelevante(periodoAStr, periodoBStr)) {
    const serie = await leerSerieIpc([periodoAStr, periodoBStr]);
    const metricasAInflacionar = ["ingresos_netos", "ganancia_sim"];
    const resultados = metricasAInflacionar.map((m) => ({ metrica: m, ...ajustarPorInflacion(ladoA.metricas[m], periodoAStr, periodoBStr, serie) }));
    inflacion = resultados;
    if (resultados.some((r) => !r.ok)) {
      const disponibles = await listarSerieIpc();
      advertencias.push(`Falta el índice IPC de al menos uno de los períodos (${periodoAStr} / ${periodoBStr}) para ajustar por inflación: se muestra solo la comparación NOMINAL. Períodos con índice cargado: ${disponibles.map((d) => d.periodo).join(", ") || "ninguno"}.`);
    }
  }

  return { ok: true, eje: "periodo", modo: "financiero", ladoA: ladoA.lado, ladoB: ladoB.lado, metricas: metricasComparadas(ladoA.metricas, ladoB.metricas), modoPeriodo: resol.modo === "equivalente" ? "completos" : "completos", referenciaCompleta: null, inflacion, advertencias };
}
