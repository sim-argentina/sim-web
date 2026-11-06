// Genera lib/bloquesNumeracionAmbiguos.ts desde la planilla OFICIAL de ENACOM de
// numeración geográfica asignada.
//
//   node scripts/marketing/generar-bloques-ambiguos.mjs <ruta a archivo_20260727084225_3117.xls>
//
// Fuente: https://www.enacom.gob.ar/asignaciones-a-la-fecha_p445 → "Numeración
// Geográfica" (hoja 'num geo para web 2003'): una fila por bloque asignado, con
// operador, servicio, localidad, INDICATIVO, BLOQUE, resolución y fecha. La
// planilla se lee como DATOS con la librería xlsx del repo: no se evalúan
// fórmulas ni se ejecuta nada del archivo.
//
// Para qué: 49 indicativos de 4 dígitos empiezan con uno de 3 (2646 / 264,
// 3584 / 358…), así que un número como 2646xxxxxx admite dos lecturas. La tabla
// de indicativos no alcanza para elegir; la asignación de bloques sí: cada bloque
// es el prefijo de un rango de números nacionales asignado a UN indicativo. Antes
// de escribir nada, el generador comprueba en TODA la planilla que ningún rango
// asignado se superpone con otro de distinto indicativo (si pasara, el bloque no
// decidiría y se aborta) y que ningún bloque empieza con 0 o 1 (Plan Fundamental
// de Numeración, Res. SC 46/97, III.2.1.2).
//
// Se guardan solo los bloques que pueden contener un número ambiguo: todos los
// del indicativo de 4 y, del de 3, los que empiezan con el 4.º dígito del de 4.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: node scripts/marketing/generar-bloques-ambiguos.mjs <ruta a la planilla .xls de ENACOM>");
  process.exit(2);
}

const HOJA = "num geo para web 2003";
const URL_FUENTE = "https://www.enacom.gob.ar/multimedia/noticias/archivos/202607/archivo_20260727084225_3117.xls";
const PAGINA_FUENTE = "https://www.enacom.gob.ar/asignaciones-a-la-fecha_p445";
const ENCABEZADO = ["OPERADOR", "SERVICIO", "MODALIDAD", "LOCALIDAD", "INDICATIVO", "BLOQUE", "RESOLUCION", "FECHA"];

function abortar(msg) {
  console.error(`No se generó nada: ${msg}`);
  process.exit(1);
}

