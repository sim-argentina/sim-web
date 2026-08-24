import { strict as assert } from "node:assert";
import {
  configEliminacion,
  validarConfigEliminacion,
  mejorTiempoMs,
  compararClasificacion,
  calcularSeeds,
  serpentina,
  numCarreras,
  esGranFinal,
  armarPrimeraRonda,
  armarSiguienteRonda,
  clasificadosDeCarrera,
  validarResultadoCarrera,
  calcularPodio,
  type ConfigEliminacion,
  type ParticipanteQuali,
  type Clasificado,
  type PlanRonda,
} from "./bracketEngine";

// Se ejecuta con:  npx tsx lib/bracketEngine.test.ts

// ── Config: lectura tolerante + defaults ─────────────────────────────────────
const duelo = configEliminacion({
  config: {
    clasificacion: { vueltas: 3, criterio: "mejor_vuelta_valida" },
    eliminatoria: { pilotos_por_carrera: 4, avanzan: 2, vueltas: 5, final_pilotos: 4 },
  },
});
assert.equal(duelo.clasificacion.habilitada, true);
assert.equal(duelo.clasificacion.vueltas, 3);
assert.equal(duelo.eliminatoria.pilotosPorCarrera, 4);
assert.equal(duelo.eliminatoria.avanzanPorCarrera, 2); // lee "avanzan"
assert.equal(duelo.eliminatoria.finalPilotos, 4);
// Nombres alternativos (avanzan_por_carrera / camelCase) también válidos.
const alt = configEliminacion({ config: { eliminatoria: { pilotos_por_carrera: 3, avanzan_por_carrera: 1, final_pilotos: 3 } } });
assert.equal(alt.eliminatoria.avanzanPorCarrera, 1);
// Sin config → defaults.
assert.equal(configEliminacion({}).eliminatoria.pilotosPorCarrera, 4);

// ── Validación de config ─────────────────────────────────────────────────────
assert.equal(validarConfigEliminacion(duelo).ok, true);
const bad = (c: Partial<ConfigEliminacion["eliminatoria"]>) =>
  validarConfigEliminacion({
    clasificacion: { habilitada: true, vueltas: 3, criterio: "x" },
    eliminatoria: { pilotosPorCarrera: 4, avanzanPorCarrera: 2, vueltas: 5, finalPilotos: 4, ...c },
  });
assert.equal(bad({ pilotosPorCarrera: 1 }).ok, false); // < 2
assert.equal(bad({ avanzanPorCarrera: 4 }).ok, false); // avanzan >= pilotos
assert.equal(bad({ avanzanPorCarrera: 0 }).ok, false); // avanzan < 1
assert.equal(bad({ vueltas: 0 }).ok, false);
assert.equal(bad({ finalPilotos: 1 }).ok, false); // < 2
assert.equal(bad({ finalPilotos: 6 }).ok, false); // final > pilotos_por_carrera

// ── Quali: mejor tiempo, válidas/ inválidas, desempates ──────────────────────
const P = (id: string, laps: Array<[number | null, boolean]>, orden: number, presente = true, incluido = true): ParticipanteQuali => ({
  inscripcion_id: id,
  presente,
  incluido,
  orden_inscripcion: orden,
  vueltas: laps.map(([tiempo_ms, valida]) => ({ tiempo_ms, valida })),
});
// 3 vueltas: mejor válida = 90850 (la inválida 89900 no cuenta).
assert.equal(mejorTiempoMs(P("a", [[91220, true], [90850, true], [89900, false]], 1)), 90850);
// Todas inválidas → sin tiempo.
assert.equal(mejorTiempoMs(P("b", [[88000, false], [87000, false]], 2)), null);
// Sin vueltas → sin tiempo.
assert.equal(mejorTiempoMs(P("c", [], 3)), null);
// Empate en mejor vuelta → desempata por 2.ª mejor.
const e1 = P("e1", [[90000, true], [91000, true]], 1);
const e2 = P("e2", [[90000, true], [90500, true]], 2);
assert.ok(compararClasificacion(e2, e1) < 0); // e2 tiene mejor 2.ª vuelta
// Empate total en tiempos → desempata por orden de inscripción.
const f1 = P("f1", [[90000, true]], 5);
const f2 = P("f2", [[90000, true]], 3);
assert.ok(compararClasificacion(f2, f1) < 0); // f2 se inscribió antes

// ── Seeding: con tiempo primero, sin tiempo al final, ausentes/excluidos fuera ─
const seeds = calcularSeeds([
  P("rapido", [[90000, true]], 1),
  P("medio", [[91000, true]], 2),
  P("lento", [[92000, true]], 3),
  P("sinTiempo", [[93000, false]], 4), // presente, sin válida, incluido → al final
  P("ausente", [[80000, true]], 5, false), // ausente → excluido
  P("excluido", [], 6, true, false), // sin tiempo + no incluido → excluido
]);
assert.deepEqual(seeds.map((s) => s.inscripcion_id), ["rapido", "medio", "lento", "sinTiempo"]);
assert.deepEqual(seeds.map((s) => s.seed), [1, 2, 3, 4]);
assert.equal(seeds.find((s) => s.inscripcion_id === "sinTiempo")!.mejor_ms, null);

