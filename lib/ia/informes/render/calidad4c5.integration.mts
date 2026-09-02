import { strict as assert } from "node:assert";
import * as mupdf from "mupdf";
import ExcelJS from "exceljs";
import { armarDesde, type DatosMetricas, type MetaInforme } from "@/lib/ia/informes/completar";
import { renderFormato } from "@/lib/ia/informes/render/index";
import { validarInforme, type InformeSpec } from "@/lib/ia/informes/schema";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/informes/render/calidad4c5.integration.mts
// Verifica la Corrección 4C.5 (continuidad de páginas + encabezado) sobre el binario:
// 4 páginas, fuente incrustada, la página 4 empieza por "Fuentes y metodología" (no a mitad de
// oración), ninguna oración se parte entre páginas, pies "Página X de 4", corte único, tildes,
// y el Excel intacto (filtros completos, números tipados, 2 gráficos). NO red/DB, NO Claude.

const DATOS: DatosMetricas = {
  total: { turnos: 385, personas: 336, operaciones: 209.5, minutos: 5775, bruto: 4372000, comision: 35432.68, neto: 4336567.32 },
  stand: { turnos: 378, personas: 329, operaciones: 207.5, minutos: 5670, bruto: 4246000, comision: 35432.68, neto: 4210567.32 },
  reservas: { turnos: 7, personas: 7, operaciones: 2, minutos: 105, bruto: 126000, comision: 0, neto: 126000 },
  horas_minutos: 11640,
};
const META: MetaInforme = { integrante: "Federico", anio: 2026, mes: 8, corte: "2026-09-01 23:20", registros: { stand: 489, reservas: 3 }, cronograma: { estado: "confirmado", dias: 31, cerrados: 0 } };
// Spec realista (5 secciones + resumen largo) para reproducir el layout de 4 páginas.
const specBase = (validarInforme({
  titulo: "Informe de Métricas Operativas - Federico Agosto 2026",
  subtitulo: "Análisis de actividad, desempeño y facturación",
  tipo_informe: "analitico_mensual",
  resumen_ejecutivo: "Durante agosto de 2026, Federico completó 194 horas de cronograma confirmado, atendiendo 385 turnos con 336 personas/simuladores y generando una facturación bruta de $4.372.000 ARS. La facturación neta (tras comisiones de $35.432,68 ARS) fue de $4.336.567,32 ARS, representando el 42,1% del ingreso bruto total del equipo. El mes fue confirmado, completo, sin anomalías ni brechas de atribución (reconciliación OK).",
  secciones: [
    { titulo: "1. Producción Operativa", cuerpo: "Federico trabajó 194 horas durante agosto (11.640 minutos de cronograma confirmado). Atendió 385 turnos correspondientes a 336 personas/simuladores, acumulando 5.775 minutos-persona de actividad comercial (esta métrica no equivale a horas trabajadas del cronograma; mide volumen comercial atendido). Registró 209,5 operaciones (sesiones/eventos fuente)." },
    { titulo: "2. Desempeño Financiero", cuerpo: "La facturación bruta fue de $4.372.000 ARS. Las comisiones ascendieron a $35.432,68 ARS, resultando en una facturación neta de $4.336.567,32 ARS." },
    { titulo: "3. Desglose por Canal: Stand vs. Reservas Web", cuerpo: "El Stand concentró la mayor parte de la actividad; las Reservas web aportaron una fracción menor pero reconcilian exactamente con el total." },
    { titulo: "4. Indicadores de Eficiencia", cuerpo: "Las métricas de eficiencia se derivan de la relación entre turnos, personas y minutos de actividad registrados." },
    { titulo: "5. Estado del Mes y Reconciliación", cuerpo: "El cronograma del mes está confirmado (31 días, 0 cerrados). La reconciliación de datos es correcta: Stand + Reservas = Total." },
  ],
  modulos_consultados: ["Métricas de Equipo"],
}) as { ok: true; spec: InformeSpec }).spec;

