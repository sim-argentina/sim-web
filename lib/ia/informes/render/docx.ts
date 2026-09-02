// IA SIM · Bloque 4C — Render Word (.docx REAL, OOXML) con la librería `docx`.
// Estilos y títulos estructurados, tablas editables, gráficos insertados, encabezado
// y pie SIM, numeración de página. Documento válido y reabrible. Sin macros.

import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, Header, Footer, PageNumber, AlignmentType, BorderStyle, ShadingType } from "docx";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { formatearCelda } from "@/lib/ia/informes/formato";
import { graficoPNG } from "@/lib/ia/informes/graficos";
import { textoPlano } from "@/lib/ia/informes/sanitizar";

const ROJO = "DC2626", NEGRO = "0A0A0A", GRIS = "6E6E6E";

function parrafos(txt: string): Paragraph[] {
  return textoPlano(txt, 20000).split(/\n+/).filter(Boolean).map((linea) => new Paragraph({ children: [new TextRun({ text: linea, size: 20 })], spacing: { after: 120 } }));
}
function h(txt: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun({ text: textoPlano(txt, 200), bold: true, color: NEGRO })], spacing: { before: 240, after: 120 }, border: { bottom: { color: ROJO, size: 6, style: BorderStyle.SINGLE, space: 2 } } });
}
function bullets(items: string[]): Paragraph[] {
  return items.map((it) => new Paragraph({ text: textoPlano(it, 2000), bullet: { level: 0 }, spacing: { after: 60 } }));
}

function tablaDocx(t: Tabla): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (t.titulo) out.push(new Paragraph({ children: [new TextRun({ text: textoPlano(t.titulo, 200), bold: true, size: 22 })], spacing: { before: 160, after: 80 } }));
  const header = new TableRow({
    tableHeader: true,
    children: t.columnas.map((c) => new TableCell({ shading: { type: ShadingType.SOLID, color: NEGRO, fill: NEGRO }, children: [new Paragraph({ children: [new TextRun({ text: textoPlano(c.etiqueta, 120), bold: true, color: "FFFFFF", size: 18 })] })] })),
  });
  const filas = t.filas.slice(0, 2000).map((fila) => new TableRow({
    children: t.columnas.map((c, i) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatearCelda(fila[i] ?? null, c.tipo), size: 16 })] })] })),
  }));
  out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...filas] }));
  if (t.nota) out.push(new Paragraph({ children: [new TextRun({ text: textoPlano(t.nota, 600), italics: true, color: GRIS, size: 16 })], spacing: { after: 120 } }));
  return out;
}

