import { strict as assert } from "node:assert";
import { resolverPeriodos, ventanaMes, ventanaEquivalente, diasEnMes } from "@/lib/ia/analisis/periodos";

// Ejecutar: npx tsx lib/ia/analisis/periodos.test.ts — puro.
// Bloque 4E — períodos completos vs equivalentes. "Hoy" simulado: 2026-09-14 (mes en curso).
const HOY = new Date("2026-09-14T15:00:00Z"); // 12:00 hora Córdoba (UTC-3)

function main() {
  // ── 1) Dos meses FINALIZADOS → modo "completos", ventanas = mes entero ─────────────────
  {
    const r = resolverPeriodos({ anio: 2026, mes: 7 }, { anio: 2026, mes: 8 }, HOY);
    assert.equal(r.modo, "completos", "agosto y julio ya terminaron (hoy=14-sep)");
    assert.deepEqual(r.ventanaA, ventanaMes(2026, 7));
    assert.deepEqual(r.ventanaB, ventanaMes(2026, 8));
    assert.equal(r.referenciaCompletaLado, null, "sin referencia completa cuando ambos están cerrados");
  }

  // ── 2) Mes en curso vs mes finalizado → modo "equivalente", tramo recortado ─────────────
  {
    const r = resolverPeriodos({ anio: 2026, mes: 8 }, { anio: 2026, mes: 9 }, HOY); // B=septiembre en curso
    assert.equal(r.modo, "equivalente");
    assert.equal(r.bEnCurso, true);
    assert.equal(r.aEnCurso, false);
    assert.equal(r.diasTranscurridos, 14, "14 de septiembre → 14 días transcurridos");
    assert.equal(r.ventanaB.hasta, "2026-09-14", "el lado en curso llega hasta HOY");
    assert.equal(r.ventanaA.desde, "2026-08-01");
    assert.equal(r.ventanaA.hasta, "2026-08-14", "agosto recortado a los mismos 14 días (tramo equivalente)");
    assert.equal(r.referenciaCompletaLado, "A", "agosto (el mes finalizado) se ofrece aparte como referencia completa");
  }

  // ── 3) Referencia completa separada de la comparación equivalente (no se mezclan) ───────
  {
    const r = resolverPeriodos({ anio: 2026, mes: 8 }, { anio: 2026, mes: 9 }, HOY);
    const completoAgosto = ventanaMes(2026, 8);
    assert.notEqual(r.ventanaA.hasta, completoAgosto.hasta, "la ventana usada en la comparación NO es la de agosto completo");
    assert.equal(completoAgosto.hasta, "2026-08-31", "agosto completo (referencia) sigue siendo el mes entero");
  }

  // ── Clamp: mes de referencia más corto que los días transcurridos (ej. febrero) ─────────
  {
    const eq = ventanaEquivalente(2026, 2, 30); // 2026 no es bisiesto: febrero tiene 28 días
    assert.equal(eq.hasta, "2026-02-28", "nunca se pasa del último día real del mes de referencia");
  }

  // ── diasEnMes / ventanaMes básicos ───────────────────────────────────────────────────────
  assert.equal(diasEnMes(2026, 9), 30);
  assert.equal(diasEnMes(2026, 2), 28);
  assert.deepEqual(ventanaMes(2026, 9), { desde: "2026-09-01", hasta: "2026-09-30" });

  console.log("OK — periodos (puro): mes finalizado vs finalizado → completos; mes en curso vs finalizado → tramo equivalente + referencia completa SEPARADA (no mezclada); clamp de mes corto; diasEnMes/ventanaMes.");
}
main();
