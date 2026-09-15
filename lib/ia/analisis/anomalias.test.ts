import { strict as assert } from "node:assert";
import { detectarAnomaliasSerie, detectarDivergenciaEntreSeries, MUESTRA_MINIMA_ANOMALIAS } from "@/lib/ia/analisis/anomalias";

// Ejecutar: npx tsx lib/ia/analisis/anomalias.test.ts — puro.

function main() {
  // ── Muestra insuficiente: no evalúa nada (ni falsos positivos ni negativos) ─────────────
  {
    const corta = [1, 2, 3].map((v, i) => ({ etiqueta: `día ${i}`, valor: v }));
    assert.equal(detectarAnomaliasSerie(corta, { tipo: "x" }).length, 0, "con menos del mínimo, no evalúa (evita falsos positivos por poca data)");
  }

  // ── Anomalía REAL: un pico claro entre valores estables → detectada con evidencia ───────
  {
    const fecha = (i: number) => `2026-09-${String(i + 1).padStart(2, "0")}`;
    const serie = [10, 11, 9, 10, 12, 10, 11, 9, 10, 95].map((v, i) => ({ etiqueta: fecha(i), valor: v, periodo: fecha(i) }));
    const anomalias = detectarAnomaliasSerie(serie, { tipo: "turnos_diarios_atipicos", etiquetaUnidad: "turnos" });
    assert.ok(anomalias.length >= 1, "detecta el pico de 95 contra un baseline ~10");
    const pico = anomalias.find((a) => a.valorObservado === 95);
    assert.ok(pico, "el pico está en la lista");
    if (pico) {
      assert.ok(pico.baseline < 15, "el baseline (mediana) queda cerca de los valores normales, no arrastrado por el pico");
      assert.ok(pico.desviacion > 3.5, "desviación robusta por encima del umbral de outlier");
      assert.ok(["alta", "media", "baja"].includes(pico.severidad));
      assert.ok(pico.evidencia.includes("95"), "la evidencia cita el valor observado");
      assert.equal(pico.periodo, "2026-09-10");
    }
  }

  // ── Falso positivo evitado: datos con variación normal (sin outlier) → sin anomalías ────
  {
    const estable = [10, 11, 9, 10, 12, 10, 11, 9, 12, 10].map((v, i) => ({ etiqueta: `día ${i}`, valor: v }));
    const anomalias = detectarAnomaliasSerie(estable, { tipo: "x" });
    assert.equal(anomalias.length, 0, "variación normal (sin outliers) → 'no se detectaron anomalías importantes', no se inventa una");
  }

  // ── Divergencia entre series relacionadas (Stand vs Reservas) ───────────────────────────
  {
    const fechaDiv = (i: number) => `2026-09-${String(i + 1).padStart(2, "0")}`;
    const stand = [10, 12, 11, 9, 10, 11, 10, 9, 12, 11].map((v, i) => ({ etiqueta: fechaDiv(i), valor: v }));
    const reservas = [10, 11, 10, 10, 9, 60, 11, 10, 11, 10].map((v, i) => ({ etiqueta: fechaDiv(i), valor: v })); // día 6: reservas muy alto vs stand
    const div = detectarDivergenciaEntreSeries(stand, reservas, "divergencia_stand_reservas");
    assert.ok(div.length >= 1, "detecta el día con divergencia atípica entre Stand y Reservas");
  }

  console.log(`OK — anomalias (puro): muestra insuficiente (<${MUESTRA_MINIMA_ANOMALIAS}) no evalúa; anomalía real (pico) detectada con evidencia/baseline/severidad; datos normales → SIN anomalías (falso positivo evitado); divergencia entre series relacionadas (Stand vs Reservas).`);
}
main();
