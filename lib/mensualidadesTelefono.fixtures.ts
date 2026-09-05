// Tabla de casos de la normalización argentina de teléfonos (M2.1 / M2.2).
// Es el CONTRATO compartido: lib/mensualidades.test.ts la corre contra la
// implementación TypeScript y lib/mensualidades.integration.ts la corre contra la
// función SQL public.mensualidad_normalizar_telefono. Si las dos no dan lo mismo
// en cada fila, la paridad está rota. No se importa desde código de producción.

// ── Indicativos oficiales (M2.2) ────────────────────────────────────────────
// Copiados de la planilla oficial de ENACOM, verificada el 2026-09-05:
//   https://www.enacom.gob.ar/indicativos-interurbanos_p143
//   'archivo_20240521035456_1549.xls', hoja 'AREAS LOCALES 300' (300 indicativos:
//   1 de dos dígitos, 38 de tres y 261 de cuatro).
// Este snapshot existe para que el test detecte cualquier desvío entre la lista
// que usa el código y la fuente oficial.
export const AREA_OFICIAL_2 = "11";

export const AREAS_OFICIALES_3: readonly string[] = [
  "220", "221", "223", "230", "236", "237", "249",
  "260", "261", "263", "264", "266", "280", "291", "294", "297", "298", "299",
  "336", "341", "342", "343", "345", "348", "351", "353", "358",
  "362", "364", "370", "376", "379", "380", "381", "383", "385", "387", "388",
];

// Muestra representativa de los 261 indicativos de 4 dígitos (todos verificados
// contra la misma planilla): dos extremos de la tabla y tres del medio.
export const AREAS_OFICIALES_4_MUESTRA: readonly string[] = [
  "2202", // González Catán (primero de la tabla)
  "2920", // Viedma
  "2954", // Santa Rosa, La Pampa
  "2966", // Río Gallegos
  "3894", // Burruyacú (último de la tabla)
];

// Los tres formatos equivalentes de un mismo número: canónico, nacional viejo
// (con 0 y 15) e internacional (+54 9). Los tres tienen que normalizar igual.
export function formatosEquivalentes(area: string, local: string): [string, string, string] {
  return [
    `${area}${local}`,
    `0${area} 15-${local}`,
    `+54 9 ${area} ${local}`,
  ];
}

// Número local de relleno para completar los 10 dígitos de un área dada.
export function localDe(area: string): string {
  return "5123456789".slice(0, 10 - area.length);
}

export const CASOS_TELEFONO: ReadonlyArray<[entrada: string, esperado: string | null, nota: string]> = [
  // ── Córdoba (área de 3 dígitos) ──
  ["3515123456", "3515123456", "Córdoba canónico"],
  ["0351 5123456", "3515123456", "Córdoba fijo con 0"],
  ["0351 15-5123456", "3515123456", "Córdoba viejo con 15"],
  ["+54 9 351 512-3456", "3515123456", "Córdoba internacional"],
  ["54 9 351 5123456", "3515123456", "Córdoba 54 sin +"],
  ["0054 9 351 5123456", "3515123456", "Córdoba 00 54"],
  ["(0351) 15 5123456", "3515123456", "Córdoba con paréntesis y espacios"],
  ["351.512.3456", "3515123456", "Córdoba con puntos"],

  // ── CABA (el único área de 2 dígitos) ──
  ["11 1234-5678", "1112345678", "CABA canónico"],
  ["011 15-1234-5678", "1112345678", "CABA viejo con 15"],
  ["+54 9 11 1234-5678", "1112345678", "CABA internacional"],

  // ── Rosario ──
  ["341 5123456", "3415123456", "Rosario canónico"],
  ["0341 15-5123456", "3415123456", "Rosario viejo con 15"],
  ["+54 9 341 5123456", "3415123456", "Rosario internacional"],

  // ── La Plata ──
  ["221 5123456", "2215123456", "La Plata canónico"],
  ["0221 15-5123456", "2215123456", "La Plata viejo con 15"],
  ["+54 9 221 5123456", "2215123456", "La Plata internacional"],

  // ── Río Gallegos: área de 4 dígitos, el caso que rompe cualquier regla fija ──
  ["2966123456", "2966123456", "área de 4 canónico"],
  ["02966 15-123456", "2966123456", "área de 4 viejo con 15"],
  ["+54 9 2966 12-3456", "2966123456", "área de 4 internacional"],

  // ── General Roca (298): el indicativo que faltaba antes de M2.2 ──
  ["2985123456", "2985123456", "298 canónico"],
  ["0298 15-5123456", "2985123456", "298 viejo con 15"],
  ["+54 9 298 512-3456", "2985123456", "298 internacional"],

  // ── Indicativos de 4 que EMPIEZAN con uno de 3 válido (49 casos en el plan).
  // Antes de M2.2 el largo del área se fijaba antes de mirar el 15 y estos se
  // rechazaban. El par de cada línea comparte prefijo y tiene que resolver distinto.
  ["03489 15-123456", "3489123456", "Campana (3489) sobre 348"],
  ["0348 15-5123456", "3485123456", "Zárate (348) — mismo prefijo, área de 3"],
  ["02202 15-512345", "2202512345", "González Catán (2202) sobre 220"],
  ["0220 15-5123456", "2205123456", "Merlo (220) — mismo prefijo, área de 3"],
  ["02945 15-123456", "2945123456", "Esquel (2945) sobre 294"],
  ["0294 15-5123456", "2945123456", "Bariloche (294) — colisiona en el canónico"],
  ["03456 15-123456", "3456123456", "Chajarí (3456) sobre 345"],
  ["02983 15-123456", "2983123456", "Tres Arroyos (2983) sobre 298"],

  // ── Rechazos: ante la duda NO se adivina ──
  ["351ABC3456", null, "letras"],
  ["35112", null, "demasiado corto"],
  ["+54 9 351 5123456 99", null, "demasiado largo"],
  ["1234567890123456", null, "largo arbitrario"],
  ["+1 555 123 4567", null, "prefijo extranjero +1"],
  ["0044 20 7123 4567", null, "prefijo extranjero 0044"],
  ["341512345615", null, "15 fuera del borde del área"],
  ["115115123456", null, "sin lectura válida del 15"],
  ["1512345678", null, "15 sin código de área"],
  ["", null, "vacío"],
  ["++5493515123456", null, "doble +"],
  ["54+93515123456", null, "+ mal ubicado"],
];
