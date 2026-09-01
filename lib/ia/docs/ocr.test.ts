import { strict as assert } from "node:assert";
import { necesidadOCR } from "@/lib/ia/docs/ocr";
import type { Deteccion } from "@/lib/ia/docs/deteccion";
import type { ResultadoExtraccion } from "@/lib/ia/docs/extractors";

// Ejecutar: npx tsx lib/ia/docs/ocr.test.ts
const det = (formato: Deteccion["formato"]): Deteccion => ({ seguro: true, formato, mime: "x", extension: "x" });
const res = (over: Partial<ResultadoExtraccion>): ResultadoExtraccion => ({ metodo: "x", estado: "listo", contenido: "", fragmentos: [], advertencias: [], ...over });

// Imagen → siempre necesita OCR.
{
  const n = necesidadOCR(det("imagen"), res({ estado: "sin_extractor" }));
  assert.ok(n.necesita && n.tipo === "imagen", "imagen requiere OCR");
}
// PDF con capa de texto completa → NO necesita OCR.
{
  const n = necesidadOCR(det("pdf"), res({ paginas: 2, fragmentos: [{ ordinal: 1, ubicacion: "Página 1", texto: "a" }, { ordinal: 2, ubicacion: "Página 2", texto: "b" }] }));
  assert.equal(n.necesita, false, "PDF con texto no requiere OCR");
}
// PDF escaneado (sin texto) → todas las páginas.
{
  const n = necesidadOCR(det("pdf"), res({ estado: "sin_extractor", paginas: 3, fragmentos: [] }));
  assert.ok(n.necesita && n.tipo === "pdf" && n.paginasOCR.length === 3, "PDF escaneado: todas las páginas");
}
// PDF MIXTO → solo las páginas sin texto.
{
  const n = necesidadOCR(det("pdf"), res({ paginas: 4, fragmentos: [{ ordinal: 1, ubicacion: "Página 1", texto: "a" }, { ordinal: 3, ubicacion: "Página 3", texto: "c" }] }));
  assert.ok(n.necesita && n.tipo === "pdf", "PDF mixto requiere OCR");
  if (n.necesita && n.tipo === "pdf") assert.deepEqual(n.paginasOCR, [2, 4], "solo páginas 2 y 4 (sin texto)");
}
// Formatos sin extractor visual (docx/legacy/desconocido) → no aplica OCR.
{
  assert.equal(necesidadOCR(det("docx"), res({})).necesita, false, "docx no usa OCR");
  assert.equal(necesidadOCR(det("legacy_office"), res({ estado: "sin_extractor" })).necesita, false, "legacy no usa OCR");
}

console.log("OK — necesidadOCR: imagen sí; PDF con texto no; escaneado (todas); mixto (solo páginas sin texto); docx/legacy no.");
