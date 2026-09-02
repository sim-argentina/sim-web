import { strict as assert } from "node:assert";
import * as mupdf from "mupdf";
import ExcelJS from "exceljs";
import { armarDesde, type DatosMetricas, type MetaInforme } from "@/lib/ia/informes/completar";
import { renderFormato } from "@/lib/ia/informes/render/index";
import { validarInforme, type InformeSpec } from "@/lib/ia/informes/schema";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";

// Ejecutar: npx tsx lib/ia/informes/render/calidad4c3.integration.mts
// Verifica la CALIDAD de render de la Corrección 4C.3 sobre el binario real (PDF con
// mupdf, XLSX reabierto con ExcelJS). NO toca red/DB, NO llama a Claude. Usa el SNAPSHOT
// CONGELADO de la v2 (misma data/números) como fixture, sin re-ejecutar métricas.

// Snapshot congelado de la v2 (Federico, agosto 2026) — fixture de prueba, no producción.
const DATOS: DatosMetricas = {
  total: { turnos: 385, personas: 336, operaciones: 209.5, minutos: 5775, bruto: 4372000, comision: 35432.68, neto: 4336567.32 },
  stand: { turnos: 378, personas: 329, operaciones: 207.5, minutos: 5670, bruto: 4246000, comision: 35432.68, neto: 4210567.32 },
  reservas: { turnos: 7, personas: 7, operaciones: 2, minutos: 105, bruto: 126000, comision: 0, neto: 126000 },
  horas_minutos: 11640,
};
const META: MetaInforme = { integrante: "Federico", anio: 2026, mes: 8, corte: "2026-09-01 23:20", registros: { stand: 489, reservas: 3 }, cronograma: { estado: "confirmado", dias: 31, cerrados: 0 } };

const specBase = (validarInforme({ titulo: "Informe de métricas de Federico — agosto 2026", subtitulo: "SIM Argentina", tipo_informe: "analitico_mensual", resumen_ejecutivo: "Actividad de Federico en agosto 2026.", modulos_consultados: ["Métricas de Equipo"] }) as { ok: true; spec: InformeSpec }).spec;