// ── Serpentina: caso Duelo 32 en 8 carreras = distribución equilibrada ───────
const seeds32 = Array.from({ length: 32 }, (_, i) => i + 1);
const grupos8 = serpentina(seeds32, 8);
assert.deepEqual(grupos8[0], [1, 16, 17, 32]);
assert.deepEqual(grupos8[1], [2, 15, 18, 31]);
assert.deepEqual(grupos8[7], [8, 9, 24, 25]);
// Cada grupo suma balanceado (los 4 seeds suman 66 en todos).
for (const g of grupos8) assert.equal(g.reduce((a, b) => a + b, 0), 66);
assert.equal(numCarreras(32, 4), 8);
assert.equal(numCarreras(31, 4), 8);
assert.equal(numCarreras(27, 4), 7);

// ── Helper: simula un torneo completo (gana siempre el mejor seed) ───────────
function seedList(n: number) {
  return Array.from({ length: n }, (_, i) => ({ inscripcion_id: `p${i + 1}`, seed: i + 1, mejor_ms: 1000 + i }));
}
// Simula: dada una PlanRonda, "corre" cada carrera (gana el menor seed) y devuelve
// los clasificados con origen, o el podio si fue la final.
type SimResult = { rondas: number; carrerasPorRonda: number[]; podio: string[]; rematchClashes: number };
function simular(nParticipantes: number, cfg: ConfigEliminacion): SimResult {
  const A = cfg.eliminatoria.avanzanPorCarrera;
  let plan: PlanRonda = armarPrimeraRonda(seedList(nParticipantes), cfg);
  const carrerasPorRonda: number[] = [];
  let rondas = 0;
  let rematchClashes = 0;
  let podio: string[] = [];
  let guard = 0;

  while (guard++ < 50) {
    rondas++;
    carrerasPorRonda.push(plan.carreras.length);
    // Rematches: nadie con el mismo origen dos veces en una carrera. La final SÍ
    // reúne a semifinalistas por diseño (no es rematch), así que no se cuenta.
    if (plan.tipo === "principal") {
      for (const c of plan.carreras) {
        const origenes = c.participantes.map((p) => p.origen_carrera_id).filter(Boolean);
        rematchClashes += origenes.length - new Set(origenes).size;
      }
    }
    if (plan.tipo === "final") {
      // Ordena la final por seed (mejor gana) y arma podio.
      const orden = [...plan.carreras[0].participantes].sort((a, b) => a.seed - b.seed);
      podio = orden.slice(0, 3).map((p) => p.inscripcion_id);
      break;
    }
    // "Corre" cada carrera: clasifican los A mejores seeds; carrera_id = índice.
    const clasificados: Clasificado[] = [];
    plan.carreras.forEach((c, ci) => {
      const orden = [...c.participantes].sort((a, b) => a.seed - b.seed);
      orden.slice(0, A).forEach((p, pos) => {
        clasificados.push({
          inscripcion_id: p.inscripcion_id,
          seed: p.seed,
          origen_carrera_id: `r${rondas}c${ci}`,
          origen_posicion: pos + 1,
        });
      });
    });
    plan = armarSiguienteRonda(clasificados, cfg);
  }
  return { rondas, carrerasPorRonda, podio, rematchClashes };
}

// ── Test estrella: Duelo 32 → 16 → 8 → 4 → podio ─────────────────────────────
const sim32 = simular(32, duelo);
assert.deepEqual(sim32.carrerasPorRonda, [8, 4, 2, 1]); // R1:8, R2:4, R3:2, Final:1
assert.equal(sim32.rondas, 4);
assert.equal(sim32.podio.length, 3);
assert.deepEqual(sim32.podio, ["p1", "p2", "p3"]); // ganan los mejores seeds
assert.equal(sim32.rematchClashes, 0); // sin rematches inmediatos

// ── Menos participantes (config Duelo, sin preliminar) ───────────────────────
for (const n of [31, 27, 16, 8, 4]) {
  const s = simular(n, duelo);
  assert.equal(s.podio.length, 3, `n=${n} debe tener podio de 3`);
  assert.equal(s.rematchClashes, 0, `n=${n} sin rematches`);
  // Nunca una carrera supera pilotos_por_carrera (se valida en la generación).
}
// 4 participantes → final directa (una sola ronda).
assert.deepEqual(simular(4, duelo).carrerasPorRonda, [1]);
// 8 → 2 carreras → final.
assert.deepEqual(simular(8, duelo).carrerasPorRonda, [2, 1]);
// 16 → 4 → 2 → final.
assert.deepEqual(simular(16, duelo).carrerasPorRonda, [4, 2, 1]);

