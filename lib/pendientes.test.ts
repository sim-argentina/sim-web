import { strict as assert } from "node:assert";
import {
  MAX_TITULO,
  MAX_DESCRIPCION,
  validarTitulo,
  normalizarDescripcion,
  parseFechaLimite,
  estadoFecha,
  grupoDe,
  agruparAbiertos,
  ordenarCompletados,
  type PendienteOrden,
} from "./pendientes";

// El proyecto no tiene runner de tests; se ejecuta con:
//   npx tsx lib/pendientes.test.ts

// ── Validación de título ─────────────────────────────────────────────────────
assert.deepEqual(validarTitulo("  Comprar insumos  "), { ok: true, value: "Comprar insumos" }); // trim
assert.equal(validarTitulo("").ok, false);          // vacío
assert.equal(validarTitulo("   ").ok, false);       // solo espacios
assert.equal(validarTitulo(null).ok, false);
assert.equal(validarTitulo("a".repeat(MAX_TITULO)).ok, true);        // límite exacto
assert.equal(validarTitulo("a".repeat(MAX_TITULO + 1)).ok, false);   // supera límite

// ── Normalización de descripción (opcional → null) ───────────────────────────
assert.deepEqual(normalizarDescripcion(undefined), { ok: true, value: null });
assert.deepEqual(normalizarDescripcion(null), { ok: true, value: null });
assert.deepEqual(normalizarDescripcion(""), { ok: true, value: null });
assert.deepEqual(normalizarDescripcion("   "), { ok: true, value: null });          // solo espacios → null
assert.deepEqual(normalizarDescripcion("  hola  "), { ok: true, value: "hola" });   // trim
assert.equal((normalizarDescripcion("d".repeat(MAX_DESCRIPCION)) as { ok: boolean }).ok, true);
assert.equal((normalizarDescripcion("d".repeat(MAX_DESCRIPCION + 1)) as { ok: boolean }).ok, false);

// ── Fecha límite opcional ────────────────────────────────────────────────────
assert.deepEqual(parseFechaLimite(""), { ok: true, value: null });
assert.deepEqual(parseFechaLimite(null), { ok: true, value: null });
assert.deepEqual(parseFechaLimite("2026-08-15"), { ok: true, value: "2026-08-15" });
assert.equal(parseFechaLimite("15/08/2026").ok, false);
assert.equal(parseFechaLimite("2026-13-40").ok, false);

// ── Clasificación de fechas (respecto de hoy = 2026-08-10) ───────────────────
const HOY = "2026-08-10";
assert.equal(estadoFecha(null, HOY), "sinfecha");
assert.equal(estadoFecha("2026-08-09", HOY), "vencido");
assert.equal(estadoFecha("2026-08-01", HOY), "vencido");
assert.equal(estadoFecha("2026-08-10", HOY), "hoy");
assert.equal(estadoFecha("2026-08-11", HOY), "pronto"); // +1 día
assert.equal(estadoFecha("2026-08-13", HOY), "pronto"); // +3 días (límite)
assert.equal(estadoFecha("2026-08-14", HOY), "futuro"); // +4 días
// Cruce de mes sin corrimiento de día por UTC.
assert.equal(estadoFecha("2026-09-01", "2026-08-31"), "pronto");
assert.equal(estadoFecha("2026-08-31", "2026-09-01"), "vencido");

assert.equal(grupoDe(estadoFecha(null, HOY)), "sinfecha");
assert.equal(grupoDe(estadoFecha("2026-08-09", HOY)), "vencidos");
assert.equal(grupoDe(estadoFecha("2026-08-10", HOY)), "proximos");
assert.equal(grupoDe(estadoFecha("2026-08-13", HOY)), "proximos");
assert.equal(grupoDe(estadoFecha("2026-08-20", HOY)), "proximos");

// ── Agrupación + orden ───────────────────────────────────────────────────────
type P = PendienteOrden & { id: number };
const items: P[] = [
  { id: 1, fecha_limite: "2026-08-05", created_at: "2026-08-01T10:00:00Z" }, // vencido
  { id: 2, fecha_limite: "2026-08-02", created_at: "2026-08-01T09:00:00Z" }, // vencido (más antiguo)
  { id: 3, fecha_limite: "2026-08-20", created_at: "2026-08-01T10:00:00Z" }, // futuro
  { id: 4, fecha_limite: "2026-08-11", created_at: "2026-08-01T10:00:00Z" }, // pronto
  { id: 5, fecha_limite: null, created_at: "2026-08-03T10:00:00Z" },          // sin fecha (más nuevo)
  { id: 6, fecha_limite: null, created_at: "2026-08-01T10:00:00Z" },          // sin fecha
  { id: 7, fecha_limite: "2026-08-15", created_at: "2026-08-09T10:00:00Z", completado: true, completado_at: "2026-08-09T12:00:00Z" },
  { id: 8, fecha_limite: null, created_at: "2026-08-09T10:00:00Z", completado: true, completado_at: "2026-08-10T12:00:00Z" },
];

const { vencidos, proximos, sinfecha } = agruparAbiertos(items, HOY);
// Vencidos cronológico ascendente: 2026-08-02 (id2) antes que 2026-08-05 (id1).
assert.deepEqual(vencidos.map((p) => p.id), [2, 1]);
// Próximos cronológico ascendente: 08-11 (id4) antes que 08-20 (id3).
assert.deepEqual(proximos.map((p) => p.id), [4, 3]);
// Sin fecha por created_at desc: id5 (08-03) antes que id6 (08-01).
assert.deepEqual(sinfecha.map((p) => p.id), [5, 6]);
// Los completados no aparecen entre los abiertos.
assert.ok(![...vencidos, ...proximos, ...sinfecha].some((p) => p.completado));

// Completados por completado_at desc: id8 (10) antes que id7 (09).
const completados = ordenarCompletados(items);
assert.deepEqual(completados.map((p) => p.id), [8, 7]);

// ── Contadores de filtros ────────────────────────────────────────────────────
const contTodos = vencidos.length + proximos.length + sinfecha.length; // abiertos
const contProximos = vencidos.length + proximos.length;                // abiertos con fecha
const contSinFecha = sinfecha.length;
const contCompletados = completados.length;
assert.equal(contTodos, 6);        // 2 vencidos + 2 próximos + 2 sin fecha
assert.equal(contProximos, 4);     // 2 vencidos + 2 próximos
assert.equal(contSinFecha, 2);
assert.equal(contCompletados, 2);

console.log(
  `OK — validación (título/descripción/fecha), clasificación vencido/hoy/pronto/futuro/sin fecha, ` +
  `agrupación+orden y contadores de filtros pasan.`,
);