async function main() {
  const armado = armarDesde(specBase, DATOS, META, ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"]);
  assert.ok(armado.ok, "armó el spec desde el snapshot congelado");
  if (!armado.ok) return;
  const spec = armado.spec;

  // Corte ÚNICO: el del snapshot (23:20), sin segundo corte.
  assert.equal(spec.fecha_corte, "2026-09-01 23:20", "fecha_corte = corte del snapshot (único)");
  // Conclusiones determinísticas presentes.
  assert.ok(spec.conclusiones.length >= 3, "conclusiones determinísticas presentes");
  assert.ok(spec.conclusiones.some((c) => /No se detectaron anomal/i.test(c)), "conclusión objetiva de anomalías");
  // Indicador de horas: número crudo 194, unidad aparte.
  const indic = spec.tablas[0];
  const horas = indic.filas.find((f) => String(f[0]).includes("Horas"))!;
  assert.equal(horas[1], 194, "194 número crudo");
  assert.equal(horas[2], "h", "unidad h en columna aparte");

  const ctx: ContextoRender = { spec, generadoISO: "2026-09-02 10:00 (Córdoba)", version: 3 };
  const pdf = await renderFormato("pdf", ctx);
  const xlsx = await renderFormato("xlsx", ctx);

  // ── PDF: texto real por páginas (mupdf) ──────────────────────────────────────
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const nP = doc.countPages();
  assert.ok(nP >= 1, "PDF con páginas");
  let texto = "";
  for (let i = 0; i < nP; i++) {
    const page = doc.loadPage(i);
    texto += page.toStructuredText("preserve-whitespace").asText() + "\n";
  }
  // Sin enum técnico visible.
  assert.ok(!/analitico_mensual/i.test(texto), "PDF NO muestra el enum 'analitico_mensual'");
  assert.ok(/Informe anal[ií]tico mensual/i.test(texto), "PDF muestra la etiqueta amigable del tipo");
  // Sin el signo MINUS U+2212 (causa del espaciado roto y 'neta = bruta \\ comisiones').
  assert.ok(!texto.includes("−"), "PDF sin U+2212 (MINUS); usa '-' ASCII");
  assert.ok(/neta = bruta - comisiones/i.test(texto), "metodología: 'neta = bruta - comisiones' correcto");
  // Un solo corte de datos visible (23:20); no aparece un 21:36 fantasma.
  assert.ok(texto.includes("2026-09-01 23:20"), "PDF muestra el corte único 23:20");
  assert.ok(!texto.includes("21:36"), "PDF sin segundo corte 21:36");
  // Sección de conclusiones explícita.
  assert.ok(/Conclusiones/i.test(texto), "PDF tiene sección Conclusiones");
  // Cifras clave presentes (misma data).
  assert.ok(texto.includes("194"), "PDF conserva 194 h");

  // ── XLSX: reabrir y verificar tipado/hoja/paneles/imágenes ───────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  const nombres = wb.worksheets.map((w) => w.name);
  // Nombres de hoja claros y sin cortar palabras a la mitad, ≤31 chars.
  for (const nm of nombres) {
    assert.ok(nm.length <= 31, `hoja '${nm}' ≤ 31 chars`);
    assert.ok(!/analitico_mensual/i.test(nm), `hoja '${nm}' sin enum`);
  }
  assert.ok(nombres.includes("Indicadores"), "hoja Indicadores");
  assert.ok(nombres.includes("Resumen"), "hoja Resumen");
  assert.ok(nombres.some((n) => /Gr[aá]ficos/.test(n)), "hoja Gráficos");

  // Indicadores: el valor de horas es NÚMERO (no string "194 h").
  const wsInd = wb.getWorksheet("Indicadores")!;
  let celdaHoras: ExcelJS.Cell | null = null;
  wsInd.eachRow((row) => { const c1 = row.getCell(1).value; if (typeof c1 === "string" && c1.includes("Horas")) celdaHoras = row.getCell(2); });
  assert.ok(celdaHoras, "fila de horas en Indicadores");
  assert.equal(typeof (celdaHoras as unknown as ExcelJS.Cell).value, "number", "valor de horas es número tipado");
  assert.equal((celdaHoras as unknown as ExcelJS.Cell).value, 194, "valor de horas = 194");
  // Encabezado congelado.
  assert.ok(wsInd.views?.[0]?.state === "frozen", "Indicadores con encabezado congelado");
  // Autofiltro.
  assert.ok(wsInd.autoFilter, "Indicadores con autofiltro");

  // Facturación bruta tipada como número (no "$ 4.372.000" string).
  let celdaBruto: ExcelJS.Cell | null = null;
  wsInd.eachRow((row) => { const c1 = row.getCell(1).value; if (typeof c1 === "string" && /bruta/i.test(c1)) celdaBruto = row.getCell(2); });
  assert.equal(typeof (celdaBruto as unknown as ExcelJS.Cell)?.value, "number", "facturación bruta es número tipado");
  assert.equal((celdaBruto as unknown as ExcelJS.Cell).value, 4372000, "bruta = 4372000 (cruda)");

  // La hoja de Gráficos tiene imágenes embebidas.
  const wsG = wb.worksheets.find((w) => /Gr[aá]ficos/.test(w.name))!;
  assert.ok(wsG.getImages().length >= 1, "hoja Gráficos con imagen(es) embebida(s)");
  // Conclusiones no vacías en Resumen.
  const wsR = wb.getWorksheet("Resumen")!;
  let hayConcl = false, textoConcl = "";
  wsR.eachRow((row) => { row.eachCell((c) => { const v = c.value; if (typeof v === "string") { if (/^Conclusiones$/i.test(v.trim())) hayConcl = true; if (/actividad total/i.test(v)) textoConcl += v; } }); });
  assert.ok(hayConcl, "Resumen con título Conclusiones");
  assert.ok(textoConcl.length > 0, "Conclusiones con contenido (no vacías)");

  console.log(`OK — calidad4c3 (render): PDF ${pdf.length}b / ${nP} pág sin enum, sin U+2212, corte único 23:20, 'neta = bruta - comisiones', Conclusiones; XLSX ${xlsx.length}b hojas [${nombres.join(", ")}] con horas=194 y bruta=4372000 TIPADAS, encabezado congelado + autofiltro + gráficos embebidos + Conclusiones con contenido.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
