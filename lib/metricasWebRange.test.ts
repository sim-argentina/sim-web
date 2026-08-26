import { strict as assert } from "node:assert";
import { resolveRange, hoyAR, esRangeKey, validDate } from "@/lib/metricasWebRange";

// Ejecutar: npx tsx lib/metricasWebRange.test.ts
const NOW = new Date("2026-03-15T12:00:00-03:00"); // domingo 15 mar 2026, hora AR

assert.equal(hoyAR(NOW), "2026-03-15", "hoy AR");

// 7 días
{
  const { current, previous } = resolveRange("7d", undefined, NOW);
  assert.deepEqual(current, { start: "2026-03-09", end: "2026-03-15" }, "7d actual");
  assert.deepEqual(previous, { start: "2026-03-02", end: "2026-03-08" }, "7d anterior equivalente");
}
// hoy
{
  const { current, previous } = resolveRange("today", undefined, NOW);
  assert.deepEqual(current, { start: "2026-03-15", end: "2026-03-15" });
  assert.deepEqual(previous, { start: "2026-03-14", end: "2026-03-14" });
}
// 30 días
{
  const { current, previous } = resolveRange("30d", undefined, NOW);
  assert.deepEqual(current, { start: "2026-02-14", end: "2026-03-15" }, "30d actual");
  assert.deepEqual(previous, { start: "2026-01-15", end: "2026-02-13" }, "30d anterior (30 días)");
}
// este mes
{
  const { current, previous } = resolveRange("this_month", undefined, NOW);
  assert.deepEqual(current, { start: "2026-03-01", end: "2026-03-15" });
  assert.deepEqual(previous, { start: "2026-02-14", end: "2026-02-28" }, "mes: anterior de misma longitud");
}
// mes anterior
{
  const { current } = resolveRange("prev_month", undefined, NOW);
  assert.deepEqual(current, { start: "2026-02-01", end: "2026-02-28" }, "febrero completo");
}
// custom con fechas invertidas → se ordenan
{
  const { current } = resolveRange("custom", { start: "2026-03-10", end: "2026-03-05" }, NOW);
  assert.deepEqual(current, { start: "2026-03-05", end: "2026-03-10" });
}
// custom inválido → cae a un rango válido por defecto (no rompe)
{
  const { current } = resolveRange("custom", { start: "no-fecha" }, NOW);
  assert.ok(validDate(current.start) && validDate(current.end), "custom inválido produce rango válido");
}
assert.equal(esRangeKey("7d"), true);
assert.equal(esRangeKey("nope"), false);
assert.equal(validDate("2026-03-01"), true);
assert.equal(validDate("2026-3-1"), false);

console.log("OK — rangos web: hoy AR, today/7d/30d/este mes/mes anterior/custom con período anterior EQUIVALENTE; timezone AR; validaciones.");
