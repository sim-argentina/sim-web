// PDF del Informe del evento del Colectivo (A4 vertical, server-side, bajo demanda).
//
// NO calcula nada: dibuja el resultado de cargarInformeEvento (el mismo objeto que
// muestra la pestaña Informe), con los mismos formateadores que la pantalla
// (formatearMontoAR, formatearPorcentajeAR, formatearFechaAR). Pantalla y PDF
// cierran por construcción.
//
// jsPDF + autoTable, como el resto de los PDF del proyecto (IA SIM): sin Chromium.
// Tipografía Liberation Sans regular + negrita INCRUSTADA (la misma de los informes
// de IA SIM), así los acentos y la ñ se ven igual en cualquier visor.
// Fondo blanco para imprimir; identidad SIM en rojo, negro y grises.
//
// El informe del Colectivo es interno y no forma parte de Finanzas SIM.

import { jsPDF } from "jspdf";
import autoTable, { type CellDef, type RowInput } from "jspdf-autotable";
import { FUENTE_SANS_B64 } from "@/lib/ia/informes/assets/fuenteBase64";
import { FUENTE_SANS_BOLD_B64 } from "@/lib/ia/informes/assets/fuenteSansBoldBase64";
import {
  ESTADO_EVENTO_LABEL, etiquetaMedioEgreso, fechaHoraArgentina, formatearFechaAR, formatearMontoAR, formatearPorcentajeAR,
  type LineaInforme,
} from "@/lib/colectivo";
import type { DatosInformeEvento, EventoInforme } from "@/lib/colectivoInforme";

type RGB = [number, number, number];
const ROJO: RGB = [220, 38, 38];
const NEGRO: RGB = [17, 17, 17];
const GRIS: RGB = [107, 114, 128];
const GRIS_LINEA: RGB = [229, 231, 235];
const VERDE: RGB = [21, 128, 61];
const ROJO_NEG: RGB = [185, 28, 28];
const FONDO_VERDE: RGB = [240, 253, 244];
const FONDO_ROJO: RGB = [254, 242, 242];
const AMBAR: RGB = [180, 83, 9];
const CELESTE: RGB = [3, 105, 161];
const FONT = "LiberationSans";

const MX = 40;          // margen lateral
const MTOP_CONT = 46;   // inicio del contenido en páginas siguientes (bajo el encabezado corrido)
const MBOT = 48;        // zona reservada para el pie

// Importes del PDF: mismo formato que la pantalla, con "-" como signo negativo.
const monto = (v: number | string) => formatearMontoAR(v, "-");
// Texto cargado por usuarios: solo se limpian caracteres de control y tipográficos
// que confunden a los visores (se conservan tildes, ñ, ¿, ¡).
function limpiar(v: unknown, max = 300): string {
  return String(v ?? "")
    .replace(/[−‒–—―]/g, "-")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[    ⁠﻿]/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .slice(0, max);
}

function nuevoDoc(): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.addFileToVFS("LiberationSans-Regular.ttf", FUENTE_SANS_B64);
  doc.addFont("LiberationSans-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("LiberationSans-Bold.ttf", FUENTE_SANS_BOLD_B64);
  doc.addFont("LiberationSans-Bold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");
  return doc;
}
const finalY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

// ── Bloques de dos columnas (ingresos / egresos) ────────────────────────────
type Alineacion = "left" | "right" | "center";
type Fila = { celdas: string[]; total?: boolean; nota?: boolean };
type Bloque = { titulo: string; columnas?: string[]; alineacion: Alineacion[]; anchos?: number[]; filas: Fila[] };

