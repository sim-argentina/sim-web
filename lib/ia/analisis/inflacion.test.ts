import { strict as assert } from "node:assert";
import { ajustarPorInflacion, ajusteEsRelevante } from "@/lib/ia/analisis/inflacion";

// Ejecutar: npx tsx lib/ia/analisis/inflacion.test.ts — puro.

function main() {
  // ── Ajuste NOMINAL + REAL con índice oficial presente para ambos períodos ──────────────
  {
    const serie = new Map([["2026-01", 100], ["2026-08", 150]]);
    const r = ajustarPorInflacion(1000, "2026-01", "2026-08", serie);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.montoNominal, 1000, "el nominal se conserva siempre");
      assert.equal(r.montoConstante, 1500, "1000 * (150/100) = 1500 en pesos constantes del período base");
      assert.equal(r.periodoBase, "2026-08");
      assert.equal(r.indiceOrigen, 100);
      assert.equal(r.indiceBase, 150);
    }
  }

  // ── Índice FALTANTE: no se inventa, se declara qué falta ────────────────────────────────
  {
    const serie = new Map([["2026-01", 100]]); // falta 2026-08
    const r = ajustarPorInflacion(1000, "2026-01", "2026-08", serie);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.periodoFaltante, "2026-08", "identifica EXACTAMENTE qué período falta");
  }
  {
    const serie = new Map<string, number>(); // vacía: falta el período de origen
    const r = ajustarPorInflacion(1000, "2026-01", "2026-08", serie);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.periodoFaltante, "2026-01");
  }

  // ── Relevancia del ajuste: >1 mes de separación o interanual → sí; mismo mes → no ───────
  assert.equal(ajusteEsRelevante("2026-08", "2026-09"), false, "un mes de diferencia: no es 'relevante' automáticamente (el usuario puede pedirlo igual)");
  assert.equal(ajusteEsRelevante("2026-08", "2026-08"), false, "mismo mes exacto: nada que ajustar");
  assert.equal(ajusteEsRelevante("2026-06", "2026-09"), true, ">1 mes de separación → relevante");
  assert.equal(ajusteEsRelevante("2025-08", "2026-08"), true, "interanual (mismo mes, distinto año) → relevante");

  console.log("OK — inflacion (puro): ajuste nominal+real con índice presente (fórmula exacta); índice faltante identifica el período exacto sin inventar; relevancia del ajuste (>1 mes / interanual) determinística.");
}
main();
