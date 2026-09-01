import { strict as assert } from "node:assert";
import { rangoMes } from "@/lib/ia/consumoUtil";
import { usoDesde } from "@/lib/ia/providerAnthropic";

// Ejecutar: npx tsx lib/ia/consumoMes.test.ts

// ── Rango de mes: NUNCA "-31" (rompía en meses de 30 días → panel en 0) ──────────
assert.deepEqual(rangoMes("2026-09"), { desde: "2026-09-01", hasta: "2026-10-01" }, "septiembre → [09-01, 10-01)");
assert.deepEqual(rangoMes("2026-12"), { desde: "2026-12-01", hasta: "2027-01-01" }, "diciembre cruza de año");
assert.deepEqual(rangoMes("2026-02"), { desde: "2026-02-01", hasta: "2026-03-01" }, "febrero (28/29 días)");
assert.deepEqual(rangoMes("2026-04"), { desde: "2026-04-01", hasta: "2026-05-01" }, "abril (30 días)");
for (const m of ["2026-01", "2026-02", "2026-04", "2026-06", "2026-09", "2026-11", "2026-12"]) {
  const r = rangoMes(m);
  assert.ok(!r.hasta.endsWith("-31") && !r.desde.endsWith("-31"), `${m}: nunca genera un día 31 inválido`);
}

// ── Tokens de caché: son ENTRADA facturable → suman a tokensIn ────────────────────
assert.deepEqual(usoDesde({ input_tokens: 100, output_tokens: 20 }), { tokensIn: 100, tokensOut: 20 }, "sin caché");
assert.deepEqual(usoDesde({ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 50 }), { tokensIn: 180, tokensOut: 20 }, "input + cache_creation + cache_read");
assert.deepEqual(usoDesde(undefined), { tokensIn: 0, tokensOut: 0 }, "sin usage → 0/0 (no rompe)");

console.log("OK — consumoMes: rango de mes seguro (sin '-31'), cruce de año y meses de 30/28 días; tokens de caché sumados a la entrada.");
