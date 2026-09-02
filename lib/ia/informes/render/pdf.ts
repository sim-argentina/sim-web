// IA SIM · Bloque 4C — Render PDF con jsPDF + autoTable. Determinístico y local.
// Identidad SIM discreta (acento rojo, apto impresión: fondo blanco). Paginación,
// encabezado/pie repetidos, encabezados de tabla repetidos en tablas largas, índice
// si el informe es extenso, gráficos nítidos embebidos, marca de valores manuales.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { formatearCelda } from "@/lib/ia/informes/formato";
import { graficoPNG } from "@/lib/ia/informes/graficos";
import { textoPlano } from "@/lib/ia/informes/sanitizar";

const ROJO: [number, number, number] = [220, 38, 38];
const NEGRO: [number, number, number] = [10, 10, 10];
const GRIS: [number, number, number] = [110, 110, 110];
const MX = 48, MTOP = 64, MBOT = 48;

export function renderPDF(ctx: ContextoRender): Buffer {
  const s = ctx.spec;
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - MX * 2;
  let y = MTOP;

  const espacio = (h: number) => { if (y + h > H - MBOT) { doc.addPage(); y = MTOP; } };
  const parrafo = (txt: string, size = 10, color = NEGRO, gap = 6) => {
    if (!txt) return;
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(...color);
    const lineas = doc.splitTextToSize(textoPlano(txt, 20000), CW) as string[];
    for (const ln of lineas) { espacio(size + 3); doc.text(ln, MX, y); y += size + 3; }
    y += gap;
  };
  const titulo = (txt: string, size = 14) => {
    espacio(size + 14);
    y += 6;
    doc.setFont("helvetica", "bold").setFontSize(size).setTextColor(...NEGRO);
    doc.text(textoPlano(txt, 200), MX, y);
    doc.setDrawColor(...ROJO).setLineWidth(1.5).line(MX, y + 4, MX + 40, y + 4);
    y += size + 6;
  };
  const bullets = (items: string[], size = 10) => {
    for (const it of items) {
      doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(...NEGRO);
      const lineas = doc.splitTextToSize(textoPlano(it, 2000), CW - 14) as string[];
      lineas.forEach((ln, i) => { espacio(size + 3); doc.text(i === 0 ? "•" : " ", MX, y); doc.text(ln, MX + 14, y); y += size + 3; });
      y += 3;
    }
    y += 4;
  };

  // ── Portada ────────────────────────────────────────────────────────────────
  doc.setFillColor(...ROJO).rect(0, 0, W, 6, "F");
  y = 120;
  doc.setFont("helvetica", "bold").setFontSize(24).setTextColor(...NEGRO);
  doc.splitTextToSize(textoPlano(s.titulo, 200), CW).forEach((ln: string) => { doc.text(ln, MX, y); y += 28; });
  if (s.subtitulo) { doc.setFont("helvetica", "normal").setFontSize(13).setTextColor(...GRIS); doc.text(textoPlano(s.subtitulo, 200), MX, y); y += 22; }
  y += 8;
  doc.setFontSize(10).setTextColor(...GRIS);
  const meta = [`Tipo: ${s.tipo_informe}`, s.periodo ? `Período: ${s.periodo}` : "", s.fecha_corte ? `Corte: ${s.fecha_corte}` : "", `Generado: ${ctx.generadoISO} · versión ${ctx.version}`].filter(Boolean);
  meta.forEach((m) => { doc.text(m, MX, y); y += 15; });
  y += 20;

  // ── Índice si es extenso ─────────────────────────────────────────────────────
  const extenso = s.secciones.length + s.tablas.length + s.graficos.length > 6;
  if (extenso) {
    titulo("Índice", 13);
    const idx = ["Resumen ejecutivo", ...(s.conclusiones.length ? ["Conclusiones"] : []), ...(s.hallazgos.length ? ["Hallazgos y anomalías"] : []), ...s.secciones.map((x) => x.titulo || "Sección"), ...(s.tablas.length ? ["Tablas"] : []), ...(s.graficos.length ? ["Gráficos"] : []), "Fuentes y metodología", ...(s.anexo.length ? ["Anexo de datos"] : [])];
    bullets(idx, 10);
  }

  // ── Resumen ejecutivo ────────────────────────────────────────────────────────
  titulo("Resumen ejecutivo");
  parrafo(s.resumen_ejecutivo);
  if (s.conclusiones.length) { titulo("Conclusiones", 13); bullets(s.conclusiones); }
  if (s.hallazgos.length) { titulo("Hallazgos y anomalías", 13); bullets(s.hallazgos); }

  // ── Secciones narrativas ─────────────────────────────────────────────────────
  for (const sec of s.secciones) { titulo(sec.titulo || "Sección", 13); parrafo(sec.cuerpo); }

  // ── Tablas ───────────────────────────────────────────────────────────────────
  const dibujarTabla = (t: Tabla) => {
    espacio(40);
    if (t.titulo) { doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NEGRO); doc.text(textoPlano(t.titulo, 200), MX, y); y += 14; }
    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX, top: MTOP, bottom: MBOT },
      head: [t.columnas.map((c) => c.etiqueta)],
      body: t.filas.map((fila) => t.columnas.map((c, i) => formatearCelda(fila[i] ?? null, c.tipo))),
      styles: { fontSize: 8, cellPadding: 3, textColor: NEGRO, lineColor: [220, 220, 220], lineWidth: 0.3 },
      headStyles: { fillColor: NEGRO, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      showHead: "everyPage",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    if (t.nota) parrafo(t.nota, 8, GRIS, 6);
  };
  if (s.tablas.length) { titulo("Tablas", 13); for (const t of s.tablas) dibujarTabla(t); }

  // ── Gráficos (PNG nítidos embebidos) ─────────────────────────────────────────
  if (s.graficos.length) {
    titulo("Gráficos", 13);
    for (const g of s.graficos) {
      const png = graficoPNG(g, 2);
      const imgW = CW, imgH = (CW * 520) / 900;
      espacio(imgH + 8);
      doc.addImage(png, "PNG", MX, y, imgW, imgH, undefined, "FAST");
      y += imgH + 6;
      if (g.nota) parrafo(g.nota, 8, GRIS, 6);
    }
  }

  // ── Fuentes y metodología ────────────────────────────────────────────────────
  titulo("Fuentes y metodología", 13);
  if (s.periodo) parrafo(`Período analizado: ${s.periodo}.`, 10, NEGRO, 2);
  if (s.fecha_corte) parrafo(`Fecha/hora de corte: ${s.fecha_corte}.`, 10, NEGRO, 2);
  parrafo(`Módulos consultados: ${s.modulos_consultados.join(", ") || "—"}.`, 10, NEGRO, 2);
  if (s.registros_utilizados != null) parrafo(`Registros utilizados: ${s.registros_utilizados}.`, 10, NEGRO, 2);
  if (s.metodologia) parrafo(s.metodologia, 10, NEGRO, 4);
  if (s.fuentes.length) bullets(s.fuentes.map((f) => `${f.modulo}${f.periodo ? ` · ${f.periodo}` : ""}${f.registros != null ? ` · ${f.registros} reg.` : ""}`), 9);

  // ── Advertencias / datos faltantes / cambios manuales ────────────────────────
  if (s.advertencias.length) { titulo("Advertencias", 12); bullets(s.advertencias, 9); }
  if (s.datos_faltantes.length) { titulo("Datos faltantes", 12); bullets(s.datos_faltantes, 9); }
  if (s.cambios_manuales.length) {
    titulo("Valores modificados manualmente", 12);
    parrafo("Los siguientes valores fueron alterados manualmente por el administrador y NO provienen directamente del sistema:", 9, [153, 27, 27], 4);
    bullets(s.cambios_manuales.map((c) => `${c.etiqueta} — sistema: ${String(c.valor_original ?? "—")} → manual: ${String(c.valor_nuevo ?? "—")}${c.motivo ? ` (${c.motivo})` : ""}`), 9);
  }

  // ── Anexo ────────────────────────────────────────────────────────────────────
  if (s.anexo.length) { doc.addPage(); y = MTOP; titulo("Anexo de datos", 14); for (const t of s.anexo) dibujarTabla(t); }

  // ── Encabezado + pie en todas las páginas ────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    // Encabezado discreto (no en la portada).
    if (p > 1) {
      doc.setFillColor(...ROJO).rect(0, 0, W, 3, "F");
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...GRIS);
      doc.text("SIM", MX, 22);
      doc.setFont("helvetica", "normal").setTextColor(...GRIS);
      doc.text(textoPlano(s.titulo, 80), W - MX, 22, { align: "right" });
      doc.setDrawColor(230, 230, 230).setLineWidth(0.5).line(MX, 30, W - MX, 30);
    }
    // Pie.
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GRIS);
    const pie = [`Generado: ${ctx.generadoISO}`, s.periodo ? `Período: ${s.periodo}` : ""].filter(Boolean).join("  ·  ");
    doc.text(pie, MX, H - 24);
    doc.text(`Página ${p} de ${total}`, W - MX, H - 24, { align: "right" });
  }

  // Metadata sin PII.
  doc.setProperties({ title: `Informe ${s.tipo_informe}${s.periodo ? " " + s.periodo : ""} v${ctx.version}`, subject: "Informe SIM", creator: "IA SIM", author: "SIM" });

  return Buffer.from(doc.output("arraybuffer"));
}
