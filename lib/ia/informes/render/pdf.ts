// IA SIM · Bloque 4C/4C.3/4C.4 — Render PDF con jsPDF + autoTable. Determinístico y local.
// Identidad SIM (acento rojo, fondo blanco). Tipografía Liberation Sans REGULAR+BOLD
// INCRUSTADA (portabilidad consistente entre Poppler/Ghostscript/PDFium; el español se
// muestra con tildes). sanPdf solo normaliza caracteres tipográficos problemáticos en el
// LÍMITE de render (no toca el snapshot ni el Excel; conserva á é í ó ú ñ ü ¿ ¡). Una sola
// fecha de corte, gráficos como BLOQUE INDIVISIBLE, indicadores tipados por unidad,
// paginación que evita títulos huérfanos y páginas casi vacías.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { formatearCelda, formatearPorUnidad } from "@/lib/ia/informes/formato";
import { graficoPNG } from "@/lib/ia/informes/graficos";
import { FUENTE_SANS_B64 } from "@/lib/ia/informes/assets/fuenteBase64";
import { FUENTE_SANS_BOLD_B64 } from "@/lib/ia/informes/assets/fuenteSansBoldBase64";

const ROJO: [number, number, number] = [220, 38, 38];
const NEGRO: [number, number, number] = [10, 10, 10];
const GRIS: [number, number, number] = [110, 110, 110];
const MX = 48, MTOP = 64, MBOT = 44;
const FONT = "LiberationSans"; // familia INCRUSTADA (regular + bold)

const TIPO_LABEL: Record<string, string> = { analitico_mensual: "Informe analítico mensual", analitico: "Informe analítico", comparacion: "Comparación", foda: "Análisis FODA" };
const tipoLabel = (t: string) => TIPO_LABEL[t] ?? (t ? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Informe");

// Normalización SOLO tipográfica en el borde de render (la fuente incrustada cubre el
// español completo). NO elimina tildes ni convierte a ASCII: reemplaza únicamente
// caracteres que confunden a los visores (comillas curvas, guiones especiales, U+2212,
const CTRL = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "g");
const ESPACIOS = new RegExp("[\\u00A0\\u2007\\u2009\\u202F\\u2060\\uFEFF]", "g"); // no separables → espacio
function sanPdf(v: unknown, max = 20000): string {
  let s = v == null ? "" : String(v);
  s = s
    .replace(/[−‒–—―]/g, "-") // MINUS y guiones largos → '-'
    .replace(/[‘’‛′]/g, "'") // comillas simples curvas → '
    .replace(/[“”‟″]/g, '"') // comillas dobles curvas → "
    .replace(/…/g, "...")
    .replace(ESPACIOS, " ")
    .replace(CTRL, "");
  return s.slice(0, max);
}

