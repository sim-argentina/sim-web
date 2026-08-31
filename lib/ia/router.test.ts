import { strict as assert } from "node:assert";
import { elegirModelo, debeEscalar } from "@/lib/ia/router";

// Ejecutar: npx tsx lib/ia/router.test.ts
// Router determinístico: una consulta simple NO debe ir al modelo caro.

// Económico: consultas directas.
for (const q of ["¿Cuántos turnos hizo Federico en agosto?", "¿Cuántas horas trabajó Ramiro?", "Turnos del stand en julio", "Estado del cronograma de agosto"]) {
  assert.equal(elegirModelo(q).clase, "economico", `económico: ${q}`);
}

// Potente: comparaciones, FODA, diagnóstico, proyección, causal, financiero.
for (const q of [
  "Compará a Francisco y Federico.",
  "Hacé un FODA de SIM.",
  "¿Por qué bajó la facturación?",
  "Proyectá la facturación de fin de mes.",
  "¿Cuál fue la ganancia de SIM en agosto?",
  "Analizá el rendimiento del stand y sacá conclusiones.",
  "Compará julio con agosto.",
]) {
  assert.equal(elegirModelo(q).clase, "potente", `potente: ${q}`);
}

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