// Los 300 indicativos oficiales, del archivo generado desde la otra planilla de ENACOM.
const tablaIndicativos = readFileSync(resolve("lib/indicativosArgentina.ts"), "utf8");
const oficiales = [...tablaIndicativos.matchAll(/^\s*\["(\d{2,4})", /gm)].map((m) => m[1]);
const totalDeclarado = Number(/total: (\d+),/.exec(tablaIndicativos)?.[1]);
if (oficiales.length !== 300 || totalDeclarado !== 300) abortar(`lib/indicativosArgentina.ts no tiene los 300 indicativos (${oficiales.length})`);
const esOficial = new Set(oficiales);
const de3 = oficiales.filter((i) => i.length === 3);
const pares = oficiales.filter((i) => i.length === 4 && de3.includes(i.slice(0, 3))).sort();
if (pares.length !== 49) abortar(`se esperaban 49 indicativos de 4 dígitos con uno de 3 como prefijo y hay ${pares.length}`);

const bytes = readFileSync(resolve(ruta));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const wb = XLSX.read(bytes, { type: "buffer", cellFormula: false, cellHTML: false });
if (!wb.SheetNames.includes(HOJA)) abortar(`no está la hoja '${HOJA}' (hay: ${wb.SheetNames.join(", ")})`);
const filas = XLSX.utils.sheet_to_json(wb.Sheets[HOJA], { header: 1, raw: false, defval: "" });

const limpiar = (s) => String(s).replace(/\s+/g, " ").trim();
const encabezado = filas[0].map((c) => limpiar(c).toUpperCase());
if (JSON.stringify(encabezado.slice(0, ENCABEZADO.length)) !== JSON.stringify(ENCABEZADO)) {
  abortar(`encabezado inesperado: ${JSON.stringify(encabezado)}`);
}

const bloques = [];
filas.slice(1).forEach((f, i) => {
  if (f.every((c) => limpiar(c) === "")) return;
  const indicativo = limpiar(f[4]);
  const bloque = limpiar(f[5]);
  const fila = i + 2;
  if (!esOficial.has(indicativo)) abortar(`fila ${fila}: indicativo ${indicativo} no está en la tabla oficial`);
  if (!/^[0-9]+$/.test(bloque)) abortar(`fila ${fila}: bloque con forma inválida (${bloque})`);
  // Res. SC 46/97, III.2.1.2: la característica de central no empieza con 0 ni con 1.
  if (bloque[0] === "0" || bloque[0] === "1") abortar(`fila ${fila}: bloque ${indicativo} ${bloque} empieza con 0 o 1`);
  const prefijo = indicativo + bloque;
  if (prefijo.length < 6 || prefijo.length > 9) abortar(`fila ${fila}: rango de largo inesperado (${prefijo})`);
  bloques.push({ indicativo, bloque, prefijo });
});
if (bloques.length < 40000) abortar(`muy pocas filas (${bloques.length}): ¿es la planilla correcta?`);

// Ningún rango asignado puede contener a otro de distinto indicativo.
const ordenados = [...bloques].sort((a, b) => (a.prefijo < b.prefijo ? -1 : a.prefijo > b.prefijo ? 1 : 0));
let repetidos = 0;
for (let i = 0; i < ordenados.length; i++) {
  for (let j = i + 1; j < ordenados.length && ordenados[j].prefijo.startsWith(ordenados[i].prefijo); j++) {
    const a = ordenados[i], b = ordenados[j];
    if (a.indicativo !== b.indicativo) abortar(`rangos superpuestos: ${a.indicativo} ${a.bloque} y ${b.indicativo} ${b.bloque}`);
    repetidos++;
  }
}

const unicos = (lista) => [...new Set(lista)].sort();
const salidaPares = pares.map((largo) => {
  const corto = largo.slice(0, 3);
  const delLargo = unicos(bloques.filter((b) => b.indicativo === largo).map((b) => b.bloque));
  const delCorto = unicos(bloques.filter((b) => b.indicativo === corto && b.bloque.startsWith(largo[3])).map((b) => b.bloque));
  return { largo, corto, delLargo, delCorto };
});
const conBloquesDelCorto = salidaPares.filter((p) => p.delCorto.length > 0);
const lineas = salidaPares.map((p) =>
  `  "${p.largo}": {\n    corto: "${p.corto}",\n    delLargo: "${p.delLargo.join(" ")}",\n    delCorto: "${p.delCorto.join(" ")}",\n  },`);

const salida = `// ============================================================================
// Bloques de numeración geográfica ASIGNADOS de los indicativos ambiguos —
// GENERADO, no editar a mano.
// ----------------------------------------------------------------------------
// Fuente oficial: ENACOM, ${PAGINA_FUENTE} ("Numeración Geográfica")
//   archivo: ${URL_FUENTE}
//   hoja '${HOJA}', ${bloques.length} bloques, sha256 ${sha256}
// Regenerar: node scripts/marketing/generar-bloques-ambiguos.mjs <ruta a la planilla>
//
// Un bloque es el comienzo de un rango de números nacionales asignado a UN
// indicativo: indicativo + bloque = 6, 7 u 8 dígitos (10.000, 1.000 o 100
// números). Al generar se comprobó en toda la planilla que ningún rango se
// superpone con otro de distinto indicativo y que ningún bloque empieza con 0 o 1.
//
// Por cada uno de los ${salidaPares.length} indicativos de 4 dígitos que empiezan con uno de 3:
// todos sus bloques (delLargo) y los bloques del de 3 que empiezan con su 4.º
// dígito (delCorto), separados por espacios. En ${conBloquesDelCorto.length} de los ${salidaPares.length} el de 3
// tiene bloques dentro del mismo comienzo (p. ej. ${conBloquesDelCorto.slice(0, 3).map((p) => `${p.corto} ${p.delCorto[0]}…`).join(", ")}): ahí el
// indicativo más largo NO es el correcto para todos los números.
// ============================================================================

export const FUENTE_BLOQUES = {
  pagina: "${PAGINA_FUENTE}",
  archivo: "${URL_FUENTE}",
  hoja: "${HOJA}",
  sha256: "${sha256}",
  bloques: ${bloques.length},
} as const;

export type BloquesAmbiguos = { readonly corto: string; readonly delLargo: string; readonly delCorto: string };

/** Indicativo de 4 dígitos → su prefijo de 3 y los bloques asignados de cada lectura. */
export const BLOQUES_AMBIGUOS: Readonly<Record<string, BloquesAmbiguos>> = {
${lineas.join("\n")}
};
`;

const destino = resolve("lib/bloquesNumeracionAmbiguos.ts");
writeFileSync(destino, salida.replace(/\n/g, "\r\n"), "utf8");
console.log(
  `OK — ${bloques.length} bloques leídos (${repetidos} repetidos del mismo indicativo, 0 superpuestos entre indicativos) · ` +
    `${salidaPares.length} pares, ${conBloquesDelCorto.length} con bloques del corto · sha256 ${sha256.slice(0, 16)}… → ${destino}`,
);
