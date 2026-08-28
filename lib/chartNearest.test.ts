import { strict as assert } from "node:assert";
import { nearestIndex } from "@/lib/chartNearest";

// Ejecutar: npx tsx lib/chartNearest.test.ts
assert.equal(nearestIndex(0, 0.5), -1, "sin puntos → -1");
assert.equal(nearestIndex(1, 0.9), 0, "un punto → 0");
assert.equal(nearestIndex(5, 0), 0, "extremo izquierdo");
assert.equal(nearestIndex(5, 1), 4, "extremo derecho");
assert.equal(nearestIndex(5, 0.5), 2, "medio");
assert.equal(nearestIndex(5, 0.24), 1, "0.24×4=0.96 → 1");
assert.equal(nearestIndex(5, -0.3), 0, "clamp izquierda");
assert.equal(nearestIndex(5, 2), 4, "clamp derecha");
assert.equal(nearestIndex(5, NaN), 0, "NaN → 0 (no rompe)");

console.log("OK — chartNearest: día más cercano por ratio X (clamp, extremos, medio, NaN).");
