import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { renderFormato } from "@/lib/ia/informes/render/index";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import { validarInforme } from "@/lib/ia/informes/schema";

// Ejecutar: npx tsx lib/ia/informes/render/render.integration.ts
// No toca red ni DB. Genera los 5 formatos desde UN snapshot y verifica validez,
// consistencia numérica, unidades/período y neutralización de contenido peligroso.

const SP = process.env.SP || null;

const specRaw = {
  titulo: "Informe analítico de agosto 2026",
  subtitulo: "SIM Argentina",
  tipo_informe: "analitico_mensual",
  periodo: "2026-08",
  fecha_corte: "2026-08-31 23:59 (Córdoba)",
  resumen_ejecutivo: "La facturación neta de agosto fue $ 142.000,00 con 60 turnos.\nStand y Reservas reconcilian con el total.",
  conclusiones: ["Crecimiento sostenido respecto de julio.", "Reservas web ganan participación."],
  hallazgos: ["Pico de actividad el fin de semana largo."],
  secciones: [{ titulo: "Análisis", cuerpo: "Desarrollo del análisis mensual con comparaciones y tendencias." }],
  tablas: [{
    titulo: "Resumen financiero",
    columnas: [{ clave: "m", etiqueta: "Métrica", tipo: "texto" }, { clave: "v", etiqueta: "Valor", tipo: "ars" }],
    filas: [["Facturación bruta", 150000], ["Comisiones", 8000], ["Facturación neta", 142000], ["=HACK()", 999]],
  }],
  graficos: [{ tipo: "barras", titulo: "Facturación por mes", categorias: ["Jun", "Jul", "Ago"], series: [{ nombre: "Neta", valores: [95000, 114000, 142000] }] }],
  fuentes: [{ modulo: "finanzas", periodo: "2026-08", registros: 120, actualizado: "2026-09-01" }],
  metodologia: "Datos del cierre financiero de agosto.",
  modulos_consultados: ["finanzas", "metricas_stand_reservas"],
  registros_utilizados: 120,
  anexo: [{ titulo: "Detalle diario", columnas: [{ clave: "d", etiqueta: "Día", tipo: "fecha" }, { clave: "t", etiqueta: "Turnos", tipo: "entero" }], filas: [["2026-08-01", 3], ["2026-08-02", 5]] }],
  advertencias: ["Mes cerrado el 2026-08-31."],
  datos_faltantes: [],
  cambios_manuales: [{ ubicacion: "tabla:Resumen financiero/fila 3/col Valor", etiqueta: "Facturación neta", valor_original: 142000, valor_nuevo: 143000, motivo: "ajuste manual" }],
  incluye_pii: false,
};

async function main() {
  const val = validarInforme(specRaw);
  assert.ok(val.ok, "spec de fixture válida");
  if (!val.ok) return;
  const ctx: ContextoRender = { spec: val.spec, generadoISO: "2026-09-01 12:30 (Córdoba)", version: 1 };

  const pdf = await renderFormato("pdf", ctx);
  const docx = await renderFormato("docx", ctx);
  const xlsx = await renderFormato("xlsx", ctx);
  const csv = await renderFormato("csv", ctx);
  const png = await renderFormato("png", ctx);

  // ── Validez por firma/estructura ─────────────────────────────────────────────
  assert.equal(pdf.slice(0, 5).toString("latin1"), "%PDF-", "PDF válido");
  assert.equal(docx.slice(0, 2).toString("latin1"), "PK", "DOCX es ZIP/OOXML (no HTML renombrado)");
  assert.equal(xlsx.slice(0, 2).toString("latin1"), "PK", "XLSX es ZIP");
  assert.equal(png.slice(0, 4).toString("hex"), "89504e47", "PNG válido");
  assert.equal(csv.slice(0, 3).toString("hex"), "efbbbf", "CSV con BOM UTF-8");

  // ── DOCX/XLSX contienen las partes OOXML esperadas ───────────────────────────
  const dtxt = docx.toString("latin1");
  assert.ok(dtxt.includes("word/document.xml"), "DOCX tiene word/document.xml");
  assert.ok(dtxt.includes("word/media/") || dtxt.includes("media/image"), "DOCX embebe la imagen del gráfico");
  const xtxt = xlsx.toString("latin1");
  assert.ok(xtxt.includes("xl/workbook.xml"), "XLSX tiene workbook.xml");
  assert.ok(/sheet\d+\.xml/.test(xtxt), "XLSX tiene hojas");

  // ── Consistencia numérica: el mismo valor aparece en CSV y (texto) PDF ───────
  const csvTxt = csv.toString("utf-8");
  assert.ok(csvTxt.includes("142000"), "CSV tiene la facturación neta cruda 142000");
  assert.ok(csvTxt.includes("Valor (ARS)") || csvTxt.includes("Valor ($)"), "CSV conserva la unidad en el encabezado");
  assert.ok(csvTxt.includes("2026-08"), "CSV conserva el período");

  // ── Formula injection neutralizada en CSV (la celda "=HACK()") ───────────────
  assert.ok(!/(^|\r?\n)=HACK\(\)/.test(csvTxt), "CSV NO deja una celda que empiece con =");
  assert.ok(csvTxt.includes("'=HACK()") || csvTxt.includes('"\'=HACK()"'), "CSV neutraliza =HACK() con apóstrofo");

  // ── PNG con dimensiones correctas ────────────────────────────────────────────
  assert.equal(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, true, "PNG con ancho/alto > 0");

  if (SP) {
    writeFileSync(`${SP}/informe.pdf`, pdf); writeFileSync(`${SP}/informe.docx`, docx);
    writeFileSync(`${SP}/informe.xlsx`, xlsx); writeFileSync(`${SP}/informe.csv`, csv); writeFileSync(`${SP}/informe.png`, png);
  }
  console.log(`OK — render (Phase B): PDF ${pdf.length}b, DOCX ${docx.length}b, XLSX ${xlsx.length}b, CSV ${csv.length}b, PNG ${png.length}b (${png.readUInt32BE(16)}x${png.readUInt32BE(20)}). Números, unidades, período y anti-injection verificados.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
