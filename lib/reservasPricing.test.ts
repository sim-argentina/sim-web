import { strict as assert } from "node:assert";
import { resolverPrecioReserva } from "@/lib/reservasPricing";

// Ejecutar: npx tsx lib/reservasPricing.test.ts
// Stub del precio NORMAL (no toca los precios reales): 15 = 12000, 30 = 18000.
const normal = (_fecha: string, dur: number) => (Number(dur) >= 30 ? 18000 : 12000);

// CASO A — fecha normal (sin especial) → precio normal.
assert.equal(resolverPrecioReserva(null, "2026-08-28", 15, normal), 12000);
assert.equal(resolverPrecioReserva(null, "2026-08-28", 30, normal), 18000);

// CASO B — especial de 15 min → usa el override.
assert.equal(resolverPrecioReserva({ precio_15: 15000, precio_30: 25000 }, "x", 15, normal), 15000);
// CASO C — especial de 30 min → usa el override.
assert.equal(resolverPrecioReserva({ precio_15: 15000, precio_30: 25000 }, "x", 30, normal), 25000);

// CASO D — override SOLO 15 min → 15 usa especial, 30 usa normal.
assert.equal(resolverPrecioReserva({ precio_15: 15000, precio_30: null }, "x", 15, normal), 15000);
assert.equal(resolverPrecioReserva({ precio_15: 15000, precio_30: null }, "x", 30, normal), 18000);
// override SOLO 30 → 30 especial, 15 normal.
assert.equal(resolverPrecioReserva({ precio_15: null, precio_30: 25000 }, "x", 15, normal), 12000);
assert.equal(resolverPrecioReserva({ precio_15: null, precio_30: 25000 }, "x", 30, normal), 25000);

// CASO E — sin registro (eliminado) → vuelve al precio normal.
assert.equal(resolverPrecioReserva(null, "x", 30, normal), 18000);

// CASO G — el resolver NUNCA toma un precio del cliente: solo especial o normal.
// Un override inválido/negativo se ignora y cae al normal (no confía en el input).
assert.equal(resolverPrecioReserva({ precio_15: -5, precio_30: null }, "x", 15, normal), 12000);
assert.equal(resolverPrecioReserva({ precio_15: Number.NaN, precio_30: null }, "x", 15, normal), 12000);

console.log("OK — reservasPricing: normal (A), especial 15 (B) / 30 (C), override parcial (D), sin registro→normal (E), ignora inválido/cliente (G).");
