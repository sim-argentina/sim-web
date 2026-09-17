import { strict as assert } from "node:assert";
import { compararValor, compararSetMetricas, formatearValorComparado } from "@/lib/ia/analisis/comparacion";

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

  // ── HOTFIX 2 — caso productivo observado: A (agosto, base) = 607, B (septiembre, actual) = 492.
  // La variación debe calcularse contra A (agosto), NUNCA contra B (septiembre): 115/607*100,
  // no 115/492*100 (eso daba el -23,37% incorrecto que se vio en producción).
  {
    const r = compararValor(607, 492, "turnos");
    assert.equal(r.diferencia, -115, "B-A = 492-607 = -115");
    assert.equal(r.variacionPct, -18.95, "(492-607)/|607|*100 = -18,95% (NUNCA -23,37%, que sale de dividir por B)");
    assert.equal(r.diferenciaFormateada, "-115", "el signo negativo sobrevive al formateo de enteros");
    assert.equal(r.variacionFormateada, "-18,95 %");
  }
  {
    const r = compararValor(555, 442, "personas");
    assert.equal(r.diferencia, -113);
    assert.equal(r.variacionPct, -20.36);
  }
  {
    const r = compararValor(333, 270, "operaciones");
    assert.equal(r.diferencia, -63);
    assert.equal(r.variacionPct, -18.92);
  }
  {
    const r = compararValor(6988000, 5658000, "ars");
    assert.equal(r.diferencia, -1330000);
    assert.equal(r.variacionPct, -19.03);
    assert.equal(r.valorAFormateado, "$6.988.000");
    assert.equal(r.valorBFormateado, "$5.658.000");
    assert.equal(r.diferenciaFormateada, "-$1.330.000", "el signo negativo sobrevive al formateo de dinero (antes se perdía: aparecía como $1.330.000)");
    assert.equal(r.variacionFormateada, "-19,03 %");
  }
  {
    const r = compararValor(230, 222.6, "horas");
    assert.equal(r.diferencia, -7.4);
    assert.equal(r.variacionPct, -3.22);
    assert.equal(r.valorAFormateado, "230 h");
    assert.equal(r.valorBFormateado, "222,6 h");
    assert.equal(r.diferenciaFormateada, "-7,4 h", "el signo negativo sobrevive al formateo de horas (antes se perdía: aparecía como 7,4 h)");
    assert.equal(r.variacionFormateada, "-3,22 %");
  }
  console.log("OK — HOTFIX 2: caso productivo (turnos/personas/operaciones/facturación/horas) con la base correcta (A=agosto) y signos preservados en el formateo.");

  // ── Crecimiento positivo, caída negativa, valores iguales ────────────────────────────────
  {
    const r = compararValor(100, 130, "turnos");
    assert.equal(r.diferencia, 30);
    assert.equal(r.variacionPct, 30, "crecimiento → diferencia y variación POSITIVAS");
    assert.equal(r.diferenciaFormateada, "30");
  }
  {
    const r = compararValor(100, 70, "turnos");
    assert.equal(r.diferencia, -30);
    assert.equal(r.variacionPct, -30, "caída → diferencia y variación NEGATIVAS");
  }
  {
    const r = compararValor(80, 80, "turnos");
    assert.equal(r.diferencia, 0);
    assert.equal(r.variacionPct, 0, "valores iguales → variación 0%, no null (la base no es cero)");
  }
  console.log("OK — crecimiento positivo, caída negativa y valores iguales.");

  // ── Base NEGATIVA (ej. ganancia_sim puede ser negativa: una pérdida que se achica) ────────
  {
    const r = compararValor(-100, -50, "ars");
    assert.equal(r.diferencia, 50, "B-A = -50-(-100) = 50: la pérdida se redujo");
    assert.equal(r.variacionPct, 50, "50/|-100|*100 = 50%: SIEMPRE se divide por el VALOR ABSOLUTO de A");
  }
  console.log("OK — base negativa: variación usa |A|, no A, como denominador.");

  // ── Valor actual (B) cero ─────────────────────────────────────────────────────────────────
  {
    const r = compararValor(100, 0, "turnos");
    assert.equal(r.diferencia, -100);
    assert.equal(r.variacionPct, -100, "cae a cero → -100%, no null (null es SOLO para base cero)");
    assert.equal(r.variacionFormateada, "-100,00 %");
  }
  console.log("OK — valor actual (B) en cero: -100%, distinto de base cero (null).");

  // ── Redondeo a 2 decimales sin alterar el valor interno completo ─────────────────────────
  {
    const r = compararValor(3, 1, "operaciones"); // (1-3)/3*100 = -66,666...%
    assert.equal(r.variacionPct, -66.67, "redondeado a 2 decimales");
    assert.equal(r.diferencia, -2);
  }
  console.log("OK — redondeo de variación a 2 decimales.");

  // ── formatearValorComparado: signo SIEMPRE antes del símbolo de moneda, nunca después ────
  {
    assert.equal(formatearValorComparado(-1330000, "ars"), "-$1.330.000");
    assert.equal(formatearValorComparado(1330000, "ars"), "$1.330.000");
    assert.equal(formatearValorComparado(-7.4, "horas"), "-7,4 h");
    assert.equal(formatearValorComparado(-18.95, "porcentaje"), "-18,95 %");
    assert.equal(formatearValorComparado(-115, "turnos"), "-115");
    assert.equal(formatearValorComparado(0, "turnos"), "0");
  }
  console.log("OK — formatearValorComparado: el signo va SIEMPRE antes del símbolo ('-$...', nunca '$-...').");

  // ── Coherencia: compararSetMetricas produce los mismos valores que compararValor suelto ───
  {
    const [viaSet] = compararSetMetricas([{ clave: "turnos", etiqueta: "Turnos", unidad: "turnos", valorA: 607, valorB: 492 }]);
    const suelto = compararValor(607, 492, "turnos");
    assert.deepEqual(viaSet.diferenciaFormateada, suelto.diferenciaFormateada, "mismo resultado formateado por el camino de set que por el camino suelto (resumen/tabla no pueden divergir)");
    assert.deepEqual(viaSet.variacionFormateada, suelto.variacionFormateada);
  }
  console.log("OK — compararSetMetricas y compararValor producen exactamente los mismos valores formateados (resumen/tabla/payload no pueden divergir).");

  console.log("OK — comparacion (puro): base cero → no calculable (null); variación %/diferencia correctas; operaciones con decimales no se redondean a entero; set de métricas.");
}
main();