export async function renderDOCX(ctx: ContextoRender): Promise<Buffer> {
  const s = ctx.spec;
  const cuerpo: (Paragraph | Table)[] = [];

  // Portada
  cuerpo.push(new Paragraph({ children: [new TextRun({ text: textoPlano(s.titulo, 200), bold: true, size: 48, color: NEGRO })], spacing: { after: 120 } }));
  if (s.subtitulo) cuerpo.push(new Paragraph({ children: [new TextRun({ text: textoPlano(s.subtitulo, 200), size: 26, color: GRIS })], spacing: { after: 120 } }));
  const meta = [`Tipo: ${s.tipo_informe}`, s.periodo ? `Período: ${s.periodo}` : "", s.fecha_corte ? `Corte: ${s.fecha_corte}` : "", `Generado: ${ctx.generadoISO} · versión ${ctx.version}`].filter(Boolean);
  cuerpo.push(new Paragraph({ children: meta.map((m) => new TextRun({ text: m, size: 18, color: GRIS, break: 1 })), spacing: { after: 240 } }));

  cuerpo.push(h("Resumen ejecutivo", HeadingLevel.HEADING_1), ...parrafos(s.resumen_ejecutivo));
  if (s.conclusiones.length) cuerpo.push(h("Conclusiones", HeadingLevel.HEADING_2), ...bullets(s.conclusiones));
  if (s.hallazgos.length) cuerpo.push(h("Hallazgos y anomalías", HeadingLevel.HEADING_2), ...bullets(s.hallazgos));
  for (const sec of s.secciones) cuerpo.push(h(sec.titulo || "Sección", HeadingLevel.HEADING_2), ...parrafos(sec.cuerpo));

  if (s.tablas.length) { cuerpo.push(h("Tablas", HeadingLevel.HEADING_1)); for (const t of s.tablas) cuerpo.push(...tablaDocx(t)); }

  if (s.graficos.length) {
    cuerpo.push(h("Gráficos", HeadingLevel.HEADING_1));
    for (const g of s.graficos) {
      const png = graficoPNG(g, 2);
      cuerpo.push(new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 600, height: Math.round((600 * 520) / 900) } })], spacing: { after: 120 } }));
      if (g.nota) cuerpo.push(new Paragraph({ children: [new TextRun({ text: textoPlano(g.nota, 600), italics: true, color: GRIS, size: 16 })], spacing: { after: 120 } }));
    }
  }

  cuerpo.push(h("Fuentes y metodología", HeadingLevel.HEADING_1));
  cuerpo.push(new Paragraph({ children: [new TextRun({ text: `Módulos consultados: ${s.modulos_consultados.join(", ") || "—"}.`, size: 20 })], spacing: { after: 80 } }));
  if (s.registros_utilizados != null) cuerpo.push(new Paragraph({ children: [new TextRun({ text: `Registros utilizados: ${s.registros_utilizados}.`, size: 20 })], spacing: { after: 80 } }));
  if (s.metodologia) cuerpo.push(...parrafos(s.metodologia));
  if (s.fuentes.length) cuerpo.push(...bullets(s.fuentes.map((f) => `${f.modulo}${f.periodo ? ` · ${f.periodo}` : ""}${f.registros != null ? ` · ${f.registros} reg.` : ""}`)));

  if (s.advertencias.length) { cuerpo.push(h("Advertencias", HeadingLevel.HEADING_2)); cuerpo.push(...bullets(s.advertencias)); }
  if (s.datos_faltantes.length) { cuerpo.push(h("Datos faltantes", HeadingLevel.HEADING_2)); cuerpo.push(...bullets(s.datos_faltantes)); }
  if (s.cambios_manuales.length) {
    cuerpo.push(h("Valores modificados manualmente", HeadingLevel.HEADING_2));
    cuerpo.push(new Paragraph({ children: [new TextRun({ text: "Los siguientes valores fueron alterados manualmente por el administrador y NO provienen directamente del sistema:", color: "991B1B", size: 18 })], spacing: { after: 80 } }));
    cuerpo.push(...bullets(s.cambios_manuales.map((c) => `${c.etiqueta} — sistema: ${String(c.valor_original ?? "—")} → manual: ${String(c.valor_nuevo ?? "—")}${c.motivo ? ` (${c.motivo})` : ""}`)));
  }

  if (s.anexo.length) { cuerpo.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })], pageBreakBefore: true }), h("Anexo de datos", HeadingLevel.HEADING_1)); for (const t of s.anexo) cuerpo.push(...tablaDocx(t)); }

  const doc = new Document({
    creator: "IA SIM", title: `Informe ${s.tipo_informe}`, description: "Informe SIM",
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `SIM · ${textoPlano(s.titulo, 60)}`, size: 14, color: GRIS })], border: { bottom: { color: ROJO, size: 6, style: BorderStyle.SINGLE, space: 1 } } })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generado ${ctx.generadoISO}${s.periodo ? " · Período " + s.periodo : ""} · Página `, size: 14, color: GRIS }), new TextRun({ children: [PageNumber.CURRENT], size: 14, color: GRIS }), new TextRun({ text: " de ", size: 14, color: GRIS }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: GRIS })] })] }) },
      children: cuerpo,
    }],
  });
  return await Packer.toBuffer(doc);
}
