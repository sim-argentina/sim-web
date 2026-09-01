import { strict as assert } from "node:assert";
import { centavosANanoUsd, usdANanoUsd, nanoUsdAString, formatoUSD, normalizarImporteUsd, NANO } from "@/lib/ia/creditos/dinero";

// Ejecutar: npx tsx lib/ia/creditos/dinero.test.ts

// ── Cost Report: centavos (string) → nano-USD. "123.78912" cents = $1.2378912 ──
assert.equal(centavosANanoUsd("123.78912"), 1_237_891_200n, "123.78912 cents = 1.2378912 USD");
assert.equal(centavosANanoUsd("100"), 1_000_000_000n, "100 cents = 1 USD");
assert.equal(centavosANanoUsd("0"), 0n, "0 cents = 0");
assert.equal(centavosANanoUsd("8.2"), 82_000_000n, "8.2 cents = 0.082 USD");
// Suma exacta de varios buckets (sin float).
const total = ["1.5", "2.5", "0.001"].reduce((a, c) => a + centavosANanoUsd(c), 0n);
assert.equal(total, 40_010_000n, "1.5+2.5+0.001 cents = 0.0400100 USD exacto");

// ── Importe USD del admin → nano-USD ─────────────────────────────────────────
assert.equal(usdANanoUsd("5"), 5n * NANO, "5 USD");
assert.equal(usdANanoUsd("20.00"), 20n * NANO, "20.00 USD");
assert.equal(usdANanoUsd("0.083928"), 83_928_000n, "0.083928 USD");

// ── nano-USD → string exacto ─────────────────────────────────────────────────
assert.equal(nanoUsdAString(1_237_891_200n, 9), "1.237891200", "9 decimales");
assert.equal(nanoUsdAString(4_920_000_000n, 2), "4.92", "saldo 2 decimales");
assert.equal(nanoUsdAString(82_345_000n, 6), "0.082345", "6 decimales");
assert.equal(nanoUsdAString(-10_000_000n, 2), "-0.01", "negativo");
// Redondeo half-up al reescalar.
assert.equal(nanoUsdAString(1_235_000_000n, 2), "1.24", "1.235 → 1.24 (half-up)");

// ── Formato de pantalla: saldo 2 dec, <US$0,01 con 4 dec (nunca cero) ─────────
assert.equal(formatoUSD(4_920_000_000n), "4.92", "saldo grande 2 decimales");
assert.equal(formatoUSD(10_839_000n), "0.0108", "US$0,0108 con 4 decimales (no cero)");
assert.equal(formatoUSD(0n), "0.00", "cero real");

// ── Validación de importes del admin ─────────────────────────────────────────
assert.equal(normalizarImporteUsd("5"), "5.000000", "5 → 5.000000");
assert.equal(normalizarImporteUsd("20,00"), "20.000000", "coma decimal aceptada");
assert.equal(normalizarImporteUsd("0"), null, "cero no permitido por defecto");
assert.equal(normalizarImporteUsd("0", { permitirCero: true }), "0.000000", "cero permitido explícito");
assert.equal(normalizarImporteUsd("-5"), null, "negativo rechazado");
assert.equal(normalizarImporteUsd("abc"), null, "texto rechazado");
assert.equal(normalizarImporteUsd("2000000"), null, "importe absurdo rechazado");
assert.equal(normalizarImporteUsd(""), null, "vacío rechazado");

console.log("OK — dinero: centavos→nano-USD exacto, importes USD, formato saldo/<cent, validación.");