function dibujarBloque(doc: jsPDF, b: Bloque, x: number, w: number, y: number): number {
  const W = doc.internal.pageSize.getWidth();
  const n = b.alineacion.length;
  const head: RowInput[] = [[{
    content: b.titulo.toUpperCase(), colSpan: n,
    styles: { fontStyle: "bold", fontSize: 7.5, textColor: ROJO, halign: "left", cellPadding: { top: 0, bottom: 3, left: 0, right: 0 }, lineWidth: { bottom: 0.8 }, lineColor: ROJO },
  }]];
  if (b.columnas) head.push(b.columnas.map((c, i): CellDef => ({ content: c, styles: { fontStyle: "bold", fontSize: 7, textColor: GRIS, halign: b.alineacion[i] } })));
  const body: RowInput[] = b.filas.map((f): RowInput => f.nota
    ? [{ content: limpiar(f.celdas[0]), colSpan: n, styles: { textColor: GRIS, fontSize: 7.5 } }]
    : f.celdas.map((c, i): CellDef => ({
      content: limpiar(c),
      styles: {
        halign: b.alineacion[i], fontStyle: f.total ? "bold" : "normal",
        lineWidth: f.total ? { top: 0.6 } : 0, lineColor: GRIS_LINEA,
      },
    })));
  const columnStyles: Record<number, { cellWidth: number }> = {};
  (b.anchos ?? []).forEach((a, i) => { if (a > 0) columnStyles[i] = { cellWidth: a }; });
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: W - x - w, top: MTOP_CONT, bottom: MBOT },
    tableWidth: w,
    head, body, theme: "plain",
    styles: { font: FONT, fontSize: 8.5, textColor: NEGRO, cellPadding: { top: 2.4, bottom: 2.4, left: 0, right: 0 }, overflow: "linebreak", valign: "middle" },
    columnStyles,
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });
  return finalY(doc);
}

function dibujarColumna(doc: jsPDF, titulo: string, bloques: Bloque[], x: number, w: number, y0: number): number {
  doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...NEGRO).text(titulo, x, y0 + 9);
  let y = y0 + 18;
  for (const b of bloques) y = dibujarBloque(doc, b, x, w, y) + 12;
  return y;
}

// ¿Los dos bloques entran lado a lado en lo que queda de la página? Se mide en un
// documento descartable: si alguno se pasaría de página, se dibujan uno debajo
// del otro a todo el ancho (nunca dos columnas partidas entre páginas).
function entranLadoALado(columnas: { titulo: string; bloques: Bloque[] }[], w: number, y0: number, limite: number): boolean {
  return columnas.every((c) => {
    const d = nuevoDoc();
    const fin = dibujarColumna(d, c.titulo, c.bloques, MX, w, y0);
    return d.getNumberOfPages() === 1 && fin - 12 <= limite;
  });
}

function lineasMonto(lineas: LineaInforme[]): Fila[] {
  return lineas.map((l) => ({ celdas: [l.etiqueta, monto(l.total)] }));
}

export function nombreArchivoInformePdf(evento: Pick<EventoInforme, "nombre" | "fecha_inicio">): string {
  const base = evento.nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "") || "evento";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(evento.fecha_inicio) ? evento.fecha_inicio : "sin-fecha";
  return `SIM-Colectivo-${base}-${fecha}.pdf`;
}

