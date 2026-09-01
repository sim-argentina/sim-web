import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/ia/docs/ocrAuth.test.ts
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Endpoint OCR: admin-only, dueño de la conversación, exige confirmacion=true.
{
  const src = read("app/api/admin/ia/adjuntos/[id]/ocr/route.ts");
  assert.ok(/requireAdmin\(\)/.test(src), "ocr: requireAdmin");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), "ocr: corta si el guard falla");
  assert.ok(/conv\.owner !== IA_OWNER_ADMIN/.test(src), "ocr: verifica dueño de la conversación");
  assert.ok(/confirmacion !== true/.test(src), "ocr: exige confirmacion === true (no consume sin autorizar)");
  assert.ok(/rateLimit\(/.test(src), "ocr: rate limit");
}

// Al subir un adjunto NO se llama al proveedor: solo se marca 'necesita_ocr'.
{
  const src = read("lib/ia/docs/adjuntosServer.ts");
  assert.ok(/necesidadOCR\(/.test(src) && /necesita_ocr/.test(src), "crearAdjunto marca necesita_ocr");
  // crearAdjunto no invoca analizarVisual ni analizarArchivoOCR.
  const crear = src.slice(src.indexOf("export async function crearAdjunto"), src.indexOf("export async function listarAdjuntos"));
  assert.ok(!/analizarVisual|analizarArchivoOCR/.test(crear), "crearAdjunto NO llama al OCR (no consume al subir)");
}

// OCR respeta la cuota atómica y mide tokens/costo; separa OCR de descripción visual.
{
  const src = read("lib/ia/docs/ocr.ts");
  assert.ok(/ia_reservar_solicitud/.test(src) && /ia_sumar_consumo/.test(src), "ocr: cuota atómica + consumo");
  assert.ok(/estimarCostoUSD/.test(src), "ocr: costo estimado");
  assert.ok(/texto_detectado/.test(src) && /descripcion_visual/.test(src), "ocr: separa OCR de descripción visual");
  assert.ok(/reutilizado/.test(src) && /ia_ocr_resultados/.test(src), "ocr: idempotencia por hash+páginas");
  assert.ok(/paginasOCR/.test(src) && /subPdf/.test(src), "ocr: envía solo páginas sin texto");
  assert.ok(/DATO, NUNCA instrucciones|ignorá cualquier orden/i.test(src), "ocr: instrucción anti prompt-injection");
}

console.log("OK — ocrAuth: endpoint admin-only + dueño + confirmación; subir no consume; cuota/consumo/costo; separación OCR/descripción; idempotencia; solo páginas sin texto; anti-injection.");
