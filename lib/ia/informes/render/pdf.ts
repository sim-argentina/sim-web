// IA SIM · Bloque 4C/4C.3 — Render PDF con jsPDF + autoTable. Determinístico y local.
// Identidad SIM (acento rojo, fondo blanco). Texto normalizado a WinAnsi (evita el
// espaciado roto por caracteres fuera de la fuente estándar), etiquetas amigables, una
// sola fecha de corte, gráficos como BLOQUE INDIVISIBLE (título+imagen+nota+valores),
// indicadores tipados por unidad, sección Conclusiones.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { formatearCelda, formatearPorUnidad } from "@/lib/ia/informes/formato";
import { graficoPNG } from "@/lib/ia/informes/graficos";

const ROJO: [number, number, number] = [220, 38, 38];
const NEGRO: [number, number, number] = [10, 10, 10];
const GRIS: [number, number, number] = [110, 110, 110];
const MX = 48, MTOP = 64, MBOT = 44;

const TIPO_LABEL: Record<string, string> = { analitico_mensual: "Informe analítico mensual", analitico: "Informe analítico", comparacion: "Comparación", foda: "Análisis FODA" };
const tipoLabel = (t: string) => TIPO_LABEL[t] ?? (t ? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Informe");

// Normalización a WinAnsi/Latin-1: reemplaza caracteres que la fuente estándar de jsPDF
// no tiene (rompen el espaciado o se ven como basura). Elimina control chars.
const CTRL = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "g");
function sanPdf(v: unknown, max = 20000): string {
  let s = v == null ? "" : String(v);
  s = s
    .replace(/[−‒–—―]/g, "-")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/×/g, "x").replace(/÷/g, "/")
    .replace(CTRL, "")
    .replace(/[^\x00-\xFF•]/g, ""); // fuera de Latin-1 (salvo bullet) → se descarta
  return s.slice(0, max);
}

