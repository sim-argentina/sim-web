// IA SIM · Bloque 5A — Render DETERMINÍSTICO del resultado analítico. Puro.
//
// El servidor arma la tabla final a partir del resultado ya calculado. Si la narración del
// modelo falla o queda inválida, esta tabla se publica igual: una consulta interna correcta
// nunca se descarta por un problema de redacción (que fue justamente el fallo productivo).

import type { ResultadoAnalitico } from "@/lib/ia/analisis/ejecutorAnalitico";

const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function nAR(n: number, dec: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Mismo criterio de formato que el resto de 4E/5A: el signo va antes del símbolo de moneda.
export function formatearValor(valor: number, unidad: string): string {
  if (!Number.isFinite(valor)) return "—";
  const dec = Number.isInteger(valor) ? 0 : 1;
  switch (unidad) {
    case "ars": return `${valor < 0 ? "-" : ""}$${nAR(Math.abs(valor), Number.isInteger(valor) ? 0 : 2)}`;
    case "minutos": return `${nAR(Math.round(valor), 0)} min`;
    case "horas": return `${nAR(valor, dec)} h`;
    default: return nAR(valor, dec);
  }
}

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
  const contiguos = dias.length === dias[dias.length - 1] - dias[0] + 1;
  if (dias.length === 5 && dias[0] === 1 && dias[4] === 5) return "de lunes a viernes";
  if (contiguos) return `de ${DIAS_ISO[dias[0]]} a ${DIAS_ISO[dias[dias.length - 1]]}`;
  return dias.map((d) => DIAS_ISO[d]).join(", ");
}

const ENCABEZADO_GRUPO: Record<string, string> = {
  dia: "Día", semana: "Semana", mes: "Mes", dia_semana: "Día de la semana",
  fuente: "Fuente", metodo_pago: "Método de pago", ninguno: "Período",
};

// Marcador propio del ensamblador: permite no duplicar si el modelo ya publicó la tabla.
export const MARCADOR_TABLA_ANALITICA = "<!-- ia-sim:tabla-analitica -->";

export function renderResultadoAnalitico(r: ResultadoAnalitico): string {
  if (!r.ok) return `No pude calcular ese dato interno: ${r.motivo}`;

  const filtroDias = tituloFiltroDias(r.filtros.diasSemana);
  const titulo = `${r.etiquetaMetrica}${filtroDias ? " " + filtroDias : ""} — ${tituloPeriodo(r.ventana.desde, r.ventana.hasta)}`;
  const encabezado = ENCABEZADO_GRUPO[r.agruparPor] ?? "Grupo";
  const lineas: string[] = [MARCADOR_TABLA_ANALITICA, `### ${titulo}`, ""];

  if (r.filas.length === 0) {
    lineas.push("No hay datos registrados para ese período con los filtros pedidos.");
    return lineas.join("\n");
  }

  const mostrarDetalle = r.agruparPor === "semana" || r.agruparPor === "dia" || r.agruparPor === "mes";
  lineas.push(mostrarDetalle ? `| ${encabezado} | Días incluidos | ${r.etiquetaMetrica} |` : `| ${encabezado} | ${r.etiquetaMetrica} |`);
  lineas.push(mostrarDetalle ? "| --- | --- | ---: |" : "| --- | ---: |");
  for (const f of r.filas) {
    lineas.push(mostrarDetalle
      ? `| ${f.etiqueta} | ${f.detalle || `${f.dias} día${f.dias === 1 ? "" : "s"}`} | ${formatearValor(f.valor, r.unidad)} |`
      : `| ${f.etiqueta} | ${formatearValor(f.valor, r.unidad)} |`);
  }
  const totalDetalle = `${r.totalDias} día${r.totalDias === 1 ? "" : "s"}`;
  lineas.push(mostrarDetalle
    ? `| **Total** | **${totalDetalle}** | **${formatearValor(r.total, r.unidad)}** |`
    : `| **Total** | **${formatearValor(r.total, r.unidad)}** |`);

  if (r.porFuente.length > 1 && r.agruparPor !== "fuente") {
    lineas.push("", "**Fuentes internas que componen el total:**");
    for (const f of r.porFuente) lineas.push(`- ${f.etiqueta}: ${formatearValor(f.valor, r.unidad)}`);
  }

  if (r.metrica === "facturacion_bruta") {
    lineas.push("", "_Criterio contable vigente: el Turnero del stand se imputa por fecha de servicio; Reservas online, Gift cards y Campeonatos, por fecha de pago. Es la misma composición que usa Finanzas._");
  }
  for (const a of r.advertencias) lineas.push("", `_${a}_`);

  return lineas.join("\n");
}
