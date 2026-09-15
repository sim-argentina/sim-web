import { strict as assert } from "node:assert";
import { compararValor, compararSetMetricas } from "@/lib/ia/analisis/comparacion";

// Ejecutar: npx tsx lib/ia/analisis/comparacion.test.ts — puro.

function main() {
  // ── Variación con base CERO → "no calculable" (null), nunca un número inventado ─────────
  {
    const r = compararValor(0, 45, "turnos");
    assert.equal(r.variacionPct, null, "base cero → variación no calculable (null, no 0% ni Infinity)");
    assert.equal(r.diferencia, 45);
  }
  // Base cero y valor también cero: diferencia 0, sigue sin ser calculable.
  {
    const r = compararValor(0, 0, "turnos");
    assert.equal(r.variacionPct, null);
    assert.equal(r.diferencia, 0);
  }

  // ── Caso normal: variación correcta ──────────────────────────────────────────────────────
  {
    const r = compararValor(100, 150, "turnos");
    assert.equal(r.diferencia, 50);
    assert.equal(r.variacionPct, 50, "150 vs 100 = +50%");
  }
  {
    const r = compararValor(200, 150, "ars");
    assert.equal(r.diferencia, -50);
    assert.equal(r.variacionPct, -25, "150 vs 200 = -25%");
  }

  // ── Operaciones con decimales (reparto entre empleados): NO se redondean a entero ───────
  {
    const r = compararValor(4.5, 6.25, "operaciones");
    assert.equal(r.valorA, 4.5, "no se fuerza a entero");
    assert.equal(r.valorB, 6.25);
  }

  // ── Set de métricas ───────────────────────────────────────────────────────────────────────
  {
    const set = compararSetMetricas([
      { clave: "turnos", etiqueta: "Turnos", unidad: "turnos", valorA: 100, valorB: 120 },
      { clave: "bruto", etiqueta: "Facturación bruta", unidad: "ars", valorA: 0, valorB: 5000 },
    ]);
    assert.equal(set.length, 2);
    assert.equal(set[0].variacionPct, 20);
    assert.equal(set[1].variacionPct, null, "base cero en el set también da null, no 0%");
  }

  console.log("OK — comparacion (puro): base cero → no calculable (null); variación %/diferencia correctas; operaciones con decimales no se redondean a entero; set de métricas.");
}
main();