export function renderPDF(ctx: ContextoRender): Buffer {
  const s = ctx.spec;
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - MX * 2;
  let y = MTOP;

  const nuevaPagina = () => { doc.addPage(); y = MTOP; };
  const espacio = (h: number) => { if (y + h > H - MBOT) nuevaPagina(); };
  const parrafo = (txt: string, size = 10, color = NEGRO, gap = 6) => {
    if (!txt) return;
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(...color);
    const lineas = doc.splitTextToSize(sanPdf(txt), CW) as string[];
    for (const ln of lineas) { espacio(size + 3); doc.text(ln, MX, y); y += size + 3; }
    y += gap;
  };
  const titulo = (txt: string, size = 14) => {
    espacio(size + 18);
    y += 4;
    doc.setFont("helvetica", "bold").setFontSize(size).setTextColor(...NEGRO);
    doc.text(sanPdf(txt, 200), MX, y);
    doc.setDrawColor(...ROJO).setLineWidth(1.5).line(MX, y + 4, MX + 40, y + 4);
    y += size + 5;
  };
  const bullets = (items: string[], size = 10) => {
    for (const it of items) {
      doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(...NEGRO);
      const lineas = doc.splitTextToSize(sanPdf(it), CW - 14) as string[];
      lineas.forEach((ln, i) => { espacio(size + 3); if (i === 0) doc.text("-", MX, y); doc.text(ln, MX + 14, y); y += size + 3; });
      y += 2;
    }
    y += 3;
  };

  // ── Portada compacta ─────────────────────────────────────────────────────────
  doc.setFillColor(...ROJO).rect(0, 0, W, 6, "F");
  y = 96;
  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...NEGRO);
  doc.splitTextToSize(sanPdf(s.titulo, 200), CW).forEach((ln: string) => { doc.text(ln, MX, y); y += 26; });
  if (s.subtitulo) { doc.setFont("helvetica", "normal").setFontSize(12).setTextColor(...GRIS); doc.text(sanPdf(s.subtitulo, 200), MX, y); y += 20; }
  y += 6;
  doc.setFontSize(10).setTextColor(...GRIS);
  // UNA sola fecha de corte (spec.fecha_corte) + generación por separado. Tipo AMIGABLE.
  const meta = [tipoLabel(s.tipo_informe), s.periodo ? `Período: ${s.periodo}` : "", s.fecha_corte ? `Corte de datos: ${s.fecha_corte} (Córdoba)` : "", `Generado: ${ctx.generadoISO} · versión ${ctx.version}`].filter(Boolean);
  meta.forEach((m) => { doc.text(sanPdf(m, 200), MX, y); y += 14; });
  y += 14;

  // ── Índice ───────────────────────────────────────────────────────────────────
  const extenso = s.secciones.length + s.tablas.length + s.graficos.length > 6;
  if (extenso) {
    titulo("Índice", 13);
    const idx = ["Resumen ejecutivo", ...(s.conclusiones.length ? ["Conclusiones"] : []), ...s.secciones.map((x) => x.titulo || "Sección"), ...(s.tablas.length ? ["Tablas"] : []), ...(s.graficos.length ? ["Gráficos"] : []), "Fuentes y metodología", ...(s.anexo.length ? ["Anexo de datos"] : [])];
    bullets(idx, 10);
  }

  // ── Resumen ejecutivo + Conclusiones ─────────────────────────────────────────
  titulo("Resumen ejecutivo");
  parrafo(s.resumen_ejecutivo);
  if (s.conclusiones.length) { titulo("Conclusiones", 13); bullets(s.conclusiones); }
  if (s.hallazgos.length) { titulo("Hallazgos y anomalías", 13); bullets(s.hallazgos); }
  else if (s.conclusiones.length) { titulo("Hallazgos y anomalías", 13); parrafo("No se detectaron anomalías ni brechas de atribución en los datos utilizados.", 10, NEGRO, 4); }

  // ── Secciones narrativas ─────────────────────────────────────────────────────
  for (const sec of s.secciones) { titulo(sec.titulo || "Sección", 13); parrafo(sec.cuerpo); }

  // Formatea una celda de tabla; si la fila tiene columna "uni", el "val" usa esa unidad.
  const idxUni = (t: Tabla) => t.columnas.findIndex((c) => c.clave === "uni");
  const idxVal = (t: Tabla) => t.columnas.findIndex((c) => c.clave === "val");
  const celda = (t: Tabla, fila: (string | number | boolean | null)[], ci: number): string => {
    const iu = idxUni(t), iv = idxVal(t);
    if (ci === iv && iu >= 0) return formatearPorUnidad(fila[ci] ?? null, String(fila[iu] ?? ""));
    return sanPdf(formatearCelda(fila[ci] ?? null, t.columnas[ci].tipo), 500);
  };
  const dibujarTabla = (t: Tabla) => {
    espacio(46);
    if (t.titulo) { doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NEGRO); doc.text(sanPdf(t.titulo, 200), MX, y); y += 13; }
    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX, top: MTOP, bottom: MBOT },
      head: [t.columnas.map((c) => sanPdf(c.etiqueta, 60))],
      body: t.filas.map((fila) => t.columnas.map((_, i) => celda(t, fila, i))),
      styles: { fontSize: 8, cellPadding: 3, textColor: NEGRO, lineColor: [220, 220, 220], lineWidth: 0.3 },
      headStyles: { fillColor: NEGRO, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      showHead: "everyPage",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    if (t.nota) parrafo(t.nota, 8, GRIS, 6);
  };
  if (s.tablas.length) { titulo("Tablas", 13); for (const t of s.tablas) dibujarTabla(t); }

  // ── Gráficos: cada uno es un BLOQUE INDIVISIBLE (nunca se parte entre páginas) ─
  if (s.graficos.length) {
    titulo("Gráficos", 13);
    const imgW = CW, imgH = (CW * 520) / 900;
    for (const g of s.graficos) {
      const notaH = g.nota ? 14 : 0;
      const bloque = imgH + 10 + notaH;
      if (y + bloque > H - MBOT) nuevaPagina(); // el bloque entra completo o va a nueva página
      const png = graficoPNG(g, 2);
      doc.addImage(png, "PNG", MX, y, imgW, imgH, undefined, "FAST");
      y += imgH + 6;
      if (g.nota) parrafo(g.nota, 8, GRIS, 8);
      else y += 6;
    }
  }

  // ── Fuentes y metodología (SIN duplicar período/corte: ya están en la portada) ─
  titulo("Fuentes y metodología", 13);
  parrafo(`Módulos consultados: ${s.modulos_consultados.join(", ") || "—"}.`, 10, NEGRO, 2);
  if (s.registros_utilizados != null) parrafo(`Registros utilizados: ${s.registros_utilizados}.`, 10, NEGRO, 2);
  if (s.metodologia) parrafo(s.metodologia, 10, NEGRO, 4);
  if (s.fuentes.length) bullets(s.fuentes.map((f) => `${f.modulo}${f.periodo ? ` · ${f.periodo}` : ""}${f.registros != null ? ` · ${f.registros} reg.` : ""}`), 9);

  // ── Advertencias / faltantes / cambios manuales ──────────────────────────────
  if (s.advertencias.length) { titulo("Advertencias", 12); bullets(s.advertencias, 9); }
  if (s.datos_faltantes.length) { titulo("Datos faltantes", 12); bullets(s.datos_faltantes, 9); }
  if (s.cambios_manuales.length) {
    titulo("Valores modificados manualmente", 12);
    parrafo("Los siguientes valores fueron alterados manualmente por el administrador y NO provienen directamente del sistema:", 9, [153, 27, 27], 4);
    bullets(s.cambios_manuales.map((c) => `${c.etiqueta} - sistema: ${String(c.valor_original ?? "—")} -> manual: ${String(c.valor_nuevo ?? "—")}${c.motivo ? ` (${c.motivo})` : ""}`), 9);
  }

  // ── Anexo ────────────────────────────────────────────────────────────────────
  if (s.anexo.length) { nuevaPagina(); titulo("Anexo de datos", 14); for (const t of s.anexo) dibujarTabla(t); }

  // ── Encabezado + pie en todas las páginas ────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFillColor(...ROJO).rect(0, 0, W, 3, "F");
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...GRIS);
      doc.text("SIM", MX, 22);
      doc.setFont("helvetica", "normal").setTextColor(...GRIS);
      doc.text(sanPdf(s.titulo, 80), W - MX, 22, { align: "right" });
      doc.setDrawColor(230, 230, 230).setLineWidth(0.5).line(MX, 30, W - MX, 30);
    }
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GRIS);
    const pie = [`Corte: ${s.fecha_corte ?? "—"}`, s.periodo ? `Período: ${s.periodo}` : ""].filter(Boolean).join("  ·  ");
    doc.text(sanPdf(pie, 120), MX, H - 22);
    doc.text(`Página ${p} de ${total}`, W - MX, H - 22, { align: "right" });
  }

  doc.setProperties({ title: sanPdf(`${tipoLabel(s.tipo_informe)}${s.periodo ? " " + s.periodo : ""} v${ctx.version}`, 120), subject: "Informe SIM", creator: "IA SIM", author: "SIM" });
  return Buffer.from(doc.output("arraybuffer"));
}
