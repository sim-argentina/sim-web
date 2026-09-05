// Tabla de casos de la normalización argentina de teléfonos (M2.1).
// Es el CONTRATO compartido: lib/mensualidades.test.ts la corre contra la
// implementación TypeScript y lib/mensualidades.integration.ts la corre contra la
// función SQL public.mensualidad_normalizar_telefono. Si las dos no dan lo mismo
// en cada fila, la paridad está rota. No se importa desde código de producción.

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
