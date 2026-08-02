import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Informe PDF explicativo del cierre mensual de Finanzas SIM. 100% client-side
// (jsPDF) para no depender del bundling serverless de Vercel. Determinístico a
// partir de los datos ya calculados: se regenera igual si el mes se reabre y se
// vuelve a cerrar.

type RubroCat = {
  categoria: string; total: number; cantidad: number; efectivo: number; mercado_pago: number;
  movimientos?: Array<{ fecha: string; descripcion: string; monto: number; fuente: string | null; observaciones: string | null }>;
};
type PorFuente = {
  tipo: "efectivo" | "mercado_pago"; nombre: string; ingresos: number; costos: number; gastos: number;
  inversiones: number; gastosSueldo: number; pagosDeuda: number; transferenciasEntrantes: number;
  transferenciasSalientes: number; neto: number; saldoInicial?: number; saldoTeorico?: number;
};
export type InformeCierre = {
  mes: string; estado: string; cerrado_at: string | null;
  saldo_inicial_general: number; saldo_inicial_efectivo?: number; saldo_inicial_mp?: number;
  saldo_teorico_general: number; saldo_teorico_efectivo?: number; saldo_teorico_mp?: number;
  saldo_real_guardado: number | null; saldo_real_efectivo?: number | null; saldo_real_mp?: number | null;
  diferencia_guardada: number | null; diferencia_efectivo?: number | null; diferencia_mp?: number | null;
  comisiones?: { brutoStand: number; comisionStand: number; netoStand: number; tasaEfectiva: number; advertencias: unknown[]; sinConfig: boolean } | null;
  desglose: { ingresos: number; comisiones_cobro: number; ingresos_netos: number; financiamiento: number; costos: number; gastos: number; inversiones: number; gastos_sueldo: number; pagos_deuda: number; otros: number; ajustes: number };
  por_fuente: PorFuente[];
  detalle: {
    ingresos: { total: number; automaticos: Array<{ fuente: string; total: number; cantidad: number }>; automaticos_total: number; manuales_por_categoria: RubroCat[]; manuales_total: number };
    costos_por_categoria: RubroCat[]; gastos_por_categoria: RubroCat[]; inversiones_por_categoria: RubroCat[];
    sueldo_por_categoria: RubroCat[]; sueldo_total: number; sueldo_asignado: number;
    financiamiento: { total: number; items: Array<{ fecha: string; descripcion: string; monto: number; fuente: string | null }> };
  };
};
export type InformeMetricas = Record<string, number | null | undefined> | null;

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `$${Math.round(Number(n)).toLocaleString("es-AR")}`;
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `${(Number(n) * 100).toFixed(1)}%`;

const RED: [number, number, number] = [220, 38, 38];
const DARK: [number, number, number] = [24, 24, 27];

