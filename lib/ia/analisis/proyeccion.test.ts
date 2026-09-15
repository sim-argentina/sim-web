import { strict as assert } from "node:assert";
import { proyectarCierre, type DiaHistorico, type DiaFuturo } from "@/lib/ia/analisis/proyeccion";

// Ejecutar: npx tsx lib/ia/analisis/proyeccion.test.ts — puro.

function historicoUniforme(dias: number, valorBase: number): DiaHistorico[] {
  const out: DiaHistorico[] = [];
  for (let i = 0; i < dias; i++) out.push({ fecha: `hist-${i}`, diaSemana: i % 7, valor: valorBase + (i % 3) }); // pequeña variación real
  return out;
}

function main() {
  // ── Muestra insuficiente → ok:false, explica por qué (no inventa una proyección) ───────
  {
    const r = proyectarCierre({ historico: historicoUniforme(3, 1000), diasFuturosDelPeriodo: [], realAcumuladoPeriodoActual: 0, fechaCorte: "2026-09-14", cronogramaOficial: true });
    assert.equal(r.ok, false, "menos del mínimo histórico → no arma proyección");
    if (!r.ok) assert.ok(r.explicacion.length > 0, "explica la limitación");
  }

  // ── Tres escenarios (conservador ≤ base ≤ optimista), basados en percentiles reales ─────
  {
    const historico: DiaHistorico[] = [];
    // 60 días históricos, valores 100-200 distribuidos, para tener variación real por percentil.
    for (let i = 0; i < 60; i++) historico.push({ fecha: `hist-${i}`, diaSemana: i % 7, valor: 100 + (i % 20) * 5 });
    const futuros: DiaFuturo[] = Array.from({ length: 10 }, (_, i) => ({ fecha: `fut-${i}`, diaSemana: i % 7, abierto: true }));
    const r = proyectarCierre({ historico, diasFuturosDelPeriodo: futuros, realAcumuladoPeriodoActual: 500, fechaCorte: "2026-09-14", cronogramaOficial: true });
    assert.ok(r.ok);
    if (r.ok) {
      const [cons, base, opt] = ["conservador", "base", "optimista"].map((n) => r.escenarios.find((e) => e.nombre === n)!);
      assert.ok(cons.valorProyectado <= base.valorProyectado, "conservador ≤ base");
      assert.ok(base.valorProyectado <= opt.valorProyectado, "base ≤ optimista");
      assert.equal(r.realAcumulado, 500, "lo real acumulado queda separado de lo proyectado");
      assert.ok(cons.valorProyectado >= 500, "el proyectado incluye lo real ya acumulado (real + estimado de días futuros)");
      assert.ok(cons.formula.length > 0, "expone la fórmula usada");
      assert.ok(["alta", "media", "baja"].includes(r.confianza));
    }
  }

  // ── Días CERRADOS del cronograma se excluyen (no se les asigna actividad) ────────────────
  {
    const historico = historicoUniforme(20, 1000);
    const futurosTodosCerrados: DiaFuturo[] = Array.from({ length: 5 }, (_, i) => ({ fecha: `fut-${i}`, diaSemana: i, abierto: false }));
    const r = proyectarCierre({ historico, diasFuturosDelPeriodo: futurosTodosCerrados, realAcumuladoPeriodoActual: 200, fechaCorte: "2026-09-14", cronogramaOficial: true });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.diasFuturosCerrados, 5, "cuenta los días cerrados");
      for (const e of r.escenarios) assert.equal(e.valorProyectado, 200, "sin días abiertos futuros, el proyectado = lo real acumulado (no se inventa actividad en días cerrados)");
    }
  }

  // ── Cronograma en BORRADOR → confianza nunca "alta" (queda marcado como supuesto no oficial)
  {
    const historico: DiaHistorico[] = [];
    for (let i = 0; i < 60; i++) historico.push({ fecha: `hist-${i}`, diaSemana: i % 7, valor: 100 + i });
    const futuros: DiaFuturo[] = Array.from({ length: 5 }, (_, i) => ({ fecha: `fut-${i}`, diaSemana: i, abierto: true }));
    const r = proyectarCierre({ historico, diasFuturosDelPeriodo: futuros, realAcumuladoPeriodoActual: 0, fechaCorte: "2026-09-14", cronogramaOficial: false });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.confianza, "baja", "cronograma en borrador (no oficial) → confianza baja, nunca alta");
      assert.ok(r.supuestos.some((s) => /borrador/i.test(s)), "declara explícitamente que el cronograma no es oficial");
    }
  }

  console.log("OK — proyeccion (puro): muestra insuficiente no inventa proyección; tres escenarios ordenados (conservador≤base≤optimista) desde percentiles reales, real acumulado separado de lo proyectado; días cerrados del cronograma excluidos (0 actividad asignada); cronograma en borrador → confianza baja y supuesto declarado.");
}
main();