export function generarPdfInformeEvento(datos: DatosInformeEvento, generado: Date = new Date()): Buffer {
  const { evento, informe, movimientos } = datos;
  const r = informe.resumen;
  const doc = nuevoDoc();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - MX * 2;
  const LIMITE = H - MBOT;
  let y: number;

  // ── Encabezado ────────────────────────────────────────────────────────────
  doc.setFillColor(...ROJO).rect(0, 0, W, 5, "F");
  doc.setFont(FONT, "bold").setFontSize(24).setTextColor(...ROJO).text("SIM", MX, 44);
  doc.setFont(FONT, "bold").setFontSize(8.5).setTextColor(...NEGRO).text("COLECTIVO", MX, 57, { charSpace: 1.6 });
  doc.setFont(FONT, "bold").setFontSize(15).setTextColor(...NEGRO).text("INFORME DEL EVENTO", W - MX, 42, { align: "right" });
  doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...GRIS).text(`Generado: ${fechaHoraArgentina(generado)}`, W - MX, 56, { align: "right" });
  doc.setDrawColor(...GRIS_LINEA).setLineWidth(0.8).line(MX, 68, W - MX, 68);

  y = 90;
  doc.setFont(FONT, "bold").setFontSize(15).setTextColor(...NEGRO);
  for (const ln of doc.splitTextToSize(limpiar(evento.nombre, 160), CW) as string[]) { doc.text(ln, MX, y); y += 18; }
  const fechas = evento.fecha_fin && evento.fecha_fin !== evento.fecha_inicio
    ? `${formatearFechaAR(evento.fecha_inicio)} al ${formatearFechaAR(evento.fecha_fin)}`
    : formatearFechaAR(evento.fecha_inicio);
  const ubicacion = [evento.localidad, evento.provincia, evento.ubicacion].filter(Boolean).map((s) => limpiar(s, 120)).join(" · ");
  const meta = [`Fecha: ${fechas}`, ubicacion ? `Ubicación: ${ubicacion}` : "", `Estado: ${ESTADO_EVENTO_LABEL[evento.estado] ?? limpiar(evento.estado, 30)}`].filter(Boolean).join("     ");
  doc.setFont(FONT, "normal").setFontSize(9.5).setTextColor(...NEGRO);
  for (const ln of doc.splitTextToSize(meta, CW) as string[]) { doc.text(ln, MX, y); y += 13; }
  doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...GRIS).text("Informe interno del Colectivo. No forma parte de Finanzas SIM.", MX, y + 1);
  y += 20;

  // ── Resumen ejecutivo ───────────────────────────────────────────────────────
  doc.setFont(FONT, "bold").setFontSize(7.5).setTextColor(...ROJO).text("RESUMEN EJECUTIVO", MX, y, { charSpace: 1 });
  y += 8;
  const positivo = r.neto >= 0;
  const tarjetas: { etiqueta: string; valor: string; color: RGB; fondo?: RGB; borde?: RGB }[] = [
    { etiqueta: "INGRESOS", valor: monto(r.ingresos), color: NEGRO },
    { etiqueta: "COSTOS", valor: monto(r.costos), color: NEGRO },
    { etiqueta: "GASTOS", valor: monto(r.gastos), color: NEGRO },
    { etiqueta: "RESULTADO NETO", valor: monto(r.neto), color: positivo ? VERDE : ROJO_NEG, fondo: positivo ? FONDO_VERDE : FONDO_ROJO, borde: positivo ? VERDE : ROJO_NEG },
    {
      etiqueta: "MARGEN", valor: formatearPorcentajeAR(informe.margen),
      color: informe.margen === null ? GRIS : positivo ? VERDE : ROJO_NEG,
      fondo: informe.margen === null ? undefined : positivo ? FONDO_VERDE : FONDO_ROJO,
      borde: informe.margen === null ? undefined : positivo ? VERDE : ROJO_NEG,
    },
  ];
  const gap = 8, th = 50;
  const tw = (CW - gap * (tarjetas.length - 1)) / tarjetas.length;
  tarjetas.forEach((t, i) => {
    const x = MX + i * (tw + gap);
    doc.setDrawColor(...(t.borde ?? GRIS_LINEA)).setLineWidth(t.borde ? 1 : 0.8).setFillColor(...(t.fondo ?? ([255, 255, 255] as RGB)));
    doc.roundedRect(x, y, tw, th, 4, 4, "FD");
    doc.setFont(FONT, "bold").setFontSize(6.8).setTextColor(...GRIS).text(t.etiqueta, x + 8, y + 15);
    // El valor siempre entra: se achica la letra si hace falta (nunca se corta).
    let size = 14;
    doc.setFont(FONT, "bold").setFontSize(size);
    while (doc.getTextWidth(t.valor) > tw - 16 && size > 8) { size -= 0.5; doc.setFontSize(size); }
    doc.setTextColor(...t.color).text(t.valor, x + 8, y + 36);
  });
  y += th + 10;
  doc.setFont(FONT, "normal").setFontSize(7.5).setTextColor(...GRIS)
    .text("Resultado neto = Ingresos - Costos - Gastos     Margen = Resultado neto / Ingresos x 100", MX, y);
  y += 20;

  // ── Ingresos y egresos ──────────────────────────────────────────────────────
  const t = informe.turnos;
  const p = informe.productos;
  const bloquesIngresos: Bloque[] = [
    {
      titulo: "Por origen", alineacion: ["left", "right"],
      filas: [
        { celdas: ["Turnos", monto(r.ingresosTurnos)] },
        { celdas: ["Productos", monto(r.ingresosProductos)] },
        { celdas: ["Total ingresos", monto(r.ingresos)], total: true },
      ],
    },
    {
      titulo: "Por método de pago", alineacion: ["left", "right"],
      filas: informe.ingresosPorMetodo.length
        ? [...lineasMonto(informe.ingresosPorMetodo), { celdas: ["Total cobrado", monto(r.ingresos)], total: true }]
        : [{ celdas: ["Sin cobros."], nota: true }],
    },
    {
      titulo: "Actividad del evento", alineacion: ["left", "right"],
      filas: [
        { celdas: ["Turnos", `${t.cantidad.toLocaleString("es-AR")}${t.gratis > 0 ? ` (${t.gratis} gratis)` : ""}`] },
        { celdas: ["Personas", t.personas.toLocaleString("es-AR")] },
        { celdas: ["Minutos totales", t.minutos.toLocaleString("es-AR")] },
        { celdas: ["Facturación de turnos", monto(t.facturacion)] },
      ],
    },
    {
      titulo: "Productos vendidos", alineacion: ["left", "right", "right"],
      ...(p.items.length
        ? {
          columnas: ["Producto", "Unidades", "Facturación"],
          anchos: [0, 62, 74],
          filas: [
            ...p.items.map((it) => ({ celdas: [it.nombre, it.bonificadas > 0 ? `${it.unidades} + ${it.bonificadas} bonif.` : String(it.unidades), monto(it.total)] })),
            { celdas: ["Total", String(p.unidades), monto(p.facturacion)], total: true },
            ...(p.bonificadas > 0 ? [{ celdas: [`Bonificadas: ${p.bonificadas} ${p.bonificadas === 1 ? "unidad entregada" : "unidades entregadas"} sin cobro; no suman a la facturación.`], nota: true }] : []),
          ],
        }
        : { filas: [{ celdas: ["Sin ventas de productos."], nota: true }] }),
    },
  ];
  const bloquesEgresos: Bloque[] = [
    {
      titulo: "Totales", alineacion: ["left", "right"],
      filas: [
        { celdas: ["Costos", monto(r.costos)] },
        { celdas: ["Gastos", monto(r.gastos)] },
        { celdas: ["Total egresos", monto(informe.egresos)], total: true },
      ],
    },
    {
      titulo: "Costos por categoría", alineacion: ["left", "right"],
      filas: informe.costosPorCategoria.length
        ? [...lineasMonto(informe.costosPorCategoria), { celdas: ["Total costos", monto(r.costos)], total: true }]
        : [{ celdas: ["Sin costos cargados."], nota: true }],
    },
    {
      titulo: "Gastos por categoría", alineacion: ["left", "right"],
      filas: informe.gastosPorCategoria.length
        ? [...lineasMonto(informe.gastosPorCategoria), { celdas: ["Total gastos", monto(r.gastos)], total: true }]
        : [{ celdas: ["Sin gastos cargados."], nota: true }],
    },
    {
      titulo: "Egresos por medio de pago", alineacion: ["left", "right"],
      filas: informe.egresosPorMedio.length
        ? [...lineasMonto(informe.egresosPorMedio), { celdas: ["Total egresos", monto(informe.egresos)], total: true }]
        : [{ celdas: ["Sin egresos."], nota: true }],
    },
  ];
  const columnas = [{ titulo: "INGRESOS", bloques: bloquesIngresos }, { titulo: "EGRESOS", bloques: bloquesEgresos }];
  const sep = 22;
  const colW = (CW - sep) / 2;
  if (entranLadoALado(columnas, colW, y, LIMITE)) {
    const finI = dibujarColumna(doc, columnas[0].titulo, columnas[0].bloques, MX, colW, y);
    const finE = dibujarColumna(doc, columnas[1].titulo, columnas[1].bloques, MX + colW + sep, colW, y);
    y = Math.max(finI, finE) + 4;
  } else {
    // Uno debajo del otro a todo el ancho. Cada título se queda con su bloque (o
    // con sus primeras filas, si el bloque es más alto que una página).
    for (const c of columnas) {
      if (y + 60 > LIMITE) { doc.addPage(); y = MTOP_CONT; }
      doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...NEGRO).text(c.titulo, MX, y + 9);
      y += 18;
      for (const b of c.bloques) {
        const d = nuevoDoc();
        const alto = dibujarBloque(d, b, MX, CW, MTOP_CONT) - MTOP_CONT;
        const entraEnUna = d.getNumberOfPages() === 1;
        if (y + Math.min(alto, 60) > LIMITE || (entraEnUna && y + alto > LIMITE)) { doc.addPage(); y = MTOP_CONT; }
        y = dibujarBloque(doc, b, MX, CW, y) + 12;
      }
    }
  }

  // ── Detalle de costos y gastos ──────────────────────────────────────────────
  // El título se queda con el encabezado de la tabla y al menos dos filas.
  if (y + 70 > LIMITE) { doc.addPage(); y = MTOP_CONT; }
  doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...NEGRO).text("DETALLE DE COSTOS Y GASTOS", MX, y + 9);
  y += 16;
  if (movimientos.length === 0) {
    doc.setFont(FONT, "normal").setFontSize(8.5).setTextColor(...GRIS).text("Sin costos ni gastos cargados.", MX, y + 8);
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX, top: MTOP_CONT, bottom: MBOT },
      head: [["Fecha", "Tipo", "Categoría", "Concepto", "Medio", "Monto"]],
      body: movimientos.map((m) => [
        formatearFechaAR(m.fecha),
        m.tipo === "costo" ? "COSTO" : "GASTO",
        limpiar(m.categoria_nombre, 80),
        limpiar(m.concepto, 160),
        etiquetaMedioEgreso(m.medio_pago),
        monto(m.monto),
      ]),
      theme: "plain",
      styles: { font: FONT, fontSize: 8, textColor: NEGRO, cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 }, overflow: "linebreak", valign: "middle", lineWidth: { bottom: 0.4 }, lineColor: GRIS_LINEA },
      headStyles: { fillColor: [243, 244, 246], fontStyle: "bold", fontSize: 7.5, textColor: NEGRO, lineWidth: { bottom: 0.9 }, lineColor: ROJO },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: { 0: { cellWidth: 56 }, 1: { cellWidth: 44 }, 2: { cellWidth: 108 }, 4: { cellWidth: 70 }, 5: { cellWidth: 72, halign: "right" } },
      showHead: "everyPage",
      rowPageBreak: "avoid",
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index === 5) d.cell.styles.halign = "right";
        if (d.section === "body" && d.column.index === 1) {
          d.cell.styles.textColor = d.cell.raw === "COSTO" ? AMBAR : CELESTE;
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fontSize = 7;
        }
      },
    });
  }

  // ── Encabezado corrido (páginas 2+) y pie en todas ─────────────────────────
  const total = doc.getNumberOfPages();
  for (let pg = 1; pg <= total; pg++) {
    doc.setPage(pg);
    if (pg > 1) {
      doc.setFillColor(...ROJO).rect(0, 0, W, 3, "F");
      doc.setFont(FONT, "bold").setFontSize(8).setTextColor(...ROJO).text("SIM", MX, 24);
      doc.setFont(FONT, "bold").setFontSize(8).setTextColor(...GRIS).text("COLECTIVO · INFORME DEL EVENTO", MX + 22, 24);
      doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...GRIS).text(limpiar(evento.nombre, 70), W - MX, 24, { align: "right" });
      doc.setDrawColor(...GRIS_LINEA).setLineWidth(0.5).line(MX, 31, W - MX, 31);
    }
    doc.setDrawColor(...GRIS_LINEA).setLineWidth(0.5).line(MX, H - 34, W - MX, H - 34);
    doc.setFont(FONT, "normal").setFontSize(7.5).setTextColor(...GRIS);
    doc.text("SIM - Colectivo | Informe interno", MX, H - 22);
    doc.text(`Página ${pg} de ${total}`, W - MX, H - 22, { align: "right" });
  }

  doc.setProperties({ title: limpiar(`Informe del evento - ${evento.nombre}`, 120), subject: "Informe interno del Colectivo", creator: "SIM", author: "SIM - Colectivo" });
  return Buffer.from(doc.output("arraybuffer"));
}
