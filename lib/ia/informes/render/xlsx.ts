// IA SIM · Bloque 4C.3 — Render Excel (.xlsx) con ExcelJS. Herramienta analítica, no
// exportación de texto: valores NUMÉRICOS tipados con formato por unidad, hojas con
// nombres claros (sin truncar palabras), encabezados congelados, autofiltro, anchos
// razonables, hoja de Gráficos con las mismas imágenes del PDF, y Resumen sin secciones
// vacías (conclusiones y hallazgos con contenido). Identidad SIM.

import ExcelJS from "exceljs";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { neutralizarFormula } from "@/lib/ia/informes/sanitizar";
import { zPorUnidad } from "@/lib/ia/informes/formato";
import { graficoPNG } from "@/lib/ia/informes/graficos";

const ROJO = "FFDC2626", NEGRO = "FF0A0A0A", BLANCO = "FFFFFFFF";
const TIPO_LABEL: Record<string, string> = { analitico_mensual: "Informe analítico mensual", analitico: "Informe analítico", comparacion: "Comparación", foda: "Análisis FODA" };
const tipoLabel = (t: string) => TIPO_LABEL[t] ?? (t ? t.replace(/_/g, " ") : "Informe");

// Formato numérico de Excel por tipo de columna.
function numFmt(tipo: string): string | undefined {
  switch (tipo) {
    case "entero": return "#,##0";
    case "decimal": return "#,##0.0";
    case "ars": return '"$ "#,##0.00';
    case "usd": return '"US$ "#,##0.00';
    case "porcentaje": return "0.0%";
    case "horas": return "#,##0";
    case "minutos": return "#,##0";
    default: return undefined;
  }
}
const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function estiloEncabezado(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEGRO } };
    cell.font = { bold: true, color: { argb: BLANCO } };
    cell.alignment = { vertical: "middle" };
  });
  row.height = 18;
}

// Escribe una tabla como hoja con encabezado congelado + autofiltro + tipado numérico.
// Si la tabla tiene columna "uni" (indicadores), tipa el "val" según la unidad de cada fila.
function hojaTabla(wb: ExcelJS.Workbook, nombre: string, t: Tabla, opts?: { totalUltimaFila?: boolean }) {
  const ws = wb.addWorksheet(nombre.slice(0, 31));
  const iu = t.columnas.findIndex((c) => c.clave === "uni");
  const iv = t.columnas.findIndex((c) => c.clave === "val");
  const header = ws.addRow(t.columnas.map((c) => c.etiqueta));
  estiloEncabezado(header);
  t.filas.forEach((fila, fi) => {
    const valores = fila.map((v) => (typeof v === "boolean" ? (v ? "Sí" : "No") : v));
    const row = ws.addRow(valores.map((v) => (typeof v === "string" ? neutralizarFormula(v) : v)));
    row.eachCell((cell, col) => {
      const ci = col - 1;
      const raw = fila[ci];
      if (esNum(raw)) {
        cell.value = raw;
        // Indicadores: el "val" se tipa por su unidad; el resto por el tipo de columna.
        const z = ci === iv && iu >= 0 ? zPorUnidad(raw, String(fila[iu] ?? "")) : numFmt(t.columnas[ci].tipo);
        if (z) cell.numFmt = z;
      }
    });
    if (opts?.totalUltimaFila && fi === t.filas.length - 1) row.eachCell((c) => (c.font = { bold: true }));
  });
  ws.columns.forEach((col, i) => {
    const etiqueta = t.columnas[i]?.etiqueta ?? "";
    let max = etiqueta.length + 2;
    t.filas.forEach((f) => { const v = f[i]; max = Math.max(max, String(v ?? "").length + 2); });
    col.width = Math.min(38, Math.max(12, max));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columnas.length } };
  return ws;
}

