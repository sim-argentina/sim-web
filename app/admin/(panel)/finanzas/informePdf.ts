import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Informe PDF explicativo del cierre mensual de Finanzas SIM. 100% client-side
// (jsPDF) para no depender del bundling serverless de Vercel. Determinístico a
// partir de los datos ya calculados: se regenera igual si el mes se reabre y se
// vuelve a cerrar.
//
// Reglas contables del informe (no duplicar datos):
//  · Bruto  = lo cobrado al cliente (antes de comisiones de cobro).
//  · Neto   = bruto - reembolsos - comisiones. Es lo que queda para Finanzas.
//  · Mi sueldo es una SALIDA de SIM (rubro destacado dentro de Gastos), nunca
//    una contabilidad personal aparte, y se suma una sola vez a los egresos.
//  · Financiamiento (préstamos) suma a la caja pero NO es revenue operativo.
//  · Resultado operativo = ingresos netos - costos - gastos operativos
//    (misma fórmula que /api/admin/finanzas/metricas y que la pantalla).

type MovDetalle = { fecha: string; descripcion: string; monto: number; fuente: string | null; observaciones: string | null };
type RubroCat = {
  categoria: string; total: number; cantidad: number; efectivo: number; mercado_pago: number;
  movimientos?: MovDetalle[];
};
type PorFuente = {
  tipo: "efectivo" | "mercado_pago"; nombre: string; ingresos: number; costos: number; gastos: number;
  inversiones: number; gastosSueldo: number; pagosDeuda: number; transferenciasEntrantes: number;
  transferenciasSalientes: number; neto: number; saldoInicial?: number; saldoTeorico?: number;
};
type Comisiones = {
  brutoStand: number; comisionStand: number; netoStand: number; tasaEfectiva: number;
  porMetodo?: Record<string, { bruto: number; comision: number }>;
  porProcesador?: Record<string, { bruto: number; comision: number }>;
  advertencias: unknown[]; sinConfig: boolean;
};
export type InformeCierre = {
  mes: string; estado: string; cerrado_at: string | null; observaciones?: string | null;
  saldo_inicial_general: number; saldo_inicial_efectivo?: number; saldo_inicial_mp?: number;
  saldo_teorico_general: number; saldo_teorico_efectivo?: number; saldo_teorico_mp?: number;
  saldo_real_guardado: number | null; saldo_real_efectivo?: number | null; saldo_real_mp?: number | null;
  diferencia_guardada: number | null; diferencia_efectivo?: number | null; diferencia_mp?: number | null;
  comisiones?: Comisiones | null;
  desglose: { ingresos: number; reembolsos_reservas?: number; ingresos_despues_reembolsos?: number; comisiones_cobro: number; ingresos_netos: number; financiamiento: number; costos: number; gastos: number; inversiones: number; gastos_sueldo: number; pagos_deuda: number; otros: number; ajustes: number };
  por_fuente: PorFuente[];
  detalle: {
    ingresos: { total: number; automaticos: Array<{ fuente: string; total: number; cantidad: number }>; automaticos_total: number; manuales_por_categoria: RubroCat[]; manuales_total: number };
    costos_por_categoria: RubroCat[]; gastos_por_categoria: RubroCat[]; inversiones_por_categoria: RubroCat[];
    otros_por_categoria?: RubroCat[]; pagos_deuda_por_categoria?: RubroCat[];
    sueldo_por_categoria: RubroCat[]; sueldo_total: number; sueldo_asignado: number;
    financiamiento: { total: number; items: Array<{ fecha: string; descripcion: string; monto: number; fuente: string | null }> };
  };
};
export type InformeMetricas = Record<string, number | null | undefined> | null;
// Deudas vivas al momento de generar el informe (opcional: el informe sale igual sin esto).
export type InformeDeuda = {
  descripcion: string; proveedor?: string | null; pendiente: number; cuotas_pendientes: number;
  cuotas_vencidas: number; proxima_cuota: { fecha: string; monto: number; cuota_numero: number | null } | null;
};

// ── Formato ──────────────────────────────────────────────────────────────────

