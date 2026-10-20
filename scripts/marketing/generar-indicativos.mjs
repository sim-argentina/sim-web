// Genera lib/indicativosArgentina.ts desde la planilla OFICIAL de ENACOM.
//
//   node scripts/marketing/generar-indicativos.mjs <ruta a archivo_20240521035456_1549.xls>
//
// Fuente: https://www.enacom.gob.ar/indicativos-interurbanos_p143 → "Indicativos
// interurbanos" (hoja 'AREAS LOCALES 300'). La planilla se lee como DATOS con la
// librería xlsx del repo: no se evalúan fórmulas ni se ejecuta nada del archivo.
// Antes de escribir una sola línea valida la forma de la planilla y aborta si algo
// no cierra (cantidad, largos, duplicados, paridad con AREAS_3_DIGITOS).
//
// El archivo generado lleva el sha256 de la planilla: si ENACOM la cambia, se
// regenera a propósito y el diff muestra exactamente qué indicativo cambió.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: node scripts/marketing/generar-indicativos.mjs <ruta a la planilla .xls de ENACOM>");
  process.exit(2);
}

const HOJA = "AREAS LOCALES 300";
const URL_FUENTE = "https://www.enacom.gob.ar/multimedia/noticias/archivos/202405/archivo_20240521035456_1549.xls";
const PAGINA_FUENTE = "https://www.enacom.gob.ar/indicativos-interurbanos_p143";
// Los mismos 38 indicativos de 3 dígitos que usa el normalizador (lib/mensualidades.ts).
const AREAS_3_REPO = [
  "220", "221", "223", "230", "236", "237", "249",
  "260", "261", "263", "264", "266", "280", "291", "294", "297", "298", "299",
  "336", "341", "342", "343", "345", "348", "351", "353", "358",
  "362", "364", "370", "376", "379", "380", "381", "383", "385", "387", "388",
];

function abortar(msg) {
  console.error(`No se generó nada: ${msg}`);
  process.exit(1);
}

const bytes = readFileSync(resolve(ruta));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const wb = XLSX.read(bytes, { type: "buffer", cellFormula: false, cellHTML: false });
if (!wb.SheetNames.includes(HOJA)) abortar(`no está la hoja '${HOJA}' (hay: ${wb.SheetNames.join(", ")})`);
const filas = XLSX.utils.sheet_to_json(wb.Sheets[HOJA], { header: 1, raw: false, defval: "" });

const encabezado = filas[0].map((c) => String(c).replace(/\s+/g, " ").trim().toUpperCase());
if (encabezado[0] !== "INDICATIVO INTERURBANO" || encabezado[1] !== "ÁREA LOCAL" || encabezado[2] !== "PROVINCIA") {
  abortar(`encabezado inesperado: ${JSON.stringify(encabezado)}`);
}

const limpiar = (s) => String(s).replace(/\s+/g, " ").trim();
const datos = filas.slice(1).filter((f) => limpiar(f[0]) !== "").map((f) => ({
  indicativo: limpiar(f[0]),
  area: limpiar(f[1]),
  provincia: limpiar(f[2]),
}));

if (datos.length !== 300) abortar(`se esperaban 300 indicativos y hay ${datos.length}`);
for (const d of datos) {
  if (!/^(11|[23][0-9]{1,3})$/.test(d.indicativo)) abortar(`indicativo con forma inválida: ${d.indicativo}`);
  if (!d.area || !d.provincia) abortar(`fila incompleta: ${JSON.stringify(d)}`);
}
const unicos = new Set(datos.map((d) => d.indicativo));
if (unicos.size !== datos.length) abortar("hay indicativos repetidos");
const por = (n) => datos.filter((d) => d.indicativo.length === n).map((d) => d.indicativo);
const [de2, de3, de4] = [por(2), por(3), por(4)];
if (de2.length !== 1 || de2[0] !== "11") abortar(`indicativos de 2 dígitos: ${de2.join(",")}`);
if (de3.length !== 38) abortar(`se esperaban 38 de 3 dígitos y hay ${de3.length}`);
if (de4.length !== 261) abortar(`se esperaban 261 de 4 dígitos y hay ${de4.length}`);
const faltan3 = AREAS_3_REPO.filter((a) => !de3.includes(a));
const sobran3 = de3.filter((a) => !AREAS_3_REPO.includes(a));
if (faltan3.length || sobran3.length) abortar(`los de 3 dígitos no coinciden con lib/mensualidades.ts (faltan ${faltan3}, sobran ${sobran3})`);
const sobre3 = de4.filter((c) => de3.includes(c.slice(0, 3)));

datos.sort((a, b) => (a.indicativo.length - b.indicativo.length) || (a.indicativo < b.indicativo ? -1 : 1));
const lineas = datos.map((d) => `  ["${d.indicativo}", ${JSON.stringify(d.area)}, ${JSON.stringify(d.provincia)}],`);

const salida = `// ============================================================================
// Indicativos interurbanos de Argentina — GENERADO, no editar a mano.
// ----------------------------------------------------------------------------
// Fuente oficial: ENACOM, ${PAGINA_FUENTE}
//   archivo: ${URL_FUENTE}
//   hoja '${HOJA}', sha256 ${sha256}
// Regenerar: node scripts/marketing/generar-indicativos.mjs <ruta a la planilla>
//
// ${datos.length} indicativos: ${de2.length} de 2 dígitos, ${de3.length} de 3 y ${de4.length} de 4. ${sobre3.length} de los de 4
// empiezan con uno de 3 (p. ej. ${sobre3.slice(0, 3).join(", ")}): por eso el indicativo de un número
// no se decide por prefijo corto (ver lib/marketing/indicativo.ts).
//
// "Área local" es el área de NUMERACIÓN que asigna ENACOM: dice dónde se dio de
// alta la línea, no dónde vive ni dónde está la persona.
// ============================================================================

export const FUENTE_INDICATIVOS = {
  pagina: "${PAGINA_FUENTE}",
  archivo: "${URL_FUENTE}",
  hoja: "${HOJA}",
  sha256: "${sha256}",
  total: ${datos.length},
} as const;

/** [indicativo, área local de numeración, provincia], tal como los publica ENACOM. */
export const INDICATIVOS_ARGENTINA: readonly (readonly [string, string, string])[] = [
${lineas.join("\n")}
];
`;

const destino = resolve("lib/indicativosArgentina.ts");
writeFileSync(destino, salida.replace(/\n/g, "\r\n"), "utf8");
console.log(`OK — ${datos.length} indicativos (2:${de2.length} 3:${de3.length} 4:${de4.length}; ${sobre3.length} de 4 empiezan con uno de 3) · sha256 ${sha256.slice(0, 16)}… → ${destino}`);
