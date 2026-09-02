import { strict as assert } from "node:assert";
import * as mupdf from "mupdf";
import ExcelJS from "exceljs";
import { armarDesde, type DatosMetricas, type MetaInforme } from "@/lib/ia/informes/completar";
import { renderFormato } from "@/lib/ia/informes/render/index";
import { validarInforme, type InformeSpec } from "@/lib/ia/informes/schema";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/informes/render/calidad4c4.integration.mts
// Verifica la Corrección 4C.4 sobre el binario: fuente Liberation Sans INCRUSTADA
// (FontFile2 x2), español CON tildes en el PDF, y autofiltros del Excel sobre la tabla
// completa. NO red/DB, NO Claude; snapshot congelado como fixture.

const DATOS: DatosMetricas = {
  total: { turnos: 385, personas: 336, operaciones: 209.5, minutos: 5775, bruto: 4372000, comision: 35432.68, neto: 4336567.32 },
  stand: { turnos: 378, personas: 329, operaciones: 207.5, minutos: 5670, bruto: 4246000, comision: 35432.68, neto: 4210567.32 },
  reservas: { turnos: 7, personas: 7, operaciones: 2, minutos: 105, bruto: 126000, comision: 0, neto: 126000 },
  horas_minutos: 11640,
};
const META: MetaInforme = { integrante: "Federico", anio: 2026, mes: 8, corte: "2026-09-01 23:20", registros: { stand: 489, reservas: 3 }, cronograma: { estado: "confirmado", dias: 31, cerrados: 0 } };
const specBase = (validarInforme({ titulo: "Informe de métricas de Federico - agosto 2026", subtitulo: "SIM Argentina", tipo_informe: "analitico_mensual", resumen_ejecutivo: "Actividad de Federico en agosto 2026.", modulos_consultados: ["Métricas de Equipo"] }) as { ok: true; spec: InformeSpec }).spec;

async function main() {
  const armado = armarDesde(specBase, DATOS, META, ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"]);
  assert.ok(armado.ok); if (!armado.ok) return;
  const ctx: ContextoRender = { spec: armado.spec, generadoISO: "2026-09-02 11:30 (Córdoba)", version: 4 };
  const pdf = await renderFormato("pdf", ctx);
  const xlsx = await renderFormato("xlsx", ctx);

  // ── PDF: fuente INCRUSTADA ───────────────────────────────────────────────────
  const raw = pdf.toString("latin1");
  const fontFile2 = (raw.match(/\/FontFile2/g) || []).length;
  assert.ok(fontFile2 >= 2, `Liberation Sans regular+bold incrustadas (FontFile2 x${fontFile2})`);
  assert.ok(/\/BaseFont\s*\/LiberationSans/.test(raw), "BaseFont LiberationSans presente");

  // ── PDF: español CON tildes (no ASCII) ───────────────────────────────────────
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  let texto = "";
  for (let i = 0; i < doc.countPages(); i++) texto += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  for (const w of ["concentró", "facturación", "reconciliación", "anomalías", "atribución", "según", "comisión", "días"]) {
    assert.ok(texto.includes(w), `tilde conservada: ${w}`);
  }
  assert.ok(!texto.includes("−"), "sin U+2212");
  assert.ok(/neta = bruta - comisiones/.test(texto), "neta = bruta - comisiones");
  assert.ok(!/analitico_mensual/i.test(texto), "sin enum");
  assert.ok(texto.includes("2026-09-01 23:20") && !texto.includes("T23:20"), "corte único sin T");

  // ── XLSX: autofiltros sobre la TABLA COMPLETA + tildes ───────────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  const af = (n: string) => { const ws = wb.getWorksheet(n)!; return ws.autoFilter as unknown as string; };
  const ref = (a: unknown): string => (typeof a === "string" ? a : "");
  assert.equal(ref(af("Indicadores")), "A1:C9", "Indicadores filtra A1:C9");
  assert.equal(ref(af("Por origen")), "A1:H3", "Por origen filtra A1:H3");
  assert.equal(ref(af("Anexo")), "A1:H4", "Anexo filtra A1:H4");
  assert.equal(ref(af("Fuentes y método")), "A1:D5", "Fuentes y método filtra A1:D5");
  // Tildes en el Excel (conclusión con "concentró"/"facturación").
  let concl = "";
  wb.getWorksheet("Resumen")!.eachRow((row) => row.eachCell((c) => { if (typeof c.value === "string" && /concentr/i.test(c.value)) concl = c.value; }));
  assert.ok(/concentró/.test(concl) && /facturación/.test(concl), "conclusión con tildes en Excel");
  // Números tipados preservados.
  const ind = wb.getWorksheet("Indicadores")!;
  let horas: unknown = null;
  ind.eachRow((r) => { if (typeof r.getCell(1).value === "string" && String(r.getCell(1).value).includes("Horas")) horas = r.getCell(2).value; });
  assert.equal(typeof horas, "number"); assert.equal(horas, 194);

  console.log(`OK — calidad4c4 (render): PDF ${pdf.length}b con Liberation Sans INCRUSTADA (FontFile2 x${fontFile2}), tildes correctas, sin U+2212, corte único; XLSX autofiltros A1:C9 / A1:H3 / A1:H4 / A1:D5, conclusiones con tildes, horas=194 tipada.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
