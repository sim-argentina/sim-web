// IA SIM · Bloque 5B — Render DETERMINÍSTICO del resultado analítico. Puro.
//
// El servidor arma la respuesta final a partir del resultado ya calculado. Si la narración del
// modelo falla o queda inválida, esto se publica igual: una consulta interna correcta nunca se
// descarta por un problema de redacción.
//
// Orden fijo: respuesta directa → tabla/desglose → criterio → uno o dos hallazgos. Los hallazgos
// se limitan a lo que los datos demuestran: se puede decir "los sábados concentraron más
// facturación", no por qué.

import type { ResultadoAnalitico, ValorMetrica, ResumenGrupo } from "@/lib/ia/analisis/ejecutorAnalitico";

const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function nAR(n: number, dec: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// El signo va SIEMPRE antes del símbolo de moneda: -$12.500, nunca $-12.500.
export function formatearValor(valor: number, unidad: string): string {
  if (!Number.isFinite(valor)) return "—";
  const dec = Number.isInteger(valor) ? 0 : 1;
  switch (unidad) {
    case "ars": return `${valor < 0 ? "-" : ""}$${nAR(Math.abs(valor), Number.isInteger(valor) ? 0 : 2)}`;
    case "minutos": return `${nAR(Math.round(valor), 0)} min`;
    case "horas": return `${nAR(valor, dec)} h`;
    case "porcentaje": return `${valor < 0 ? "-" : ""}${nAR(Math.abs(valor), 1)}%`;
    default: return nAR(valor, dec);
  }
}

const fmt = (v: ValorMetrica) => formatearValor(v.valor, v.unidad);

function tituloPeriodo(desde: string, hasta: string): string {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  const mesCompleto = d1 === 1 && m1 === m2 && a1 === a2 && new Date(Date.UTC(a2, m2, 0)).getUTCDate() === d2;
  if (mesCompleto) return `${MESES[m1]} de ${a1}`;
  if (a1 === a2 && m1 === m2) return `${d1}–${d2} de ${MESES[m1]} de ${a1}`;
  return `${d1} de ${MESES[m1]} de ${a1} al ${d2} de ${MESES[m2]} de ${a2}`;
}

const DIAS_ISO = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function tituloFiltroDias(dias: number[] | null): string {
  if (!dias || dias.length === 0 || dias.length === 7) return "";
  if (dias.length === 5 && dias[0] === 1 && dias[4] === 5) return "de lunes a viernes";
  if (dias.length === 2 && dias[0] === 6 && dias[1] === 7) return "de sábados y domingos";
  const contiguos = dias.length === dias[dias.length - 1] - dias[0] + 1;
  if (contiguos) return `de ${DIAS_ISO[dias[0]]} a ${DIAS_ISO[dias[dias.length - 1]]}`;
  return dias.map((d) => DIAS_ISO[d]).join(", ");
}

// Marcador propio del ensamblador: permite no duplicar si el modelo ya publicó la tabla.
export const MARCADOR_TABLA_ANALITICA = "<!-- ia-sim:tabla-analitica -->";

type ResOk = Extract<ResultadoAnalitico, { ok: true }>;

// ── Respuesta directa ───────────────────────────────────────────────────────────
function respuestaDirecta(r: ResOk): string {
  const principal = r.resumen.totales[0];
  if (!principal) return "No hay datos para ese pedido.";

  if (r.segmentos && r.segmentos.length === 2) {
    const [a, b] = r.segmentos;
    const va = a.totales[0], vb = b.totales[0];
    return `${a.etiqueta}: ${fmt(va)} en ${a.diasCalendario} días. ${b.etiqueta}: ${fmt(vb)} en ${b.diasCalendario} días. En total, ${fmt(principal)}.`;
  }

  if (r.ranking && r.filas.length > 0) {
    const sentido = r.ranking.sentido === "mejores" ? "más alto" : "más bajo";
    const primera = r.filas[0];
    return `El ${sentido} fue ${primera.etiquetas.join(" · ")} con ${fmt(primera.valores[0])}. ${r.filas.length === 1 ? "" : `Siguen ${r.filas.slice(1).map((f) => `${f.etiquetas.join(" · ")} (${fmt(f.valores[0])})`).join(", ")}.`}`.trim();
  }

  if (r.filas.length > 0 && r.dimensiones.length > 0) {
    const top = [...r.filas].sort((x, y) => (y.valores[0]?.valor ?? 0) - (x.valores[0]?.valor ?? 0))[0];
    return `${fmt(principal)} en total. El valor más alto fue ${top.etiquetas.join(" · ")} con ${fmt(top.valores[0])}.`;
  }

  const prom = r.resumen.promedioDiaCalendario[0];
  return `${fmt(principal)} en ${r.resumen.diasCalendario} días calendario (${fmt(prom)} por día).`;
}

// ── Tablas ──────────────────────────────────────────────────────────────────────
function tablaFilas(r: ResOk): string[] {
  if (r.filas.length === 0) return [];
  const lineas: string[] = [];
  const encabezados = [...r.etiquetasDimensiones];
  const temporalUnica = r.dimensiones.length === 1;
  if (temporalUnica) encabezados.push("Detalle");
  for (const m of r.metricas) encabezados.push(m.etiqueta);
  if (r.filas[0].participacion) encabezados.push("Participación");

  lineas.push(`| ${encabezados.join(" | ")} |`);
  lineas.push(`| ${encabezados.map((_, i) => (i < r.dimensiones.length + (temporalUnica ? 1 : 0) ? "---" : "---:")).join(" | ")} |`);

  for (const f of r.filas) {
    const celdas = [...f.etiquetas];
    if (temporalUnica) celdas.push(f.detalle);
    for (const m of r.metricas) {
      const v = f.valores.find((x) => x.metrica === m.id);
      celdas.push(v ? fmt(v) : "—");
    }
    if (f.participacion) celdas.push(formatearValor(f.participacion[0], "porcentaje"));
    lineas.push(`| ${celdas.join(" | ")} |`);
  }

  // Fila de total, salvo que el ranking haya recortado el universo (ahí sumaría mal).
  if (!r.ranking) {
    const celdas: string[] = r.dimensiones.map((_, i) => (i === 0 ? "**Total**" : ""));
    if (temporalUnica) celdas.push(`**${r.resumen.diasCalendario} día${r.resumen.diasCalendario === 1 ? "" : "s"}**`);
    for (const m of r.metricas) {
      const v = r.resumen.totales.find((x) => x.metrica === m.id);
      celdas.push(v ? `**${fmt(v)}**` : "—");
    }
    if (r.filas[0].participacion) celdas.push("**100,0%**");
    lineas.push(`| ${celdas.join(" | ")} |`);
  }
  return lineas;
}

function tablaSegmentos(r: ResOk): string[] {
  if (!r.segmentos) return [];
  const lineas: string[] = [];
  const pideProm = r.calculos.includes("promedio_dia_calendario");
  const pideMejor = r.calculos.includes("maximo");
  const pidePeor = r.calculos.includes("minimo");

  const enc = ["Grupo", "Días"];
  for (const m of r.metricas) enc.push(m.etiqueta);
  if (pideProm) enc.push("Promedio por día calendario");
  if (pideMejor) enc.push("Mejor día");
  if (pidePeor) enc.push("Peor día");
  lineas.push(`| ${enc.join(" | ")} |`);
  lineas.push(`| ${enc.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`);

  const fila = (g: ResumenGrupo) => {
    const celdas = [g.etiqueta, String(g.diasCalendario)];
    for (const m of r.metricas) {
      const v = g.totales.find((x) => x.metrica === m.id);
      celdas.push(v ? fmt(v) : "—");
    }
    if (pideProm) celdas.push(fmt(g.promedioDiaCalendario[0]));
    if (pideMejor) celdas.push(g.mejor ? `${g.mejor.etiqueta} — ${fmt(g.mejor.valores[0])}` : "—");
    if (pidePeor) celdas.push(g.peor ? `${g.peor.etiqueta} — ${fmt(g.peor.valores[0])}` : "—");
    return `| ${celdas.join(" | ")} |`;
  };
  for (const g of r.segmentos) lineas.push(fila(g));

  const total = ["**Total**", `**${r.resumen.diasCalendario}**`];
  for (const m of r.metricas) {
    const v = r.resumen.totales.find((x) => x.metrica === m.id);
    total.push(v ? `**${fmt(v)}**` : "—");
  }
  if (pideProm) total.push(`**${fmt(r.resumen.promedioDiaCalendario[0])}**`);
  if (pideMejor) total.push(r.resumen.mejor ? `**${r.resumen.mejor.etiqueta}**` : "—");
  if (pidePeor) total.push(r.resumen.peor ? `**${r.resumen.peor.etiqueta}**` : "—");
  lineas.push(`| ${total.join(" | ")} |`);
  return lineas;
}

function desgloseFuentePorSegmento(r: ResOk): string[] {
  if (!r.segmentos) return [];
  const fuentes = [...new Set(r.segmentos.flatMap((g) => g.porFuente.map((f) => f.fuente)))];
  if (fuentes.length === 0) return [];
  const etiquetaDe = (f: string) => r.segmentos!.flatMap((g) => g.porFuente).find((x) => x.fuente === f)?.etiqueta ?? f;

  const lineas: string[] = ["", "**Desglose por fuente**"];
  lineas.push(`| Fuente | ${r.segmentos.map((g) => g.etiqueta).join(" | ")} | Total |`);
  lineas.push(`| --- | ${r.segmentos.map(() => "---:").join(" | ")} | ---: |`);
  for (const f of fuentes) {
    const celdas = [etiquetaDe(f)];
    let suma = 0;
    for (const g of r.segmentos) {
      const v = g.porFuente.find((x) => x.fuente === f)?.valores[0];
      suma += v?.valor ?? 0;
      celdas.push(v ? fmt(v) : formatearValor(0, r.metricas[0].unidad));
    }
    celdas.push(formatearValor(Math.round((suma + Number.EPSILON) * 100) / 100, r.metricas[0].unidad));
    lineas.push(`| ${celdas.join(" | ")} |`);
  }
  return lineas;
}

function bloqueComparacion(r: ResOk): string[] {
  if (!r.comparacion) return [];
  const c = r.comparacion;
  const lineas: string[] = ["", `**${c.etiquetaComparado} frente a ${c.etiquetaBase}**`];
  for (let i = 0; i < c.diferencia.length; i++) {
    const d = c.diferencia[i];
    const v = c.variacionPct[i];
    const pct = v.valor == null ? v.motivo ?? "no calculable" : formatearValor(v.valor, "porcentaje");
    lineas.push(`- ${d.etiqueta}: ${fmt(d)} (${pct})`);
  }
  return lineas;
}

// ── Hallazgos: solo lo que los datos demuestran ─────────────────────────────────
function hallazgos(r: ResOk): string[] {
  const out: string[] = [];
  const unidad = r.metricas[0].unidad;

  if (r.segmentos && r.segmentos.length === 2) {
    const [a, b] = r.segmentos;
    const va = a.totales[0].valor, vb = b.totales[0].valor;
    const total = va + vb;
    if (total > 0) {
      const mayor = va >= vb ? a : b;
      const parte = Math.round(((va >= vb ? va : vb) / total) * 1000) / 10;
      out.push(`${mayor.etiqueta} concentró el ${formatearValor(parte, "porcentaje")} del total.`);
    }
    const pa = a.promedioDiaCalendario[0].valor, pb = b.promedioDiaCalendario[0].valor;
    if (pa > 0 && pb > 0) {
      const mejor = pa >= pb ? a : b;
      const veces = Math.round((Math.max(pa, pb) / Math.min(pa, pb)) * 10) / 10;
      out.push(`Por día calendario, ${mejor.etiqueta.toLowerCase()} rindió ${nAR(veces, 1)} ${veces === 1 ? "vez" : "veces"} ${pa === pb ? "igual" : "más"} que el otro grupo.`);
    }
  } else if (r.filas.length > 1) {
    const ordenadas = [...r.filas].sort((x, y) => (y.valores[0]?.valor ?? 0) - (x.valores[0]?.valor ?? 0));
    const top = ordenadas[0], ultima = ordenadas[ordenadas.length - 1];
    const totalPeriodo = r.resumen.totales[0].valor;
    if (totalPeriodo > 0) {
      const parte = Math.round(((top.valores[0]?.valor ?? 0) / totalPeriodo) * 1000) / 10;
      out.push(`${top.etiquetas.join(" · ")} concentró el ${formatearValor(parte, "porcentaje")} del total.`);
    }
    if ((ultima.valores[0]?.valor ?? 0) === 0) {
      const enCero = r.filas.filter((f) => (f.valores[0]?.valor ?? 0) === 0).length;
      out.push(`${enCero} ${enCero === 1 ? "grupo quedó" : "grupos quedaron"} en ${formatearValor(0, unidad)}.`);
    }
  }

  const conDatos = r.resumen.diasConDatos;
  if (out.length < 2 && r.resumen.diasCalendario > conDatos) {
    out.push(`${r.resumen.diasCalendario - conDatos} de los ${r.resumen.diasCalendario} días del período no registraron movimientos (se cuentan en el promedio).`);
  }
  return out.slice(0, 2);
}

// ── Render completo ─────────────────────────────────────────────────────────────
export function renderResultadoAnalitico(r: ResultadoAnalitico): string {
  if (!r.ok) return `No pude calcular ese dato interno: ${r.motivo}`;

  const filtroDias = tituloFiltroDias(r.filtros.diasSemana);
  const nombres = r.metricas.map((m) => m.etiqueta).join(" y ");
  const titulo = `${nombres}${filtroDias ? " " + filtroDias : ""} — ${tituloPeriodo(r.ventana.desde, r.ventana.hasta)}`;

  const lineas: string[] = [MARCADOR_TABLA_ANALITICA, `### ${titulo}`, ""];

  const sinDatos = r.resumen.totales.every((t) => t.valor === 0) && r.filas.length === 0 && !r.segmentos;
  if (sinDatos) {
    lineas.push("No hay datos registrados para ese período con los filtros pedidos.");
    lineas.push("", `_${r.criterio}_`);
    for (const a of r.advertencias) lineas.push("", `_${a}_`);
    return lineas.join("\n");
  }

  lineas.push(`**${respuestaDirecta(r)}**`, "");

  if (r.segmentos) {
    lineas.push(...tablaSegmentos(r));
    lineas.push(...desgloseFuentePorSegmento(r));
    lineas.push(...bloqueComparacion(r));
  } else if (r.filas.length > 0) {
    lineas.push(...tablaFilas(r));
    if (r.resumen.porFuente.length > 1 && !r.dimensiones.includes("fuente")) {
      lineas.push("", "**Fuentes internas que componen el total:**");
      for (const f of r.resumen.porFuente) lineas.push(`- ${f.etiqueta}: ${fmt(f.valores[0])}`);
    }
  } else {
    lineas.push(`| ${r.metricas.map((m) => m.etiqueta).join(" | ")} |`);
    lineas.push(`| ${r.metricas.map(() => "---:").join(" | ")} |`);
    lineas.push(`| ${r.resumen.totales.map((t) => `**${fmt(t)}**`).join(" | ")} |`);
    if (r.calculos.includes("promedio_dia_calendario")) {
      lineas.push("", `Promedio por día calendario (${r.resumen.diasCalendario} días, los días sin movimientos incluidos): ${fmt(r.resumen.promedioDiaCalendario[0])}.`);
    }
    if (r.resumen.porFuente.length > 1) {
      lineas.push("", "**Fuentes internas que componen el total:**");
      for (const f of r.resumen.porFuente) lineas.push(`- ${f.etiqueta}: ${fmt(f.valores[0])}`);
    }
  }

  if (r.filas.some((f) => f.empate)) {
    lineas.push("", "_Hay grupos con el mismo valor: en esos casos el orden es alfabético, para que la respuesta no cambie entre consultas._");
  }

  lineas.push("", `_${r.criterio}_`);

  const hs = hallazgos(r);
  if (hs.length > 0) lineas.push("", ...hs.map((h) => `_${h}_`));

  for (const a of r.advertencias) lineas.push("", `_${a}_`);

  return lineas.join("\n");
}
