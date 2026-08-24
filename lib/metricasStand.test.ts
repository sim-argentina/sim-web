import { strict as assert } from "node:assert";
import {
  agregarStand,
  turnosDeFila,
  personasDeFila,
  numeroStand,
  MINUTOS_POR_TURNO,
  CANTIDAD_SIMULADORES_FISICOS,
  type FilaStand,
} from "./metricasStand";

// El proyecto no tiene runner de tests; se ejecuta con:
//   npx tsx lib/metricasStand.test.ts

// ── Parseo numérico tolerante ────────────────────────────────────────────────
assert.equal(numeroStand(12000), 12000);
assert.equal(numeroStand("12000"), 12000);
assert.equal(numeroStand("$12.000"), 12000); // miles con punto
assert.equal(numeroStand("12.000,50"), 12000.5); // decimal con coma
assert.equal(numeroStand(null), 0);
assert.equal(numeroStand(""), 0);
assert.equal(numeroStand(undefined), 0);

// ── Turnos por fila (fuente de verdad = cantidad_turnos) ─────────────────────
assert.equal(turnosDeFila({ cantidad_turnos: 8 }), 8);
assert.equal(turnosDeFila({ cantidad_simuladores: 3 }), 3); // fallback Excel
assert.equal(turnosDeFila({ personas: 2 }), 2); // fallback Excel viejo
assert.equal(turnosDeFila({}), 1); // mínimo 1

// ── Personas por fila (real = cantidad_personas, NO cantidad_simuladores) ────
assert.equal(personasDeFila({ cantidad_personas: 4, cantidad_simuladores: 0 }), 4);
assert.equal(personasDeFila({ cantidad_simuladores: 2 }), 2); // fallback Excel
assert.equal(personasDeFila({ personas: 3 }), 3); // fallback Excel viejo
assert.equal(personasDeFila({}), 1); // mínimo 1

// ── Casos multipersona A / B / C (según el modelo de SIM) ────────────────────
// A: 1 persona · 15 min · 1 turno · $12.000
const A: FilaStand = { cantidad_personas: 1, cantidad_turnos: 1, total: 12000 };
// B: 2 personas · 15 min · 2 turnos · $24.000
const B: FilaStand = { cantidad_personas: 2, cantidad_turnos: 2, total: 24000 };
// C: 4 personas · 30 min · 8 turnos · $48.000
const C: FilaStand = { cantidad_personas: 4, cantidad_turnos: 8, total: 48000 };

const soloA = agregarStand([A]);
assert.equal(soloA.ventas, 1);
assert.equal(soloA.turnos, 1);
assert.equal(soloA.personas, 1);
assert.equal(soloA.minutos, 15);
assert.equal(soloA.horas, 0.25);

const soloB = agregarStand([B]);
assert.equal(soloB.ventas, 1); // una fila = una venta, aunque sean 2 personas
assert.equal(soloB.turnos, 2);
assert.equal(soloB.personas, 2);
assert.equal(soloB.minutos, 30);

const soloC = agregarStand([C]);
assert.equal(soloC.ventas, 1);
assert.equal(soloC.turnos, 8);
assert.equal(soloC.personas, 4);
assert.equal(soloC.minutos, 120);
assert.equal(soloC.horas, 2);

// ── Caso D: combinación A + B + C ────────────────────────────────────────────
const D = agregarStand([A, B, C]);
assert.equal(D.ventas, 3); // 3 filas
assert.equal(D.turnos, 11); // 1 + 2 + 8
assert.equal(D.personas, 7); // 1 + 2 + 4
assert.equal(D.minutos, 11 * MINUTOS_POR_TURNO); // 165
assert.equal(D.horas, 165 / 60); // 2.75
assert.equal(D.facturacion, 84000); // 12k + 24k + 48k
assert.equal(D.ticketPromedio, 84000 / 3); // facturación / ventas
assert.equal(D.promedioPersonas, 7 / 3); // personas / ventas
assert.equal(D.ingresoPorMinuto, 84000 / 165); // facturación / minutos
assert.equal(D.ingresoPorPersona, 84000 / 7); // facturación / personas
assert.equal(D.ingresoPromedioPorSimulador, 84000 / CANTIDAD_SIMULADORES_FISICOS);

// ── Una fila = una venta (single-count), sin importar personas/turnos ────────
// Análogo a "una reserva se cuenta una sola vez": la fila no se multiplica por
// sus personas ni por sus turnos al contar ventas.
assert.equal(agregarStand([C]).ventas, 1);
assert.equal(agregarStand([A, B, C, C]).ventas, 4);

// ── Invariantes de consistencia ──────────────────────────────────────────────
// turnos > 0 ⟹ minutos > 0 ⟹ horas > 0
for (const agg of [soloA, soloB, soloC, D]) {
  if (agg.turnos > 0) {
    assert.ok(agg.minutos > 0, "turnos>0 debe implicar minutos>0");
    assert.ok(agg.horas > 0, "minutos>0 debe implicar horas>0");
  }
  // facturación > 0 y minutos > 0 ⟹ ingreso/minuto > 0
  if (agg.facturacion > 0 && agg.minutos > 0) {
    assert.ok(agg.ingresoPorMinuto > 0, "fact>0 & min>0 debe implicar ingreso/min>0");
    assert.ok(agg.ingresoPorPersona > 0, "fact>0 & personas>0 debe implicar ingreso/persona>0");
  }
  // Identidades: minutos = turnos × 15 ; horas = minutos / 60
  assert.equal(agg.minutos, agg.turnos * MINUTOS_POR_TURNO);
  assert.equal(agg.horas, agg.minutos / 60);
}

// ── Conjunto vacío: sin divisiones por cero ──────────────────────────────────
const vacio = agregarStand([]);
assert.equal(vacio.ventas, 0);
assert.equal(vacio.turnos, 0);
assert.equal(vacio.minutos, 0);
assert.equal(vacio.ticketPromedio, 0);
assert.equal(vacio.ingresoPorMinuto, 0);
assert.equal(vacio.ingresoPorPersona, 0);

console.log(
  "OK — agregación del Stand: turnos/personas/minutos/horas, casos multipersona " +
    "A/B/C/D, single-count por fila, invariantes de consistencia y bordes.",
);