// ── Configuraciones distintas a Duelo (no hardcodeado) ───────────────────────
// Fixture A: 16 · 4/carrera · avanzan 2 · final 4.
const A = configEliminacion({ config: { eliminatoria: { pilotos_por_carrera: 4, avanzan: 2, final_pilotos: 4 } } });
assert.deepEqual(simular(16, A).carrerasPorRonda, [4, 2, 1]);
assert.equal(simular(16, A).podio.length, 3);
// Fixture B: 8 · 2/carrera · avanzan 1 · final 2.
const B = configEliminacion({ config: { eliminatoria: { pilotos_por_carrera: 2, avanzan: 1, final_pilotos: 2 } } });
const simB = simular(8, B);
assert.deepEqual(simB.carrerasPorRonda, [4, 2, 1]); // 8→4→2→final(2)
assert.equal(simB.podio.length, 2); // solo 2 en la final → podio 1.º/2.º
assert.equal(simB.rematchClashes, 0);
// Fixture C: 24 · 3/carrera · avanzan 1 · final 3.
const C = configEliminacion({ config: { eliminatoria: { pilotos_por_carrera: 3, avanzan: 1, final_pilotos: 3 } } });
const simC = simular(24, C);
assert.deepEqual(simC.carrerasPorRonda, [8, 3, 1]); // 24→8→3(=final)
assert.equal(simC.podio.length, 3);
// Fixture D: 32 · 4/carrera · avanzan 2 · final 4 (igual a Duelo, otra instancia).
assert.deepEqual(simular(32, configEliminacion({ config: { eliminatoria: { pilotos_por_carrera: 4, avanzan: 2, final_pilotos: 4 } } })).carrerasPorRonda, [8, 4, 2, 1]);

// ── Gran final / esGranFinal ─────────────────────────────────────────────────
assert.equal(esGranFinal(4, duelo), true);
assert.equal(esGranFinal(5, duelo), false);
assert.equal(esGranFinal(3, duelo), true); // ≤ final_pilotos
assert.equal(esGranFinal(2, B), true);

// ── Resultados: validación + avance + podio ──────────────────────────────────
const ids4 = ["a", "b", "c", "d"];
assert.equal(validarResultadoCarrera(ids4, [
  { inscripcion_id: "a", posicion_final: 1 },
  { inscripcion_id: "b", posicion_final: 2 },
  { inscripcion_id: "c", posicion_final: 3 },
  { inscripcion_id: "d", posicion_final: 4 },
]).ok, true);
// Posición duplicada.
assert.equal(validarResultadoCarrera(ids4, [
  { inscripcion_id: "a", posicion_final: 1 },
  { inscripcion_id: "b", posicion_final: 1 },
  { inscripcion_id: "c", posicion_final: 3 },
  { inscripcion_id: "d", posicion_final: 4 },
]).ok, false);
// Falta un participante.
assert.equal(validarResultadoCarrera(ids4, [
  { inscripcion_id: "a", posicion_final: 1 },
  { inscripcion_id: "b", posicion_final: 2 },
]).ok, false);
// Participante ajeno.
assert.equal(validarResultadoCarrera(ids4, [
  { inscripcion_id: "x", posicion_final: 1 },
  { inscripcion_id: "b", posicion_final: 2 },
  { inscripcion_id: "c", posicion_final: 3 },
  { inscripcion_id: "d", posicion_final: 4 },
]).ok, false);

// Avance: top 2 (excluye DSQ/DNF).
const clas = clasificadosDeCarrera([
  { inscripcion_id: "a", posicion_final: 1 },
  { inscripcion_id: "b", posicion_final: 2, estado: "dsq" },
  { inscripcion_id: "c", posicion_final: 3 },
  { inscripcion_id: "d", posicion_final: 4 },
], 2);
assert.deepEqual(clas.map((c) => c.inscripcion_id), ["a", "c"]); // b (DSQ) no avanza

// Podio.
assert.deepEqual(
  calcularPodio([
    { inscripcion_id: "w", posicion_final: 1 },
    { inscripcion_id: "x", posicion_final: 2 },
    { inscripcion_id: "y", posicion_final: 3 },
    { inscripcion_id: "z", posicion_final: 4 },
  ]),
  [{ puesto: 1, inscripcion_id: "w" }, { puesto: 2, inscripcion_id: "x" }, { puesto: 3, inscripcion_id: "y" }],
);

console.log(
  "OK — motor de brackets: config/validación, quali (mejor vuelta, válidas, desempates), " +
    "seeding, serpentina Duelo 1/16/17/32, torneo 32→16→8→4→podio sin rematches, " +
    "31/27/16/8/4, fixtures A/B/C/D, resultados/avance/podio e invariantes de error.",
);
