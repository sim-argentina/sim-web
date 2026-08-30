import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/cronogramaPdfConfig.test.ts
// Guarda contra regresión del Bloque 2B: `getDocument` de pdfjs importa
// dinámicamente `pdf.worker.mjs` por un path que @vercel/nft NO traza; sin
// `outputFileTracingIncludes` de pdfjs para la ruta de análisis, Vercel poda ese
// archivo y el análisis falla en producción con "Setting up fake worker failed".

const cfg = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

assert.ok(/serverExternalPackages:\s*\[[^\]]*["']pdfjs-dist["']/.test(cfg), "pdfjs-dist debe estar en serverExternalPackages");
assert.ok(/outputFileTracingIncludes/.test(cfg), "next.config debe tener outputFileTracingIncludes");
assert.ok(
  /outputFileTracingIncludes[\s\S]*importar\/analizar[\s\S]*pdfjs-dist/.test(cfg),
  "la ruta de análisis debe incluir ./node_modules/pdfjs-dist/** en el file tracing (si no, Vercel poda pdf.worker.mjs y el análisis falla)",
);

console.log("OK — cronogramaPdfConfig: pdfjs-dist externalizado + outputFileTracingIncludes para la ruta de análisis (evita el bug de poda de pdf.worker.mjs en Vercel).");
