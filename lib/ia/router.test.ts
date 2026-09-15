import { strict as assert } from "node:assert";
import { elegirModelo, debeEscalar } from "@/lib/ia/router";

// Ejecutar: npx tsx lib/ia/router.test.ts
// Router determinístico: una consulta simple NO debe ir al modelo caro.

// Económico: consultas directas.
for (const q of ["¿Cuántos turnos hizo Federico en agosto?", "¿Cuántas horas trabajó Ramiro?", "Turnos del stand en julio", "Estado del cronograma de agosto"]) {
  assert.equal(elegirModelo(q).clase, "economico", `económico: ${q}`);
}

// Potente: comparaciones COMPLEJAS (integrantes, competencia, FODA), diagnóstico, proyección,
// causal, financiero, anomalías.
for (const q of [
  "Compará a Francisco y Federico.",
  "Hacé un FODA de SIM.",
  "¿Por qué bajó la facturación?",
  "Proyectá la facturación de fin de mes.",
  "¿Cuál fue la ganancia de SIM en agosto?",
  "Analizá el rendimiento del stand y sacá conclusiones.",
  "¿Qué anomalías importantes detectás este mes?",
]) {
  assert.equal(elegirModelo(q).clase, "potente", `potente: ${q}`);
}

// 4E — comparación NUMÉRICA SIMPLE, con datos INTERNOS explícitos (turnos/ingresos: sin eso,
// decidirWeb la trata como comparación externa por defecto — correctamente, es ambigua) →
// económico. Antes de 4E, cualquier "compará" iba a potente; el Bloque 4E pide distinguir esto.
for (const q of ["Compará los turnos de julio con agosto.", "Turnos de julio vs agosto.", "Comparación de ingresos entre julio y agosto."]) {
  assert.equal(elegirModelo(q).clase, "economico", `comparación simple (interna) → económico: ${q}`);
}
// La MISMA comparación, con una señal adicional de complejidad, sigue potente.
for (const q of ["Compará los turnos de julio con agosto y decime por qué cambió.", "Compará los turnos de julio con agosto y proyectá septiembre."]) {
  assert.equal(elegirModelo(q).clase, "potente", `comparación + señal adicional → potente: ${q}`);
}
// Una comparación AMBIGUA (sin metric interna nombrada) se trata como potencialmente externa
// (decidirWeb no puede descartar mercado/competencia) → sigue potente, sin cambios de 4E.
assert.equal(elegirModelo("Compará julio con agosto.").clase, "potente", "comparación ambigua (sin métrica interna) → potente");

// Dos integrantes en la misma pregunta → potente (comparación implícita).
assert.equal(elegirModelo("Mostrame a Fran y Fede").clase, "potente", "Fran+Fede → potente");
// Un solo integrante → económico.
assert.equal(elegirModelo("Mostrame a Fede").clase, "economico", "solo Fede → económico");

// Cruce de varias fuentes → potente.
assert.equal(elegirModelo("Relacioná finanzas con el cronograma").clase, "potente", "2 fuentes → potente");

// Escalamiento.
assert.equal(debeEscalar("economico", 3), true, "económico + 3 rondas → escala");
assert.equal(debeEscalar("economico", 2), false, "económico + 2 rondas → no escala");
assert.equal(debeEscalar("potente", 5), false, "potente nunca escala");

console.log("OK — router IA: económico para consultas directas, potente para análisis/comparación/FODA/proyección; escalamiento por rondas.");
