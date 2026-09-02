import { strict as assert } from "node:assert";
import { formatearFechaCalendario, formatearFechaLarga, formatearTimestampCordoba, formatearTimestampLargaCordoba } from "@/lib/ia/creditos/fecha";

// Ejecutar: npx tsx lib/ia/creditos/fecha.test.ts

// ── date (calendario) por componentes: NO corre el día por UTC ────────────────
assert.equal(formatearFechaCalendario("2026-08-31"), "31/08/2026", "31/08 no se corre a 30/08");
assert.equal(formatearFechaCalendario("2026-09-01"), "01/09/2026", "01/09 no se corre a 31/08");
assert.equal(formatearFechaCalendario("2026-01-01"), "01/01/2026", "año nuevo");
assert.equal(formatearFechaCalendario(null), "—", "nulo");
assert.equal(formatearFechaLarga("2026-09-01"), "1 sep 2026", "fecha larga");
assert.equal(formatearFechaLarga("2026-08-31"), "31 ago 2026", "fecha larga ago");

// ── timestamptz en Córdoba (UTC-3) ────────────────────────────────────────────
// 2026-09-01T22:48:23Z → Córdoba 19:48 del 1/9.
assert.equal(formatearTimestampCordoba("2026-09-01T22:48:23.841296+00:00"), "01/09/2026 19:48", "timestamp en Córdoba");
// Cerca de medianoche UTC: 2026-09-02T02:30:00Z → Córdoba 23:30 del 1/9 (no salta al 2).
assert.equal(formatearTimestampCordoba("2026-09-02T02:30:00Z"), "01/09/2026 23:30", "medianoche: se muestra según Córdoba");
// 2026-09-01T02:16:00Z → Córdoba 23:16 del 31/8.
assert.equal(formatearTimestampLargaCordoba("2026-09-01T02:16:00Z"), "31 ago 2026", "timestamp madrugada → día Córdoba anterior");

console.log("OK — fecha: date por componentes (sin corrimiento UTC), timestamptz en Córdoba (incl. medianoche).");