export function renderPDF(ctx: ContextoRender): Buffer {
  const s = ctx.spec;
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });

  // ── Incrustar Liberation Sans (regular + bold) y usarla como fuente por defecto ──
  doc.addFileToVFS("LiberationSans-Regular.ttf", FUENTE_SANS_B64);
  doc.addFont("LiberationSans-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("LiberationSans-Bold.ttf", FUENTE_SANS_BOLD_B64);
  doc.addFont("LiberationSans-Bold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - MX * 2;
  const LIMITE = H - MBOT; // el contenido no puede pasar de aquí (zona de pie reservada)
  const UTIL = LIMITE - MTOP; // altura útil de una página nueva (bajo el encabezado)
  let y = MTOP;

  const nuevaPagina = () => { doc.addPage(); y = MTOP; };
  const espacio = (h: number) => { if (y + h > LIMITE) nuevaPagina(); };
  // Alto de un texto envuelto a un ancho dado.
  const medir = (txt: string, size: number, ancho = CW) => (doc.splitTextToSize(sanPdf(txt), ancho) as string[]).length * (size + 3);
  // Si un bloque de alto `h` no entra en lo que resta pero SÍ entra en una página nueva,
  // empieza en página nueva (así el bloque no se parte ni queda huérfano).
  const mantenerJuntos = (h: number) => { if (y + h > LIMITE && h <= UTIL) nuevaPagina(); };
  // Párrafo INDIVISIBLE: si entra completo en una página nueva, no se parte entre páginas
  // (solo se divide línea a línea cuando es más alto que una página entera).
  const parrafo = (txt: string, size = 10, color = NEGRO, gap = 6) => {
    if (!txt) return;
    doc.setFont(FONT, "normal").setFontSize(size).setTextColor(...color);
    const lineas = doc.splitTextToSize(sanPdf(txt), CW) as string[];
    mantenerJuntos(lineas.length * (size + 3));
    for (const ln of lineas) { espacio(size + 3); doc.text(ln, MX, y); y += size + 3; }
    y += gap;
  };
  // Título con "keep-with-next": si el título + el primer bloque (reservar) no entran en
  // lo que resta de página, se pasa a una página nueva (evita títulos huérfanos).
  const titulo = (txt: string, size = 14, reservar = size + 6) => {
    const alto = size + 9;
    if (y + alto + reservar > LIMITE) nuevaPagina();
    y += 4;
    doc.setFont(FONT, "bold").setFontSize(size).setTextColor(...NEGRO);
    doc.text(sanPdf(txt, 200), MX, y);
    doc.setDrawColor(...ROJO).setLineWidth(1.5).line(MX, y + 4, MX + 40, y + 4);
    y += size + 5;
  };
  const bullets = (items: string[], size = 10) => {
    for (const it of items) {
      doc.setFont(FONT, "normal").setFontSize(size).setTextColor(...NEGRO);
      const lineas = doc.splitTextToSize(sanPdf(it), CW - 14) as string[];
      lineas.forEach((ln, i) => { espacio(size + 3); if (i === 0) doc.text("-", MX, y); doc.text(ln, MX + 14, y); y += size + 3; });
      y += 2;
    }
    y += 3;
  };

  // ── Portada compacta ─────────────────────────────────────────────────────────
  doc.setFillColor(...ROJO).rect(0, 0, W, 6, "F");
  y = 88;
  doc.setFont(FONT, "bold").setFontSize(21).setTextColor(...NEGRO);
  doc.splitTextToSize(sanPdf(s.titulo, 200), CW).forEach((ln: string) => { doc.text(ln, MX, y); y += 25; });
  if (s.subtitulo) { doc.setFont(FONT, "normal").setFontSize(12).setTextColor(...GRIS); doc.text(sanPdf(s.subtitulo, 200), MX, y); y += 19; }
  y += 6;
  doc.setFont(FONT, "normal").setFontSize(10).setTextColor(...GRIS);
  // UNA sola fecha de corte (spec.fecha_corte) + generación por separado. Tipo AMIGABLE.
  const meta = [tipoLabel(s.tipo_informe), s.periodo ? `Período: ${s.periodo}` : "", s.fecha_corte ? `Corte de datos: ${s.fecha_corte} (Córdoba)` : "", `Generado: ${ctx.generadoISO} · versión ${ctx.version}`].filter(Boolean);
  meta.forEach((m) => { doc.text(sanPdf(m, 200), MX, y); y += 14; });
  y += 12;

  // ── Índice ───────────────────────────────────────────────────────────────────
  const extenso = s.secciones.length + s.tablas.length + s.graficos.length > 6;
  if (extenso) {
    const idx = ["Resumen ejecutivo", ...(s.conclusiones.length ? ["Conclusiones"] : []), ...s.secciones.map((x) => x.titulo || "Sección"), ...(s.tablas.length ? ["Tablas"] : []), ...(s.graficos.length ? ["Gráficos"] : []), "Fuentes y metodología", ...(s.anexo.length ? ["Anexo de datos"] : [])];
    titulo("Índice", 13, idx.length * 13);
    bullets(idx, 10);
  }

  // ── Resumen ejecutivo + Conclusiones ─────────────────────────────────────────
  titulo("Resumen ejecutivo", 14, 40);
  parrafo(s.resumen_ejecutivo);
  if (s.conclusiones.length) { titulo("Conclusiones", 13, 30); bullets(s.conclusiones); }
  if (s.hallazgos.length) { titulo("Hallazgos y anomalías", 13, 26); bullets(s.hallazgos); }
  else if (s.conclusiones.length) { titulo("Hallazgos y anomalías", 13, 26); parrafo("No se detectaron anomalías ni brechas de atribución en los datos utilizados.", 10, NEGRO, 4); }

  // ── Secciones narrativas ─────────────────────────────────────────────────────
  for (const sec of s.secciones) { titulo(sec.titulo || "Sección", 13, 30); parrafo(sec.cuerpo); }

  // Formatea una celda de tabla; si la fila tiene columna "uni", el "val" usa esa unidad.
  const idxUni = (t: Tabla) => t.columnas.findIndex((c) => c.clave === "uni");
  const idxVal = (t: Tabla) => t.columnas.findIndex((c) => c.clave === "val");
  const celda = (t: Tabla, fila: (string | number | boolean | null)[], ci: number): string => {
    const iu = idxUni(t), iv = idxVal(t);
    if (ci === iv && iu >= 0) return formatearPorUnidad(fila[ci] ?? null, String(fila[iu] ?? ""));
    return sanPdf(formatearCelda(fila[ci] ?? null, t.columnas[ci].tipo), 500);
  };
  const dibujarTabla = (t: Tabla) => {
    // Mantener el título de la tabla con al menos el encabezado + 1 fila.
    if (t.titulo && y + 13 + 34 > LIMITE) nuevaPagina();
    if (t.titulo) { doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...NEGRO); doc.text(sanPdf(t.titulo, 200), MX, y); y += 13; }
    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX, top: MTOP, bottom: MBOT },
      head: [t.columnas.map((c) => sanPdf(c.etiqueta, 60))],
      body: t.filas.map((fila) => t.columnas.map((_, i) => celda(t, fila, i))),
      styles: { font: FONT, fontStyle: "normal", fontSize: 8, cellPadding: 3, textColor: NEGRO, lineColor: [220, 220, 220], lineWidth: 0.3 },
      headStyles: { font: FONT, fillColor: NEGRO, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      showHead: "everyPage",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    if (t.nota) parrafo(t.nota, 8, GRIS, 6);
  };
  if (s.tablas.length) { titulo("Tablas", 13, 44); for (const t of s.tablas) dibujarTabla(t); }

  // ── Gráficos: cada uno es un BLOQUE INDIVISIBLE (nunca se parte entre páginas) ─
  if (s.graficos.length) {
    const imgW = CW, imgH = (CW * 520) / 900;
    const primerNota = s.graficos[0]?.nota ? 14 : 0;
    // El título se queda con el primer gráfico completo (evita título huérfano).
    titulo("Gráficos", 13, imgH + 12 + primerNota);
    for (const g of s.graficos) {
      const notaH = g.nota ? 14 : 0;
      const bloque = imgH + 10 + notaH;
      if (y + bloque > LIMITE) nuevaPagina(); // el bloque entra completo o va a nueva página
      const png = graficoPNG(g, 2);
      doc.addImage(png, "PNG", MX, y, imgW, imgH, undefined, "FAST");
      y += imgH + 6;
      if (g.nota) parrafo(g.nota, 8, GRIS, 8);
      else y += 6;
    }
  }

  // ── Fuentes y metodología: BLOQUE COHERENTE (título + módulos + metodología + fuentes).
  // Se mide completo y, si no entra en lo que resta, comienza en página nueva (así no arranca
  // a mitad de una oración ni el título queda separado de su primer párrafo). La metodología
  // se divide en párrafos INDIVISIBLES (cada oración no se parte entre páginas).
  const lineaModulos = `Módulos consultados: ${s.modulos_consultados.join(", ") || "—"}.`;
  const lineaRegistros = s.registros_utilizados != null ? `Registros utilizados: ${s.registros_utilizados}.` : "";
  const metodParrafos = (s.metodologia ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const fuentesLineas = s.fuentes.map((f) => `${f.modulo}${f.periodo ? ` · ${f.periodo}` : ""}${f.registros != null ? ` · ${f.registros} reg.` : ""}`);
  // Altura estimada del bloque completo (título + párrafos + metodología + fuentes).
  let hFuentes = 13 + 9 + 5; // título
  hFuentes += medir(lineaModulos, 10) + 2;
  if (lineaRegistros) hFuentes += medir(lineaRegistros, 10) + 2;
  for (const p of metodParrafos) hFuentes += medir(p, 10) + 4;
  hFuentes += fuentesLineas.reduce((acc, ln) => acc + medir(ln, 9, CW - 14) + 2, 0) + 3;
  mantenerJuntos(hFuentes);
  titulo("Fuentes y metodología", 13, medir(lineaModulos, 10));
  parrafo(lineaModulos, 10, NEGRO, 2);
  if (lineaRegistros) parrafo(lineaRegistros, 10, NEGRO, 2);
  for (const p of metodParrafos) parrafo(p, 10, NEGRO, 3);
  if (fuentesLineas.length) bullets(fuentesLineas, 9);

  // ── Advertencias / faltantes / cambios manuales ──────────────────────────────
  if (s.advertencias.length) { titulo("Advertencias", 12, 26); bullets(s.advertencias, 9); }
  if (s.datos_faltantes.length) { titulo("Datos faltantes", 12, 26); bullets(s.datos_faltantes, 9); }
  if (s.cambios_manuales.length) {
    titulo("Valores modificados manualmente", 12, 40);
    parrafo("Los siguientes valores fueron alterados manualmente por el administrador y NO provienen directamente del sistema:", 9, [153, 27, 27], 4);
    bullets(s.cambios_manuales.map((c) => `${c.etiqueta} - sistema: ${String(c.valor_original ?? "—")} -> manual: ${String(c.valor_nuevo ?? "—")}${c.motivo ? ` (${c.motivo})` : ""}`), 9);
  }

  // ── Anexo (fluye tras Fuentes/metodología si entra; sin forzar página casi vacía) ─
  if (s.anexo.length) {
    titulo("Anexo de datos", 14, 52); // se queda con el encabezado + primeras filas
    for (const t of s.anexo) dibujarTabla(t);
  }

  // ── Encabezado + pie en todas las páginas ────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFillColor(...ROJO).rect(0, 0, W, 3, "F");
      doc.setFont(FONT, "bold").setFontSize(8).setTextColor(...GRIS);
      doc.text("SIM", MX, 22);
      doc.setFont(FONT, "normal").setTextColor(...GRIS);
      doc.text(sanPdf(s.titulo, 80), W - MX, 22, { align: "right" });
      doc.setDrawColor(230, 230, 230).setLineWidth(0.5).line(MX, 30, W - MX, 30);
    }
    doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...GRIS);
    const pie = [`Corte: ${s.fecha_corte ?? "—"}`, s.periodo ? `Período: ${s.periodo}` : ""].filter(Boolean).join("  ·  ");
    doc.text(sanPdf(pie, 120), MX, H - 22);
    doc.text(`Página ${p} de ${total}`, W - MX, H - 22, { align: "right" });
  }

  doc.setProperties({ title: sanPdf(`${tipoLabel(s.tipo_informe)}${s.periodo ? " " + s.periodo : ""} v${ctx.version}`, 120), subject: "Informe SIM", creator: "IA SIM", author: "SIM" });
  return Buffer.from(doc.output("arraybuffer"));
}