// Construye el análisis dinámico del mes usando los datos reales.
function construirAnalisis(c: InformeCierre): string[] {
  const out: string[] = [];
  const dg = c.desglose;
  const egresos = dg.costos + dg.gastos + dg.inversiones + dg.gastos_sueldo + dg.pagos_deuda + dg.otros;

  // Mayor rubro de salida (costo o gasto)
  const salidas = [...c.detalle.costos_por_categoria, ...c.detalle.gastos_por_categoria, ...c.detalle.inversiones_por_categoria]
    .sort((a, b) => b.total - a.total);
  if (salidas.length > 0 && egresos > 0) {
    const top = salidas[0];
    out.push(`El mayor rubro de salida fue "${top.categoria}" con ${money(top.total)}, ${Math.round((top.total / egresos) * 100)}% de los egresos del mes.`);
  }

  // Concentración por fuente de la salida de caja
  const ef = c.por_fuente.find((f) => f.tipo === "efectivo");
  const mp = c.por_fuente.find((f) => f.tipo === "mercado_pago");
  if (ef && mp) {
    const salEf = ef.costos + ef.gastos + ef.inversiones + ef.gastosSueldo + ef.pagosDeuda;
    const salMp = mp.costos + mp.gastos + mp.inversiones + mp.gastosSueldo + mp.pagosDeuda;
    if (salEf + salMp > 0) {
      const cual = salMp >= salEf ? "Mercado Pago" : "Efectivo";
      out.push(`${cual} concentró la mayor salida de caja (${money(Math.max(salEf, salMp))} vs ${money(Math.min(salEf, salMp))}).`);
    }
  }

  // Comisiones de cobro
  if (c.comisiones && c.comisiones.brutoStand > 0) {
    const t = c.comisiones.tasaEfectiva * 100;
    out.push(`Las comisiones de cobro fueron ${money(c.comisiones.comisionStand)} (${t.toFixed(2)}% de los ingresos brutos del stand). Si este porcentaje sube, conviene revisar el mix de pagos o el procesador.`);
    if (Array.isArray(c.comisiones.advertencias) && c.comisiones.advertencias.length > 0) {
      out.push(`Atención: hay ${c.comisiones.advertencias.length} cobro(s) QR/débito/crédito sin procesador cargado; se calcularon con 0% de comisión hasta corregir el posnet.`);
    }
    if (c.comisiones.sinConfig) out.push("No hay configuración de comisiones cargada: los netos del stand pueden estar sobreestimados.");
  }

  // Diferencia de cierre
  if (c.saldo_real_guardado !== null && c.diferencia_guardada !== null) {
    const dif = Math.abs(c.diferencia_guardada);
    const base = Math.abs(c.saldo_teorico_general) || 1;
    const rel = dif / base;
    if (dif < 1) out.push("El saldo real coincidió con el teórico: cierre sin diferencias.");
    else if (rel < 0.02) out.push(`La diferencia de cierre fue baja (${money(c.diferencia_guardada)}) respecto del saldo teórico.`);
    else out.push(`La diferencia de cierre fue ALTA (${money(c.diferencia_guardada)}, ${(rel * 100).toFixed(1)}% del teórico): conviene revisar movimientos o arqueo por fuente.`);
  }

  // Financiamiento / deudas
  if (dg.financiamiento > 0) out.push(`Entró financiamiento por ${money(dg.financiamiento)} (préstamos): suma a la caja pero no es facturación ni resultado operativo.`);
  if (dg.pagos_deuda > 0) out.push(`Se pagaron ${money(dg.pagos_deuda)} de deuda este mes.`);

  // Concentración de ingresos
  const auto = c.detalle.ingresos.automaticos;
  if (auto.length > 0 && c.detalle.ingresos.total > 0) {
    const top = [...auto].sort((a, b) => b.total - a.total)[0];
    const share = top.total / c.detalle.ingresos.total;
    if (share > 0.7) out.push(`Los ingresos dependen mucho de "${top.fuente}" (${Math.round(share * 100)}% del total): base poco diversificada.`);
  }

  // Resultado del mes
  const resultado = dg.ingresos_netos - dg.costos - dg.gastos;
  if (resultado > 0) out.push(`Resultado operativo positivo: ${money(resultado)}. El mes viene bien.`);
  else out.push(`Resultado operativo negativo: ${money(resultado)}. Mes ajustado: revisar costos/gastos o volumen de ingresos.`);

  if (out.length === 0) out.push("No hay suficientes datos cargados este mes para un análisis detallado.");
  return out;
}