async function main() {
  const armado = armarDesde(specBase, DATOS, META, ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"]);
  assert.ok(armado.ok); if (!armado.ok) return;
  assert.equal(armado.spec.graficos.length, 2, "2 gráficos en el spec");
  const ctx: ContextoRender = { spec: armado.spec, generadoISO: "2026-09-02 15:00 (Córdoba)", version: 5 };
  const pdf = await renderFormato("pdf", ctx);
  const xlsx = await renderFormato("xlsx", ctx);

  // ── PDF: 4 páginas, fuente incrustada ────────────────────────────────────────
  const raw = pdf.toString("latin1");
  assert.ok((raw.match(/\/FontFile2/g) || []).length >= 2, "Liberation Sans incrustada (FontFile2 x2)");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const n = doc.countPages();
  assert.equal(n, 4, "PDF de 4 páginas");
  const paginas: string[] = [];
  for (let i = 0; i < n; i++) paginas.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  const full = paginas.join("\n");
  const cuerpo = (t: string) => t.replace(/^\s+/, "");

  // ── Continuidad: página 4 empieza por la sección, no a mitad de oración ──────
  assert.ok(/^Fuentes y metodolog[ií]a/.test(cuerpo(paginas[3])), "página 4 comienza por 'Fuentes y metodología'");
  assert.ok(!paginas.some((t) => /^\s*según el cronograma/i.test(t)), "ninguna página comienza con 'según el cronograma'");
  assert.ok(/Se atribuye al integrante presente según el cronograma confirmado/.test(full.replace(/\n/g, " ")), "la frase de atribución no se parte entre páginas");
  // Título junto a su primer párrafo (ambos en la página 4).
  assert.ok(/Fuentes y metodolog[ií]a[\s\S]*Módulos consultados/.test(paginas[3]), "el título no queda separado de su primer párrafo");

  // ── Encabezados/pies en todas las páginas ────────────────────────────────────
  for (let p = 1; p <= 4; p++) assert.ok(paginas[p - 1].includes(`Página ${p} de 4`), `pie 'Página ${p} de 4'`);
  for (let p = 2; p <= 4; p++) assert.ok(/Informe de M[eé]tricas Operativas/.test(paginas[p - 1]), `encabezado del informe en página ${p}`);

  // ── Español, corte, cifras ───────────────────────────────────────────────────
  for (const w of ["concentró", "facturación", "reconciliación", "anomalías", "atribución", "según", "comisión", "días"]) assert.ok(full.includes(w), `tilde: ${w}`);
  assert.ok(!full.includes("−"), "sin U+2212");
  assert.ok(/neta = bruta - comisiones/.test(full), "neta = bruta - comisiones");
  assert.ok(full.includes("2026-09-01 23:20") && !full.includes("T23:20"), "corte único sin T");
  assert.ok(full.includes("194"), "194 conservado");
  assert.ok(!/analitico_mensual/i.test(full), "sin enum");

  // ── Excel intacto ────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  const ref = (name: string) => { const a = wb.getWorksheet(name)!.autoFilter as unknown; return typeof a === "string" ? a : ""; };
  assert.equal(ref("Indicadores"), "A1:C9");
  assert.equal(ref("Por origen"), "A1:H3");
  assert.equal(ref("Anexo"), "A1:H4");
  assert.equal(ref("Fuentes y método"), "A1:D5");
  assert.equal(wb.worksheets.find((w) => /Gr[aá]ficos/.test(w.name))!.getImages().length, 2, "2 gráficos en el Excel");
  const ind = wb.getWorksheet("Indicadores")!;
  let horas: unknown = null, bruta: unknown = null;
  ind.eachRow((r) => { const k = r.getCell(1).value; if (typeof k === "string" && k.includes("Horas")) horas = r.getCell(2).value; if (typeof k === "string" && /bruta/i.test(k)) bruta = r.getCell(2).value; });
  assert.equal(horas, 194); assert.equal(typeof horas, "number");
  assert.equal(bruta, 4372000); assert.equal(typeof bruta, "number");

  console.log(`OK — calidad4c5 (render): PDF ${pdf.length}b, ${n} páginas; página 4 empieza por 'Fuentes y metodología' + 'Módulos consultados' (sin oración cortada), frase de atribución completa, encabezados+pies 'Página X de 4' en todas, Liberation Sans incrustada, tildes y corte único; Excel con filtros A1:C9/A1:H3/A1:H4/A1:D5, 2 gráficos y números tipados (194, 4.372.000).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
