// IA SIM · Bloque 4C — Render CSV. UTF-8 (con BOM), encabezados claros con unidad,
// separador consistente, comillas/saltos escapados y protección anti formula injection.
// Los números salen crudos (punto decimal) para ser parseables; la unidad va en el
// encabezado. Apila todas las tablas del cuerpo + anexo con su título.

import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { Tabla } from "@/lib/ia/informes/schema";
import { celdaCSV } from "@/lib/ia/informes/sanitizar";
import { unidadDe } from "@/lib/ia/informes/formato";

const SEP = ",";
const BOM = "﻿";

function tablaACSV(t: Tabla): string[] {
  const lineas: string[] = [];
  if (t.titulo) lineas.push(celdaCSV(`# ${t.titulo}`, SEP));
  const headers = t.columnas.map((c) => { const u = unidadDe(c.tipo); return celdaCSV(u ? `${c.etiqueta} (${u})` : c.etiqueta, SEP); });
  lineas.push(headers.join(SEP));
  for (const fila of t.filas) {
    const cels = t.columnas.map((_, i) => {
      const v = fila[i] ?? null;
      if (v == null) return "";
      if (typeof v === "number") return String(v); // crudo, parseable
      if (typeof v === "boolean") return v ? "Sí" : "No";
      return celdaCSV(v, SEP);
    });
    lineas.push(cels.join(SEP));
  }
  return lineas;
}

export function renderCSV(ctx: ContextoRender): Buffer {
  const { spec } = ctx;
  const out: string[] = [];
  out.push(celdaCSV(`# ${spec.titulo}`, SEP));
  if (spec.periodo) out.push(celdaCSV(`# Período: ${spec.periodo}`, SEP));
  if (spec.fecha_corte) out.push(celdaCSV(`# Corte: ${spec.fecha_corte}`, SEP));
  out.push(celdaCSV(`# Generado: ${ctx.generadoISO} · versión ${ctx.version}`, SEP));

  const todas = [...spec.tablas, ...spec.anexo];
  if (todas.length === 0) {
    out.push("");
    out.push(celdaCSV("(Este informe no tiene tablas de datos.)", SEP));
  }
  for (const t of todas) { out.push(""); out.push(...tablaACSV(t)); }

  // Fuentes al final.
  if (spec.fuentes.length > 0) {
    out.push("");
    out.push(celdaCSV("# Fuentes", SEP));
    out.push(["modulo", "periodo", "registros", "actualizado"].join(SEP));
    for (const f of spec.fuentes) out.push([celdaCSV(f.modulo, SEP), celdaCSV(f.periodo ?? "", SEP), f.registros ?? "", celdaCSV(f.actualizado ?? "", SEP)].join(SEP));
  }
  return Buffer.from(BOM + out.join("\r\n"), "utf-8");
}