export function generarInformePdf(args: {
  mes: string; mesLabel: string; cierre: InformeCierre; metricas: InformeMetricas;
}): void {
  const { mes, mesLabel, cierre: c, metricas } = args;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 48;

  const heading = (t: string) => {
    if (y > 760) { doc.addPage(); y = 48; }
    doc.setFontSize(12); doc.setTextColor(...RED); doc.setFont("helvetica", "bold");
    doc.text(t.toUpperCase(), M, y); y += 16;
    doc.setTextColor(...DARK); doc.setFont("helvetica", "normal");
  };
  const afterTable = () => {
    const t = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (t?.finalY ?? y) + 20;
  };
  const table = (head: string[], body: (string | number)[][]) => {
    autoTable(doc, {
      startY: y, head: [head], body: body.map((r) => r.map(String)), margin: { left: M, right: M },
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: DARK, textColor: 255 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });
    afterTable();
  };

  // 1) Portada
  doc.setFillColor(...DARK); doc.rect(0, 0, W, 34, "F");
  doc.setTextColor(255); doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text("SIM FINANZAS — INFORME DE CIERRE MENSUAL", M, 22);
  y = 60; doc.setTextColor(...DARK);
  doc.setFontSize(20); doc.setFont("helvetica", "bold"); doc.text(mesLabel, M, y); y += 22;
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  const estadoTxt = c.estado === "cerrado" ? "Cerrado" : c.estado === "cerrado_con_diferencia" ? "Cerrado con diferencia" : c.estado;
  doc.text(`Estado del cierre: ${estadoTxt}`, M, y); y += 12;
  doc.text(`Generado: ${new Date().toLocaleString("es-AR")}`, M, y); y += 12;
  if (c.cerrado_at) { doc.text(`Cerrado: ${new Date(c.cerrado_at).toLocaleString("es-AR")}`, M, y); y += 12; }
  y += 12;

  const dg = c.desglose;
  // 2) Resumen ejecutivo
  heading("Resumen ejecutivo");
  table(["Concepto", "Monto"], [
    ["Ingresos brutos", money(dg.ingresos)],
    ["Comisiones de cobro", money(-dg.comisiones_cobro)],
    ["Ingresos netos", money(dg.ingresos_netos)],
    ["Costos", money(-dg.costos)],
    ["Gastos", money(-dg.gastos)],
    ["Inversiones", money(-dg.inversiones)],
    ["Gastos de sueldo", money(-dg.gastos_sueldo)],
    ...(dg.financiamiento > 0 ? [["Financiamiento / préstamos", money(dg.financiamiento)]] : []),
    ...(dg.pagos_deuda > 0 ? [["Pagos de deuda", money(-dg.pagos_deuda)]] : []),
    ["Saldo inicial general", money(c.saldo_inicial_general)],
    ["Saldo final teórico", money(c.saldo_teorico_general)],
    ["Saldo real", money(c.saldo_real_guardado)],
    ["Diferencia de cierre", money(c.diferencia_guardada)],
  ]);

  // 3) Cierre por fuente
  heading("Cierre por fuente");
  const filaFuente = (f?: PorFuente, realF?: number | null, teoF?: number, iniF?: number, difF?: number | null) => [
    money(iniF ?? f?.saldoInicial),
    money(f?.ingresos),
    money(-((f?.costos ?? 0) + (f?.gastos ?? 0) + (f?.inversiones ?? 0) + (f?.gastosSueldo ?? 0) + (f?.pagosDeuda ?? 0))),
    money((f?.transferenciasEntrantes ?? 0) - (f?.transferenciasSalientes ?? 0)),
    money(teoF ?? f?.saldoTeorico),
    money(realF ?? null),
    money(difF ?? null),
  ];
  const ef = c.por_fuente.find((f) => f.tipo === "efectivo");
  const mp = c.por_fuente.find((f) => f.tipo === "mercado_pago");
  table(
    ["Fuente", "Inicial", "Ingresos", "Egresos", "Transf.", "Teórico", "Real", "Dif."],
    [
      ["Efectivo", ...filaFuente(ef, c.saldo_real_efectivo, c.saldo_teorico_efectivo, c.saldo_inicial_efectivo, c.diferencia_efectivo)],
      ["Mercado Pago", ...filaFuente(mp, c.saldo_real_mp, c.saldo_teorico_mp, c.saldo_inicial_mp, c.diferencia_mp)],
    ]
  );
  if (c.comisiones && c.comisiones.brutoStand > 0) {
    doc.setFontSize(8);
    doc.text(`Stand — bruto ${money(c.comisiones.brutoStand)} · comisión ${money(c.comisiones.comisionStand)} · neto ${money(c.comisiones.netoStand)} (${pct(c.comisiones.tasaEfectiva)}).`, M, y);
    y += 16;
  }

  // 4) Ingresos por rubro
  heading("Ingresos por rubro/fuente");
  const ingRows: (string | number)[][] = [
    ...c.detalle.ingresos.automaticos.map((a) => [a.fuente, `${a.cantidad} mov.`, money(a.total)]),
    ...c.detalle.ingresos.manuales_por_categoria.map((m) => [m.categoria, `${m.cantidad} mov.`, money(m.total)]),
  ];
  table(["Rubro", "Detalle", "Bruto"], ingRows.length ? ingRows : [["Sin ingresos", "", money(0)]]);

  // 5) Costos, gastos, inversiones y Mi sueldo
  heading("Costos, gastos, inversiones y Mi sueldo");
  const rubroBody = (items: RubroCat[], baseLabel: string) =>
    items.map((c2) => [baseLabel, c2.categoria, `${c2.cantidad}`, money(c2.total)]);
  const egRows = [
    ...rubroBody(c.detalle.costos_por_categoria, "Costo"),
    ...rubroBody(c.detalle.gastos_por_categoria, "Gasto"),
    ...rubroBody(c.detalle.inversiones_por_categoria, "Inversión"),
    ...rubroBody(c.detalle.sueldo_por_categoria, "Mi sueldo"),
  ];
  table(["Tipo", "Categoría", "Mov.", "Total"], egRows.length ? egRows : [["-", "Sin egresos", "0", money(0)]]);

  // 6) Métricas del mes
  if (metricas) {
    heading("Métricas del mes");
    table(["Métrica", "Valor"], [
      ["Revenue neto (financiero)", money(metricas.revenue)],
      ["Ingresos brutos de gestión", money(metricas.ingresos_bruto)],
      ["Comisiones de cobro", money(metricas.comisiones_cobro)],
      ["Tasa efectiva de comisión", pct(metricas.tasa_comision)],
      ["Resultado operativo", money(metricas.operating_profit)],
      ["Margen operativo", pct(metricas.operating_margin)],
      ["Flujo de caja neto", money(metricas.net_cash_flow)],
      ["Ticket promedio", money(metricas.average_ticket)],
      ["Turnos del mes", metricas.turnos != null ? String(metricas.turnos) : "-"],
      ["Costos / ingresos", pct(metricas.cost_ratio)],
      ["Gastos / ingresos", pct(metricas.expense_ratio)],
    ]);
  }

  // 7) Análisis del mes
  heading("Análisis del mes");
  doc.setFontSize(9);
  for (const linea of construirAnalisis(c)) {
    const wrapped = doc.splitTextToSize(`• ${linea}`, W - M * 2) as string[];
    if (y + wrapped.length * 12 > 800) { doc.addPage(); y = 48; }
    doc.text(wrapped, M, y); y += wrapped.length * 12 + 4;
  }

  doc.save(`informe-finanzas-SIM-${mes}.pdf`);
}
