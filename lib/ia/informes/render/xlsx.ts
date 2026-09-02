// IA SIM · Bloque 4C — Render Excel (.xlsx real) con SheetJS. Hojas: Resumen, Datos,
// Fuentes y metodología, y una hoja por conjunto de datos del anexo. Números TIPADOS
// (no texto sin motivo), formatos por unidad, encabezados congelados, autofiltro,
// anchos legibles. Sin fórmulas/macros/conexiones. Protección anti formula injection.

import * as XLSX from "xlsx";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { valorTipado, unidadDe } from "@/lib/ia/informes/formato";
import { neutralizarFormula } from "@/lib/ia/informes/sanitizar";

type Celda = XLSX.CellObject;

function celdaTexto(v: string): Celda { return { t: "s", v: neutralizarFormula(v) }; }

function hojaDeTabla(t: Tabla): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const ncol = t.columnas.length;
  let maxRow = 0;
  // Encabezados con unidad.
  t.columnas.forEach((c, ci) => {
    const u = unidadDe(c.tipo);
    ws[XLSX.utils.encode_cell({ r: 0, c: ci })] = celdaTexto(u ? `${c.etiqueta} (${u})` : c.etiqueta);
  });
  t.filas.forEach((fila, ri) => {
    t.columnas.forEach((col, ci) => {
      const raw = fila[ci] ?? null;
      const addr = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
      if (raw == null) { ws[addr] = { t: "s", v: "" }; return; }
      if (typeof raw === "boolean") { ws[addr] = celdaTexto(raw ? "Sí" : "No"); return; }
      if (typeof raw === "number") {
        const { v, z } = valorTipado(raw, col.tipo);
        ws[addr] = { t: "n", v: Number(v), z };
        return;
      }
      // Texto: tipado 's' (no es fórmula) + neutralización defensiva.
      ws[addr] = celdaTexto(String(raw));
    });
    maxRow = ri + 1;
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxRow, 0), c: Math.max(ncol - 1, 0) } });
  ws["!cols"] = t.columnas.map((c) => ({ wch: Math.min(40, Math.max(12, c.etiqueta.length + 4)) }));
  // Encabezado congelado + autofiltro.
  ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" } as unknown as XLSX.WorkSheet["!freeze"];
  if (ncol > 0) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxRow, 0), c: ncol - 1 } }) };
  return ws;
}

function hojaResumen(ctx: ContextoRender): XLSX.WorkSheet {
  const s = ctx.spec;
  const filas: (string | number)[][] = [
    [s.titulo], s.subtitulo ? [s.subtitulo] : [""],
    ["Tipo", s.tipo_informe], ["Período", s.periodo ?? "—"], ["Corte", s.fecha_corte ?? "—"],
    ["Generado", `${ctx.generadoISO} · versión ${ctx.version}`], [""],
    ["Resumen ejecutivo"], [s.resumen_ejecutivo], [""],
    ["Conclusiones"], ...s.conclusiones.map((c) => [c]), [""],
    ["Hallazgos y anomalías"], ...s.hallazgos.map((h) => [h]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas.map((f) => f.map((c) => neutralizarFormula(c))));
  ws["!cols"] = [{ wch: 28 }, { wch: 70 }];
  return ws;
}

function hojaMetodologia(ctx: ContextoRender): XLSX.WorkSheet {
  const s = ctx.spec;
  const filas: (string | number)[][] = [
    ["Fuentes y metodología"], [""],
    ["Módulos consultados", s.modulos_consultados.join(", ")],
    ["Registros utilizados", s.registros_utilizados ?? "—"],
    ["Metodología", s.metodologia ?? "—"], [""],
    ["Fuentes"], ["Módulo", "Período", "Registros", "Actualizado"],
    ...s.fuentes.map((f) => [f.modulo, f.periodo ?? "", f.registros ?? "", f.actualizado ?? ""]),
    [""], ["Advertencias"], ...s.advertencias.map((a) => [a]),
    [""], ["Datos faltantes"], ...s.datos_faltantes.map((d) => [d]),
  ];
  if (s.cambios_manuales.length > 0) {
    filas.push([""], ["Cambios manuales del administrador"], ["Ubicación", "Etiqueta", "Valor original (sistema)", "Valor nuevo (manual)", "Motivo"]);
    for (const c of s.cambios_manuales) filas.push([c.ubicacion, c.etiqueta, String(c.valor_original ?? ""), String(c.valor_nuevo ?? ""), c.motivo ?? ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(filas.map((f) => f.map((c) => (typeof c === "number" ? c : neutralizarFormula(c)))));
  ws["!cols"] = [{ wch: 30 }, { wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 30 }];
  return ws;
}

function nombreHoja(base: string, usados: Set<string>): string {
  let n = base.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Datos";
  let i = 2; const orig = n;
  while (usados.has(n.toLowerCase())) { n = `${orig.slice(0, 25)} ${i++}`; }
  usados.add(n.toLowerCase());
  return n;
}

export function renderXLSX(ctx: ContextoRender): Buffer {
  const wb = XLSX.utils.book_new();
  const usados = new Set<string>();
  XLSX.utils.book_append_sheet(wb, hojaResumen(ctx), nombreHoja("Resumen", usados));

  // Hoja Datos: primera tabla del cuerpo (o todas apiladas si son pocas). Para claridad,
  // una hoja por tabla del cuerpo cuando hay varias.
  if (ctx.spec.tablas.length <= 1) {
    XLSX.utils.book_append_sheet(wb, ctx.spec.tablas[0] ? hojaDeTabla(ctx.spec.tablas[0]) : XLSX.utils.aoa_to_sheet([["(Sin tablas)"]]), nombreHoja("Datos", usados));
  } else {
    ctx.spec.tablas.forEach((t, i) => XLSX.utils.book_append_sheet(wb, hojaDeTabla(t), nombreHoja(t.titulo || `Datos ${i + 1}`, usados)));
  }

  XLSX.utils.book_append_sheet(wb, hojaMetodologia(ctx), nombreHoja("Fuentes y metodología", usados));

  // Una hoja por conjunto de datos del anexo.
  ctx.spec.anexo.forEach((t, i) => XLSX.utils.book_append_sheet(wb, hojaDeTabla(t), nombreHoja(t.titulo || `Anexo ${i + 1}`, usados)));

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