export async function renderXLSX(ctx: ContextoRender): Promise<Buffer> {
  const s = ctx.spec;
  const wb = new ExcelJS.Workbook();
  wb.creator = "IA SIM"; wb.created = new Date();

  // ── Resumen ─────────────────────────────────────────────────────────────────
  const R = wb.addWorksheet("Resumen");
  R.columns = [{ width: 26 }, { width: 80 }];
  const linea = (k: string, v: string, bold = false) => { const r = R.addRow([k, v]); if (bold) r.getCell(1).font = { bold: true }; return r; };
  const tit = R.addRow([s.titulo]); tit.getCell(1).font = { bold: true, size: 15, color: { argb: ROJO } }; R.mergeCells(tit.number, 1, tit.number, 2);
  if (s.subtitulo) { const sr = R.addRow([s.subtitulo]); sr.getCell(1).font = { color: { argb: "FF666666" } }; R.mergeCells(sr.number, 1, sr.number, 2); }
  R.addRow([]);
  linea("Tipo", tipoLabel(s.tipo_informe), true);
  linea("Período", s.periodo ?? "—", true);
  linea("Corte de datos", s.fecha_corte ? `${s.fecha_corte} (Córdoba)` : "—", true);
  linea("Generado", `${ctx.generadoISO} · versión ${ctx.version}`, true);
  R.addRow([]);
  R.addRow(["Resumen ejecutivo"]).getCell(1).font = { bold: true, size: 12 };
  for (const p of s.resumen_ejecutivo.split(/\n+/).filter(Boolean)) { const r = R.addRow(["", p]); r.getCell(2).alignment = { wrapText: true }; }
  R.addRow([]);
  R.addRow(["Conclusiones"]).getCell(1).font = { bold: true, size: 12 };
  const concl = s.conclusiones.length ? s.conclusiones : ["No hay conclusiones registradas."];
  for (const c of concl) { const r = R.addRow(["", `• ${c}`]); r.getCell(2).alignment = { wrapText: true }; }
  R.addRow([]);
  R.addRow(["Hallazgos y anomalías"]).getCell(1).font = { bold: true, size: 12 };
  const hall = s.hallazgos.length ? s.hallazgos : ["No se detectaron anomalías ni brechas de atribución en los datos utilizados."];
  for (const h of hall) { const r = R.addRow(["", `• ${h}`]); r.getCell(2).alignment = { wrapText: true }; }

  // ── Hojas de datos (Indicadores / Por origen) ────────────────────────────────
  const usados = new Set(["resumen"]);
  const nombreDe = (t: Tabla, i: number): string => {
    if (t.columnas.some((c) => c.clave === "uni")) return "Indicadores";
    if (/origen/i.test(t.titulo)) return "Por origen";
    const base = (t.titulo || `Datos ${i + 1}`).split(/[—(]/)[0].trim().slice(0, 31) || `Datos ${i + 1}`;
    let n = base; let k = 2; while (usados.has(n.toLowerCase())) n = `${base.slice(0, 27)} ${k++}`;
    usados.add(n.toLowerCase()); return n;
  };
  for (let i = 0; i < s.tablas.length; i++) { const nm = nombreDe(s.tablas[i], i); usados.add(nm.toLowerCase()); hojaTabla(wb, nm, s.tablas[i]); }

  // ── Gráficos (mismas imágenes que el PDF) ────────────────────────────────────
  if (s.graficos.length) {
    const G = wb.addWorksheet("Gráficos");
    G.getColumn(1).width = 4;
    let row = 1;
    for (const g of s.graficos) {
      const png = graficoPNG(g, 2);
      const id = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: "png" });
      G.addImage(id, { tl: { col: 1, row }, ext: { width: 640, height: 370 } });
      row += 21; // deja espacio para la imagen
    }
  }

  // ── Fuentes y método ─────────────────────────────────────────────────────────
  const F = wb.addWorksheet("Fuentes y método");
  F.columns = [{ width: 30 }, { width: 22 }, { width: 14 }, { width: 24 }];
  const fh = F.addRow(["Módulo", "Período", "Registros", "Actualizado"]); estiloEncabezado(fh);
  for (const f of s.fuentes) { const r = F.addRow([f.modulo, f.periodo ?? "", f.registros ?? "", f.actualizado ?? ""]); if (esNum(f.registros)) r.getCell(3).numFmt = "#,##0"; }
  F.addRow([]);
  F.addRow(["Metodología"]).getCell(1).font = { bold: true, size: 12 };
  for (const p of (s.metodologia ?? "").split(/\n+/).filter(Boolean)) { const r = F.addRow(["", p]); F.mergeCells(r.number, 2, r.number, 4); r.getCell(2).alignment = { wrapText: true }; }
  F.views = [{ state: "frozen", ySplit: 1 }];

  // ── Anexo ────────────────────────────────────────────────────────────────────
  s.anexo.forEach((t, i) => hojaTabla(wb, i === 0 ? "Anexo" : `Anexo ${i + 1}`, t, { totalUltimaFila: true }));

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