const money = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  const v = Number(n);
  const abs = Math.abs(v);
  const conCentavos = Math.abs(abs - Math.round(abs)) > 0.004;
  const s = abs.toLocaleString("es-AR", {
    minimumFractionDigits: conCentavos ? 2 : 0,
    maximumFractionDigits: conCentavos ? 2 : 0,
  });
  return v < 0 ? `-$${s}` : `$${s}`;
};
const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "-" : `${(Number(n) * 100).toFixed(1)}%`;
const share = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toFixed(1)}%` : "-");
const fechaCorta = (iso: string) => {
  const p = String(iso).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : String(iso);
};
const fuenteLabel = (f: string | null) => (f === "efectivo" ? "Efectivo" : f === "mercado_pago" ? "MP" : "-");
const titulizar = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
const recortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

const RED: [number, number, number] = [220, 38, 38];
const DARK: [number, number, number] = [24, 24, 27];
const GREY: [number, number, number] = [113, 113, 122];
const BAND: [number, number, number] = [237, 237, 240];

const MAX_MOV_POR_RUBRO = 4; // detalle acotado: el informe tiene que seguir siendo legible

// ── Análisis dinámico del mes ────────────────────────────────────────────────

type Bullet = { label: string; texto: string };

// Diagnóstico concreto basado en los números del mes. Sin frases genéricas: cada
// bullet sale de un dato real y se omite si el dato no existe.
function construirAnalisis(c: InformeCierre, deudas?: InformeDeuda[]): Bullet[] {
  const out: Bullet[] = [];
  const dg = c.desglose;
  const sueldo = dg.gastos_sueldo;
  const egresos = dg.costos + dg.gastos + sueldo + dg.inversiones + dg.pagos_deuda + dg.otros;
  const salidasOperativas = dg.costos + dg.gastos + sueldo; // sin inversiones ni deuda
  const resultado = dg.ingresos_netos - dg.costos - dg.gastos;

  // Rubros de salida unificados: "Mi sueldo" entra como un rubro más de SIM.
  const rubros: Array<{ nombre: string; total: number; cantidad: number }> = [
    ...c.detalle.costos_por_categoria.map((r) => ({ nombre: r.categoria, total: r.total, cantidad: r.cantidad })),
    ...c.detalle.gastos_por_categoria.map((r) => ({ nombre: r.categoria, total: r.total, cantidad: r.cantidad })),
    ...c.detalle.inversiones_por_categoria.map((r) => ({ nombre: r.categoria, total: r.total, cantidad: r.cantidad })),
  ];
  if (sueldo > 0) {
    rubros.push({
      nombre: "Mi sueldo",
      total: sueldo,
      cantidad: c.detalle.sueldo_por_categoria.reduce((a, r) => a + r.cantidad, 0),
    });
  }
  rubros.sort((a, b) => b.total - a.total);
  const movimientosEgreso = rubros.reduce((a, r) => a + r.cantidad, 0);

  // Sin datos suficientes: se dice claro y no se inventa un diagnóstico.
  if (egresos <= 0 && dg.ingresos <= 0) {
    return [{ label: "Sin datos", texto: "No hay ingresos ni egresos cargados en el mes: no se puede emitir un diagnóstico." }];
  }
  if (egresos <= 0) {
    out.push({ label: "Faltan datos", texto: "No hay suficientes gastos/costos cargados para emitir un diagnóstico confiable de la estructura de salidas del mes." });
  }

  // 1) Mayor rubro de salida y su peso sobre el total de egresos.
  if (rubros.length > 0 && egresos > 0) {
    const top = rubros[0];
    out.push({
      label: "Mayor salida",
      texto: `"${top.nombre}" fue el principal rubro de salida con ${money(top.total)}, ${share(top.total, egresos)} del total de egresos (${money(egresos)}) en ${top.cantidad} movimiento(s).`,
    });

    // 2) Concentración: ¿pocos rubros explican casi todo?
    if (rubros.length >= 3) {
      const top3 = rubros.slice(0, 3);
      const sum3 = top3.reduce((a, r) => a + r.total, 0);
      const p3 = sum3 / egresos;
      if (p3 >= 0.75) {
        out.push({ label: "Concentración", texto: `3 rubros concentran el ${share(sum3, egresos)} de los egresos (${top3.map((r) => r.nombre).join(", ")}): estructura de salidas poco diversificada y muy sensible a esos rubros.` });
      } else if (p3 <= 0.45) {
        out.push({ label: "Concentración", texto: `Los egresos están repartidos: los 3 rubros más grandes explican solo el ${share(sum3, egresos)} del total, sobre ${rubros.length} rubros distintos.` });
      }
    }
  }

  // 3) Peso de Mi sueldo dentro de las salidas de SIM.
  if (sueldo > 0 && egresos > 0) {
    const p = sueldo / egresos;
    const nivel = p >= 0.3 ? "muy alto" : p >= 0.15 ? "relevante" : "bajo";
    const asignado = c.detalle.sueldo_asignado;
    const extra = asignado > 0 ? ` Sobre el sueldo asignado de ${money(asignado)} quedaron ${money(asignado - sueldo)} sin usar.` : "";
    out.push({ label: "Mi sueldo", texto: `Mi sueldo fue ${money(sueldo)}, ${share(sueldo, egresos)} de las salidas del mes: peso ${nivel} dentro de los egresos de SIM.${extra}` });
  }

  // 4) Comisiones de cobro sobre el bruto.
  if (c.comisiones && c.comisiones.brutoStand > 0 && c.comisiones.comisionStand > 0) {
    const t = c.comisiones.tasaEfectiva;
    const impacto = t >= 0.05 ? "alto" : t >= 0.025 ? "medio" : "bajo";
    out.push({ label: "Comisiones", texto: `Las comisiones de cobro fueron ${money(c.comisiones.comisionStand)}, ${pct(t)} de los ingresos brutos del stand (${money(c.comisiones.brutoStand)}). El impacto es ${impacto} según el mix de medios de pago.` });
  }
  if (c.comisiones?.sinConfig) {
    out.push({ label: "Faltan datos", texto: "No hay configuración de comisiones cargada: los netos del stand pueden estar sobreestimados." });
  } else if (c.comisiones && Array.isArray(c.comisiones.advertencias) && c.comisiones.advertencias.length > 0) {
    out.push({ label: "Faltan datos", texto: `Hay ${c.comisiones.advertencias.length} cobro(s) QR/débito/crédito sin procesador cargado: se calcularon con 0% de comisión, así que el neto real puede ser menor.` });
  }

  // 5) Resultado operativo y cobertura de las salidas con el neto.
  if (resultado >= 0) {
    out.push({ label: "Resultado", texto: `Resultado operativo positivo de ${money(resultado)}: los ingresos netos (${money(dg.ingresos_netos)}) cubrieron costos (${money(dg.costos)}) y gastos (${money(dg.gastos)}).` });
  } else {
    out.push({ label: "Resultado", texto: `Resultado operativo negativo de ${money(resultado)}: los ingresos netos (${money(dg.ingresos_netos)}) no alcanzaron a cubrir costos (${money(dg.costos)}) y gastos (${money(dg.gastos)}).` });
  }
  if (salidasOperativas > 0) {
    const cobertura = dg.ingresos_netos / salidasOperativas;
    if (cobertura < 1) {
      out.push({ label: "Cobertura", texto: `Sumando Mi sueldo, las salidas operativas fueron ${money(salidasOperativas)} y los ingresos netos cubrieron el ${share(dg.ingresos_netos, salidasOperativas)}: faltaron ${money(salidasOperativas - dg.ingresos_netos)}.` });
    } else {
      out.push({ label: "Cobertura", texto: `Sumando Mi sueldo, las salidas operativas fueron ${money(salidasOperativas)} y los ingresos netos las cubrieron ${cobertura.toFixed(2)}x, dejando ${money(dg.ingresos_netos - salidasOperativas)} de margen.` });
    }
  }

  // 6) Inversiones grandes que se comen la caja aunque el mes cierre bien.
  if (dg.inversiones > 0) {
    const base = dg.ingresos_netos > 0 ? dg.ingresos_netos : 0;
    const p = base > 0 ? dg.inversiones / base : 0;
    if (p >= 0.2) {
      out.push({ label: "Inversiones", texto: `Se invirtieron ${money(dg.inversiones)}, ${share(dg.inversiones, base)} de los ingresos netos: no afecta el resultado operativo, pero sí la caja disponible del mes.` });
    } else {
      out.push({ label: "Inversiones", texto: `Inversiones del mes por ${money(dg.inversiones)} (${share(dg.inversiones, egresos)} de los egresos): impacto acotado sobre la caja.` });
    }
  }

  // 7) Financiamiento y deuda: distorsión de caja.
  if (dg.financiamiento > 0) {
    const p = dg.ingresos_netos > 0 ? dg.financiamiento / dg.ingresos_netos : 1;
    const aviso = p >= 0.25 ? " La caja del mes está fuertemente sostenida por financiamiento, no por operación." : "";
    out.push({ label: "Financiamiento", texto: `Entraron ${money(dg.financiamiento)} de financiamiento/préstamos. Suma a la caja pero NO es revenue operativo ni resultado del mes.${aviso}` });
  }
  if (dg.pagos_deuda > 0) {
    out.push({ label: "Deuda", texto: `Se pagaron ${money(dg.pagos_deuda)} de deuda, ${share(dg.pagos_deuda, egresos)} de los egresos: baja la caja sin ser costo ni gasto operativo.` });
  }
  if (deudas && deudas.length > 0) {
    const pendiente = deudas.reduce((a, d) => a + d.pendiente, 0);
    const vencidas = deudas.reduce((a, d) => a + d.cuotas_vencidas, 0);
    if (pendiente > 0) {
      const rel = c.saldo_teorico_general > 0 ? ` Equivale al ${share(pendiente, c.saldo_teorico_general)} del saldo teórico de cierre.` : "";
      out.push({ label: "Deuda viva", texto: `Queda deuda pendiente por ${money(pendiente)} en ${deudas.length} compromiso(s)${vencidas > 0 ? `, con ${vencidas} cuota(s) vencida(s)` : ""}.${rel}` });
    }
  }

  // 8) Diferencia de cierre (teórico vs real).
  if (c.saldo_real_guardado !== null && c.diferencia_guardada !== null) {
    const dif = Math.abs(c.diferencia_guardada);
    const base = Math.abs(c.saldo_teorico_general) || 1;
    const rel = dif / base;
    if (dif < 1) {
      out.push({ label: "Cierre", texto: `El saldo real (${money(c.saldo_real_guardado)}) coincidió con el teórico: cierre sin diferencias.` });
    } else if (rel < 0.02) {
      out.push({ label: "Cierre", texto: `Diferencia de cierre baja: ${money(c.diferencia_guardada)} sobre un teórico de ${money(c.saldo_teorico_general)} (${pct(rel)}).` });
    } else {
      const donde = Math.abs(c.diferencia_efectivo ?? 0) >= Math.abs(c.diferencia_mp ?? 0) ? "Efectivo" : "Mercado Pago";
      out.push({ label: "Cierre", texto: `Diferencia de cierre ALTA: ${money(c.diferencia_guardada)} (${pct(rel)} del teórico), concentrada en ${donde}. Conviene revisar movimientos sin cargar o el arqueo de esa fuente.` });
    }
  } else {
    out.push({ label: "Cierre", texto: "El mes no tiene saldo real cargado: no se puede comparar el teórico contra la caja real." });
  }

  // 9) Aviso de datos flacos para interpretar el mes.
  if (egresos > 0 && movimientosEgreso > 0 && movimientosEgreso < 5) {
    out.push({ label: "Faltan datos", texto: `Solo hay ${movimientosEgreso} movimiento(s) de egreso cargados: el detalle es demasiado chico para leer bien la estructura de costos y gastos del mes.` });
  }
  if (dg.ingresos > 0 && c.detalle.ingresos.automaticos.length === 0 && c.detalle.ingresos.manuales_por_categoria.length === 0) {
    out.push({ label: "Faltan datos", texto: "Hay ingresos en el total pero sin desglose por rubro: no se puede analizar de dónde vino la facturación." });
  }

  return out;
}

// ── Documento ────────────────────────────────────────────────────────────────

export function generarInformePdf(args: {
  mes: string; mesLabel: string; cierre: InformeCierre; metricas: InformeMetricas; deudas?: InformeDeuda[];
}): void {
  const { mes, mesLabel, cierre: c, metricas, deudas } = args;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const FONDO = H - 56; // margen inferior reservado para el pie
  let y = 48;

  const nuevaPagina = () => { doc.addPage(); y = 52; };
  const espacio = (alto: number) => { if (y + alto > FONDO) nuevaPagina(); };

  // Título de sección (barra roja + texto).
  const heading = (t: string, sub?: string) => {
    espacio(sub ? 70 : 56);
    doc.setFillColor(...RED); doc.rect(M, y - 9, 3, 13, "F");
    doc.setFontSize(11.5); doc.setTextColor(...DARK); doc.setFont("helvetica", "bold");
    doc.text(t.toUpperCase(), M + 10, y);
    y += sub ? 13 : 18;
    if (sub) {
      doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.setFont("helvetica", "normal");
      const wrapped = doc.splitTextToSize(sub, W - M * 2 - 10) as string[];
      doc.text(wrapped, M + 10, y); y += wrapped.length * 10 + 8;
    }
    doc.setTextColor(...DARK); doc.setFont("helvetica", "normal");
  };

  // Total destacado del bloque (banda gris con el número a la derecha).
  const totalBanda = (label: string, valor: string, notaTxt?: string) => {
    espacio(32);
    doc.setFillColor(...BAND); doc.rect(M, y - 10, W - M * 2, 21, "F");
    doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK);
    doc.text(label.toUpperCase(), M + 8, y + 5);
    doc.text(valor, W - M - 8, y + 5, { align: "right" });
    y += 26;
    if (notaTxt) {
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
      const wrapped = doc.splitTextToSize(notaTxt, W - M * 2) as string[];
      espacio(wrapped.length * 10);
      doc.text(wrapped, M, y); y += wrapped.length * 10 + 6;
      doc.setTextColor(...DARK);
    }
  };

  const nota = (txt: string) => {
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
    const wrapped = doc.splitTextToSize(txt, W - M * 2) as string[];
    espacio(wrapped.length * 10 + 4);
    doc.text(wrapped, M, y); y += wrapped.length * 10 + 10;
    doc.setTextColor(...DARK);
  };

  const afterTable = () => {
    const t = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (t?.finalY ?? y) + 18;
  };
  type Col = { header: string; width?: number; align?: "left" | "right" | "center" };
  const table = (
    cols: Col[],
    body: (string | number)[][],
    opts?: { destacadas?: Set<number>; resaltadas?: Set<number>; totalRow?: boolean }
  ) => {
    const columnStyles: Record<number, Record<string, unknown>> = {};
    cols.forEach((col, i) => {
      const s: Record<string, unknown> = {};
      if (col.width) s.cellWidth = col.width;
      if (col.align) s.halign = col.align;
      if (Object.keys(s).length > 0) columnStyles[i] = s;
    });
    autoTable(doc, {
      startY: y,
      head: [cols.map((col) => col.header)],
      body: body.map((r) => r.map(String)),
      margin: { left: M, right: M, bottom: 52 },
      styles: { fontSize: 8, cellPadding: { top: 3.2, bottom: 3.2, left: 5, right: 5 }, lineColor: [225, 225, 228], lineWidth: 0.3, textColor: DARK },
      headStyles: { fillColor: DARK, textColor: 255, fontSize: 8, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      columnStyles,
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (opts?.destacadas?.has(data.row.index)) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = BAND;
        }
        if (opts?.resaltadas?.has(data.row.index)) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = BAND;
          data.cell.styles.textColor = RED;
        }
        if (opts?.totalRow && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [232, 232, 236];
        }
      },
    });
    afterTable();
  };

  // Bloque por tipo: total destacado + rubros con % dentro del tipo + principales movimientos.
  const bloqueTipo = (
    titulo: string,
    subtitulo: string | undefined,
    total: number,
    items: RubroCat[],
    opts?: { vacio?: string; totalLabel?: string; notaTotal?: string; destacar?: string }
  ) => {
    heading(titulo, subtitulo);
    totalBanda(opts?.totalLabel || `Total ${titulo.toLowerCase()}`, money(total), opts?.notaTotal);
    if (items.length === 0) {
      nota(opts?.vacio || "Sin movimientos cargados en este tipo durante el mes.");
      return;
    }
    const body: (string | number)[][] = [];
    const destacadas = new Set<number>();
    const resaltadas = new Set<number>();
    items.forEach((it, idx) => {
      // El rubro destacado (p. ej. "Mi sueldo") va en rojo, pero en la misma
      // tabla que el resto: sigue siendo una salida más del tipo.
      (opts?.destacar && it.categoria === opts.destacar ? resaltadas : destacadas).add(body.length);
      body.push([`${idx + 1}. ${it.categoria}`, "", `${it.cantidad}`, share(it.total, total), money(it.total)]);
      const movs = it.movimientos || [];
      for (const m of movs.slice(0, MAX_MOV_POR_RUBRO)) {
        body.push([`     ${fechaCorta(m.fecha)}  ${recortar(m.descripcion || "Sin descripción", 52)}`, fuenteLabel(m.fuente), "", "", money(m.monto)]);
      }
      if (movs.length > MAX_MOV_POR_RUBRO) {
        const resto = movs.slice(MAX_MOV_POR_RUBRO);
        body.push([`     + ${resto.length} movimiento(s) más`, "", "", "", money(resto.reduce((a, m) => a + m.monto, 0))]);
      }
    });
    table(
      [
        { header: "Rubro / movimiento" },
        { header: "Fuente", width: 48, align: "center" },
        { header: "Mov.", width: 34, align: "center" },
        { header: "% del tipo", width: 58, align: "right" },
        { header: "Monto", width: 80, align: "right" },
      ],
      body,
      { destacadas, resaltadas }
    );
  };

  const dg = c.desglose;
  const sueldo = dg.gastos_sueldo;
  const egresosTotales = dg.costos + dg.gastos + sueldo + dg.inversiones + dg.pagos_deuda + dg.otros;
  const gastosConSueldo = dg.gastos + sueldo;
  const resultadoOperativo = dg.ingresos_netos - dg.costos - dg.gastos;

  // ── 1) Portada ─────────────────────────────────────────────────────────────
  doc.setFillColor(...DARK); doc.rect(0, 0, W, 34, "F");
  doc.setTextColor(255); doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("SIM FINANZAS — INFORME DE CIERRE MENSUAL", M, 22);
  y = 64; doc.setTextColor(...DARK);
  doc.setFontSize(22); doc.setFont("helvetica", "bold"); doc.text(mesLabel, M, y);
  const estadoTxt = c.estado === "cerrado" ? "Cerrado" : c.estado === "cerrado_con_diferencia" ? "Cerrado con diferencia" : titulizar(c.estado);
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...RED);
  doc.text(estadoTxt.toUpperCase(), W - M, y, { align: "right" });
  y += 18;
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
  const meta = [`Generado: ${new Date().toLocaleString("es-AR")}`];
  if (c.cerrado_at) meta.push(`Cerrado: ${new Date(c.cerrado_at).toLocaleString("es-AR")}`);
  doc.text(meta.join("   ·   "), M, y); y += 24;
  doc.setTextColor(...DARK);

  // ── 2) Resumen ejecutivo ───────────────────────────────────────────────────
  heading("Resumen ejecutivo", "Bruto = lo cobrado al cliente. Neto = lo que queda para Finanzas después de comisiones. Mi sueldo = salida de SIM, no contabilidad personal.");
  const resumenBody: (string | number)[][] = [];
  const destacadasResumen = new Set<number>();
  const filaFuerte = (label: string, valor: string, ref: string) => {
    destacadasResumen.add(resumenBody.length);
    resumenBody.push([label, valor, ref]);
  };
  resumenBody.push(["Ingresos brutos (cobrado al cliente)", money(dg.ingresos), "100%"]);
  if ((dg.reembolsos_reservas ?? 0) > 0) {
    resumenBody.push(["- Reembolsos de Reservas", money(-(dg.reembolsos_reservas ?? 0)), share(dg.reembolsos_reservas ?? 0, dg.ingresos)]);
  }
  resumenBody.push(["- Comisiones de cobro", money(-dg.comisiones_cobro), share(dg.comisiones_cobro, dg.ingresos)]);
  filaFuerte("Ingresos netos (queda para Finanzas)", money(dg.ingresos_netos), share(dg.ingresos_netos, dg.ingresos));
  resumenBody.push(["- Costos", money(-dg.costos), share(dg.costos, dg.ingresos_netos)]);
  resumenBody.push(["- Gastos operativos", money(-dg.gastos), share(dg.gastos, dg.ingresos_netos)]);
  resumenBody.push(["- Mi sueldo (salida de SIM)", money(-sueldo), share(sueldo, dg.ingresos_netos)]);
  resumenBody.push(["- Inversiones", money(-dg.inversiones), share(dg.inversiones, dg.ingresos_netos)]);
  if (dg.pagos_deuda > 0) resumenBody.push(["- Pagos de deuda", money(-dg.pagos_deuda), share(dg.pagos_deuda, dg.ingresos_netos)]);
  if (dg.otros !== 0) resumenBody.push(["- Otros egresos", money(-dg.otros), share(Math.abs(dg.otros), dg.ingresos_netos)]);
  filaFuerte("Total egresos del mes", money(egresosTotales), share(egresosTotales, dg.ingresos_netos));
  if (dg.financiamiento > 0) resumenBody.push(["+ Financiamiento recibido (no es revenue)", money(dg.financiamiento), "-"]);
  if (dg.ajustes !== 0) resumenBody.push(["+/- Ajustes", money(dg.ajustes), "-"]);
  filaFuerte("Resultado operativo (netos - costos - gastos)", money(resultadoOperativo), share(Math.max(resultadoOperativo, 0), dg.ingresos_netos));
  resumenBody.push(["Saldo inicial", money(c.saldo_inicial_general), "-"]);
  resumenBody.push(["Saldo final teórico", money(c.saldo_teorico_general), "-"]);
  resumenBody.push(["Saldo real", money(c.saldo_real_guardado), "-"]);
  filaFuerte("Diferencia de cierre", money(c.diferencia_guardada), "-");
  table(
    [{ header: "Concepto" }, { header: "Monto", width: 92, align: "right" }, { header: "Referencia", width: 72, align: "right" }],
    resumenBody,
    { destacadas: destacadasResumen }
  );
  nota("Referencia: los ingresos se comparan contra el bruto; costos, gastos, Mi sueldo e inversiones contra los ingresos netos. El resultado operativo no incluye inversiones, pagos de deuda ni financiamiento.");

  // ── 3) Diagnóstico del mes ─────────────────────────────────────────────────
  heading("Diagnóstico del mes", "Lectura automática de los números cargados. Si falta información para interpretar el mes, se aclara.");
  for (const b of construirAnalisis(c, deudas)) {
    doc.setFontSize(9);
    const labelTxt = `${b.label}: `;
    doc.setFont("helvetica", "bold");
    const lw = doc.getTextWidth(labelTxt);
    const x0 = M + 10;
    const xTexto = x0 + lw;
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(b.texto, W - M - xTexto) as string[];
    espacio(wrapped.length * 11 + 8);
    doc.setFillColor(...RED); doc.circle(M + 3, y - 3, 1.6, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK);
    doc.text(labelTxt, x0, y);
    doc.setFont("helvetica", "normal");
    doc.text(wrapped, xTexto, y);
    y += wrapped.length * 11 + 7;
  }
  y += 6;

  // ── 4) A) Ingresos ─────────────────────────────────────────────────────────
  heading("A) Ingresos", "Bruto cobrado, comisiones descontadas y neto disponible para Finanzas.");
  const ingResumen: (string | number)[][] = [["Ingresos brutos", money(dg.ingresos), "100%"]];
  if ((dg.reembolsos_reservas ?? 0) > 0) {
    ingResumen.push(["- Reembolsos de Reservas", money(-(dg.reembolsos_reservas ?? 0)), share(dg.reembolsos_reservas ?? 0, dg.ingresos)]);
    ingResumen.push(["Ingresos después de reembolsos", money(dg.ingresos_despues_reembolsos ?? dg.ingresos), share(dg.ingresos_despues_reembolsos ?? dg.ingresos, dg.ingresos)]);
  }
  ingResumen.push(["- Comisiones de cobro", money(-dg.comisiones_cobro), share(dg.comisiones_cobro, dg.ingresos)]);
  ingResumen.push(["Ingresos netos", money(dg.ingresos_netos), share(dg.ingresos_netos, dg.ingresos)]);
  table(
    [{ header: "Concepto" }, { header: "Monto", width: 92, align: "right" }, { header: "% del bruto", width: 72, align: "right" }],
    ingResumen,
    { totalRow: true }
  );

  const ingBody: (string | number)[][] = [];
  const destIng = new Set<number>();
  if (c.detalle.ingresos.automaticos.length > 0) {
    destIng.add(ingBody.length);
    ingBody.push(["Automáticos (sistema)", "", money(c.detalle.ingresos.automaticos_total), share(c.detalle.ingresos.automaticos_total, dg.ingresos)]);
    for (const a of c.detalle.ingresos.automaticos) {
      ingBody.push([`     ${a.fuente}`, `${a.cantidad}`, money(a.total), share(a.total, dg.ingresos)]);
    }
  }
  if (c.detalle.ingresos.manuales_por_categoria.length > 0) {
    destIng.add(ingBody.length);
    ingBody.push(["Manuales (carga a mano)", "", money(c.detalle.ingresos.manuales_total), share(c.detalle.ingresos.manuales_total, dg.ingresos)]);
    for (const m of c.detalle.ingresos.manuales_por_categoria) {
      ingBody.push([`     ${m.categoria}`, `${m.cantidad}`, money(m.total), share(m.total, dg.ingresos)]);
      for (const mv of (m.movimientos || []).slice(0, MAX_MOV_POR_RUBRO)) {
        ingBody.push([`          ${fechaCorta(mv.fecha)}  ${recortar(mv.descripcion || "Sin descripción", 44)} · ${fuenteLabel(mv.fuente)}`, "", money(mv.monto), ""]);
      }
    }
  }
  if (ingBody.length === 0) {
    nota("Sin ingresos cargados este mes.");
  } else {
    table(
      [{ header: "Rubro / fuente" }, { header: "Mov.", width: 34, align: "center" }, { header: "Bruto", width: 84, align: "right" }, { header: "% del bruto", width: 64, align: "right" }],
      ingBody,
      { destacadas: destIng }
    );
  }

  // ── 5) B) Costos ───────────────────────────────────────────────────────────
  bloqueTipo("B) Costos", "Costos directos de operación del mes.", dg.costos, c.detalle.costos_por_categoria, {
    totalLabel: "Total costos",
    vacio: "No hay costos cargados este mes.",
  });

  // ── 6) C) Gastos (Mi sueldo entra acá como rubro destacado) ────────────────
  const gastosItems: RubroCat[] = [...c.detalle.gastos_por_categoria];
  if (sueldo > 0) {
    // Mi sueldo se suma UNA sola vez: no está incluido en dg.gastos, así que el
    // total del bloque es gastos + sueldo y no hay doble conteo.
    gastosItems.push({
      categoria: "Mi sueldo",
      total: sueldo,
      cantidad: c.detalle.sueldo_por_categoria.reduce((a, r) => a + r.cantidad, 0),
      efectivo: c.detalle.sueldo_por_categoria.reduce((a, r) => a + r.efectivo, 0),
      mercado_pago: c.detalle.sueldo_por_categoria.reduce((a, r) => a + r.mercado_pago, 0),
      movimientos: c.detalle.sueldo_por_categoria
        .flatMap((r) => (r.movimientos || []).map((m) => ({ ...m, descripcion: `${r.categoria} · ${m.descripcion}` })))
        .sort((a, b) => b.monto - a.monto),
    });
  }
  gastosItems.sort((a, b) => b.total - a.total);
  bloqueTipo("C) Gastos", "Gastos operativos del mes. Mi sueldo aparece acá como un rubro más de las salidas de SIM.", gastosConSueldo, gastosItems, {
    totalLabel: "Total gastos (incluye Mi sueldo)",
    notaTotal: `Gastos operativos ${money(dg.gastos)} + Mi sueldo ${money(sueldo)} = ${money(gastosConSueldo)}.${c.detalle.sueldo_asignado > 0 ? ` Sueldo asignado del mes: ${money(c.detalle.sueldo_asignado)}.` : ""}`,
    vacio: "No hay gastos cargados este mes.",
    destacar: "Mi sueldo",
  });

  // ── 7) D) Inversiones ──────────────────────────────────────────────────────
  bloqueTipo("D) Inversiones", "No afectan el resultado operativo, pero sí la caja disponible.", dg.inversiones, c.detalle.inversiones_por_categoria, {
    totalLabel: "Total inversiones",
    vacio: "No hubo inversiones este mes.",
  });

  // ── 8) Otros egresos (solo si existen) ─────────────────────────────────────
  if (dg.otros !== 0 || (c.detalle.otros_por_categoria || []).length > 0) {
    bloqueTipo("Otros egresos", "Salidas que no encajan en costos, gastos ni inversiones.", dg.otros, c.detalle.otros_por_categoria || [], {
      totalLabel: "Total otros egresos",
      vacio: "Sin otros egresos.",
    });
  }

  // ── 9) E) Financiamiento / deudas ──────────────────────────────────────────
  if (dg.financiamiento > 0 || dg.pagos_deuda > 0 || (deudas?.length ?? 0) > 0) {
    heading("E) Financiamiento, deudas y préstamos", "El financiamiento entra a la caja pero NO es revenue operativo ni resultado del mes.");
    const finBody: (string | number)[][] = [];
    const destFin = new Set<number>();
    if (dg.financiamiento > 0) {
      destFin.add(finBody.length);
      finBody.push(["Financiamiento recibido en el mes", "", money(dg.financiamiento)]);
      for (const it of c.detalle.financiamiento.items.slice(0, 12)) {
        finBody.push([`     ${fechaCorta(it.fecha)}  ${recortar(it.descripcion || "Préstamo", 50)}`, fuenteLabel(it.fuente), money(it.monto)]);
      }
    }
    if (dg.pagos_deuda > 0) {
      destFin.add(finBody.length);
      finBody.push(["Pagos de deuda del mes", "", money(-dg.pagos_deuda)]);
      for (const r of c.detalle.pagos_deuda_por_categoria || []) {
        finBody.push([`     ${r.categoria}`, `${r.cantidad} mov.`, money(-r.total)]);
      }
    }
    const conSaldo = (deudas || []).filter((d) => d.pendiente > 0);
    if (conSaldo.length > 0) {
      destFin.add(finBody.length);
      finBody.push(["Deuda pendiente (al día de hoy)", "", money(conSaldo.reduce((a, d) => a + d.pendiente, 0))]);
      for (const d of conSaldo.slice(0, 12)) {
        const prox = d.proxima_cuota ? `próx. ${fechaCorta(d.proxima_cuota.fecha)} ${money(d.proxima_cuota.monto)}` : "sin cuota futura";
        const venc = d.cuotas_vencidas > 0 ? ` · ${d.cuotas_vencidas} vencida(s)` : "";
        finBody.push([`     ${recortar(d.descripcion, 44)}${d.proveedor ? ` (${recortar(d.proveedor, 16)})` : ""}`, `${d.cuotas_pendientes} cuota(s) · ${prox}${venc}`, money(d.pendiente)]);
      }
    }
    table(
      [{ header: "Concepto" }, { header: "Detalle", width: 172 }, { header: "Monto", width: 84, align: "right" }],
      finBody,
      { destacadas: destFin }
    );
    nota("El financiamiento recibido no suma al resultado operativo. Los pagos de deuda bajan la caja sin ser costo ni gasto del mes.");
  }

  // ── 10) F) Comisiones de cobro ─────────────────────────────────────────────
  if (c.comisiones && c.comisiones.brutoStand > 0) {
    const com = c.comisiones;
    heading("F) Comisiones de cobro", "Se descuentan una sola vez: los ingresos netos y el saldo teórico ya están netos de comisiones.");
    totalBanda("Total comisiones del mes", money(com.comisionStand), `Bruto del stand ${money(com.brutoStand)} · neto ${money(com.netoStand)} · tasa efectiva ${pct(com.tasaEfectiva)}.`);
    const comBody: (string | number)[][] = [];
    const destCom = new Set<number>();
    const metodos = Object.entries(com.porMetodo || {}).sort((a, b) => b[1].bruto - a[1].bruto);
    if (metodos.length > 0) {
      destCom.add(comBody.length);
      comBody.push(["Por método de pago", "", "", ""]);
      for (const [k, v] of metodos) {
        comBody.push([`     ${titulizar(k)}`, money(v.bruto), money(v.comision), v.bruto > 0 ? pct(v.comision / v.bruto) : "-"]);
      }
    }
    const procesadores = Object.entries(com.porProcesador || {}).sort((a, b) => b[1].bruto - a[1].bruto);
    if (procesadores.length > 0) {
      destCom.add(comBody.length);
      comBody.push(["Por procesador", "", "", ""]);
      for (const [k, v] of procesadores) {
        comBody.push([`     ${titulizar(k)}`, money(v.bruto), money(v.comision), v.bruto > 0 ? pct(v.comision / v.bruto) : "-"]);
      }
    }
    if (comBody.length > 0) {
      table(
        [{ header: "Detalle" }, { header: "Bruto", width: 86, align: "right" }, { header: "Comisión", width: 86, align: "right" }, { header: "Tasa", width: 54, align: "right" }],
        comBody,
        { destacadas: destCom }
      );
    }
    if (com.sinConfig) nota("Atención: no hay configuración de comisiones cargada; los netos del stand pueden estar sobreestimados.");
    else if (Array.isArray(com.advertencias) && com.advertencias.length > 0) {
      nota(`Atención: ${com.advertencias.length} cobro(s) QR/débito/crédito sin procesador cargado se calcularon con 0% de comisión.`);
    }
  }

  // ── 11) Cierre por fuente ──────────────────────────────────────────────────
  heading("Cierre por fuente", "Efectivo y Mercado Pago por separado. Los egresos incluyen costos, gastos, Mi sueldo, inversiones y pagos de deuda.");
  const filaFuente = (f: PorFuente | undefined, realF?: number | null, teoF?: number, iniF?: number, difF?: number | null) => [
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
    [
      { header: "Fuente", width: 72 },
      { header: "Inicial", align: "right" }, { header: "Ingresos", align: "right" }, { header: "Egresos", align: "right" },
      { header: "Transf.", align: "right" }, { header: "Teórico", align: "right" }, { header: "Real", align: "right" }, { header: "Dif.", align: "right" },
    ],
    [
      ["Efectivo", ...filaFuente(ef, c.saldo_real_efectivo, c.saldo_teorico_efectivo, c.saldo_inicial_efectivo, c.diferencia_efectivo)],
      ["Mercado Pago", ...filaFuente(mp, c.saldo_real_mp, c.saldo_teorico_mp, c.saldo_inicial_mp, c.diferencia_mp)],
      [
        "General",
        money(c.saldo_inicial_general),
        money((ef?.ingresos ?? 0) + (mp?.ingresos ?? 0)),
        money(-egresosTotales),
        money(0),
        money(c.saldo_teorico_general),
        money(c.saldo_real_guardado),
        money(c.diferencia_guardada),
      ],
    ],
    { totalRow: true }
  );

  // ── 12) Métricas del mes ───────────────────────────────────────────────────
  if (metricas) {
    heading("Métricas del mes");
    table(
      [{ header: "Métrica" }, { header: "Valor", width: 110, align: "right" }],
      [
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
      ]
    );
  }

  // ── 13) Observaciones del cierre ───────────────────────────────────────────
  if (c.observaciones && c.observaciones.trim()) {
    heading("Observaciones del cierre");
    nota(c.observaciones.trim());
  }

  // ── Pie con paginado ───────────────────────────────────────────────────────
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
    doc.text(`SIM Finanzas · Cierre ${mesLabel}`, M, H - 24);
    doc.text(`${p} / ${paginas}`, W - M, H - 24, { align: "right" });
  }

  doc.save(`informe-finanzas-SIM-${mes}.pdf`);
}
