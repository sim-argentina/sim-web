import { strict as assert } from "node:assert";
import { diasEnMes, rangoMes, ultimoDiaMes } from "@/lib/finanzasMes";
import fs from "node:fs";

// Regresión del bug de rango mensual de Finanzas.
//
// Causa: las consultas del mes acotaban el tope como `${mes}-31`. En meses de 30
// días y en febrero esa fecha NO EXISTE y Postgres rechaza la consulta ENTERA con
// 22008 (date/time field value out of range). En getComisionesStandMes el error se
// descartaba, `turnos` quedaba en null y la comisión del mes se calculaba como $0
// → el saldo teórico de Mercado Pago quedaba inflado por el total de comisiones
// (septiembre 2026: $52.975,50) sin ningún aviso en pantalla.
//
// Ejecutar: npx tsx lib/finanzasRangoMes.test.ts

// ── Helper: ¿la fecha existe realmente en el calendario? ─────────────────────
function esFechaReal(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
assert.equal(esFechaReal("2026-09-30"), true, "control: 30/09 existe");
assert.equal(esFechaReal("2026-09-31"), false, "control: 31/09 NO existe");
assert.equal(esFechaReal("2026-02-29"), false, "control: 2026 no es bisiesto");

// ── 1) Meses de 28 / 29 / 30 / 31 días ───────────────────────────────────────
const CASOS: Array<{ mes: string; dias: number; ultimo: string; hastaExclusivo: string; nota: string }> = [
  { mes: "2026-02", dias: 28, ultimo: "2026-02-28", hastaExclusivo: "2026-03-01", nota: "febrero normal" },
  { mes: "2028-02", dias: 29, ultimo: "2028-02-29", hastaExclusivo: "2028-03-01", nota: "febrero bisiesto" },
  { mes: "2024-02", dias: 29, ultimo: "2024-02-29", hastaExclusivo: "2024-03-01", nota: "febrero bisiesto (pasado)" },
  { mes: "2100-02", dias: 28, ultimo: "2100-02-28", hastaExclusivo: "2100-03-01", nota: "2100 NO es bisiesto (regla de los 400)" },
  { mes: "2026-04", dias: 30, ultimo: "2026-04-30", hastaExclusivo: "2026-05-01", nota: "30 días" },
  { mes: "2026-06", dias: 30, ultimo: "2026-06-30", hastaExclusivo: "2026-07-01", nota: "30 días" },
  { mes: "2026-09", dias: 30, ultimo: "2026-09-30", hastaExclusivo: "2026-10-01", nota: "30 días — el mes del bug" },
  { mes: "2026-11", dias: 30, ultimo: "2026-11-30", hastaExclusivo: "2026-12-01", nota: "30 días" },
  { mes: "2026-01", dias: 31, ultimo: "2026-01-31", hastaExclusivo: "2026-02-01", nota: "31 días" },
  { mes: "2026-08", dias: 31, ultimo: "2026-08-31", hastaExclusivo: "2026-09-01", nota: "31 días — agosto no debe cambiar" },
  { mes: "2026-12", dias: 31, ultimo: "2026-12-31", hastaExclusivo: "2027-01-01", nota: "31 días, cruza de año" },
];

for (const c of CASOS) {
  const r = rangoMes(c.mes);
  assert.equal(diasEnMes(c.mes), c.dias, `${c.mes} (${c.nota}): días del mes`);
  assert.equal(ultimoDiaMes(c.mes), c.ultimo, `${c.mes} (${c.nota}): último día real`);
  assert.deepEqual(r, { desde: `${c.mes}-01`, hastaExclusivo: c.hastaExclusivo }, `${c.mes} (${c.nota}): rango`);

  // Ninguna consulta mensual puede generar una fecha inexistente.
  assert.ok(esFechaReal(r.desde), `${c.mes}: desde es una fecha real`);
  assert.ok(esFechaReal(r.hastaExclusivo), `${c.mes}: hastaExclusivo es una fecha real`);
  assert.ok(esFechaReal(ultimoDiaMes(c.mes)), `${c.mes}: último día es una fecha real`);

  // El tope exclusivo es el día siguiente al último día real: no deja turnos afuera.
  const sig = new Date(`${c.ultimo}T00:00:00Z`);
  sig.setUTCDate(sig.getUTCDate() + 1);
  assert.equal(r.hastaExclusivo, sig.toISOString().slice(0, 10), `${c.mes}: hastaExclusivo = último día + 1`);
}

// ── 2) Barrido completo: 2024-01 … 2028-12, ninguna fecha inválida ───────────
for (let y = 2024; y <= 2028; y++) {
  for (let m = 1; m <= 12; m++) {
    const mes = `${y}-${String(m).padStart(2, "0")}`;
    const r = rangoMes(mes);
    assert.ok(esFechaReal(r.desde) && esFechaReal(r.hastaExclusivo) && esFechaReal(ultimoDiaMes(mes)), `${mes}: fechas reales`);
    assert.ok(r.desde < r.hastaExclusivo, `${mes}: desde < hastaExclusivo`);
    assert.ok(ultimoDiaMes(mes) < r.hastaExclusivo, `${mes}: el último día entra en el rango`);
  }
}

// ── 3) Regresión puntual: septiembre 2026 ────────────────────────────────────
assert.deepEqual(
  rangoMes("2026-09"),
  { desde: "2026-09-01", hastaExclusivo: "2026-10-01" },
  "septiembre 2026 se consulta como 2026-09-01 <= fecha < 2026-10-01"
);
assert.equal(ultimoDiaMes("2026-09"), "2026-09-30", "septiembre 2026 termina el 30, no el 31");

// ── 4) Que nadie vuelva a escribir `${mes}-31` en Finanzas ───────────────────
// Guarda estructural: el bug se reintroduce con una sola línea.
const ARCHIVOS = [
  "lib/finanzas.ts",
  "app/api/admin/finanzas/eventos/route.ts",
  "app/api/admin/finanzas/salud-financiera/route.ts",
  "app/api/admin/finanzas/resumen/route.ts",
  "app/api/admin/finanzas/cierre/route.ts",
  "app/api/admin/finanzas/metricas/route.ts",
  "app/api/admin/finanzas/excepciones/route.ts",
];
for (const rel of ARCHIVOS) {
  const src = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  // Se ignora el comentario del helper, que documenta justamente el patrón prohibido.
  const lineas = src.split("\n").filter((l) => !l.trim().startsWith("//") && /-31`|"-31"|'-31'/.test(l));
  assert.deepEqual(lineas, [], `${rel}: no debe construir el fin de mes como \`\${mes}-31\``);
}

console.log("OK — finanzasRangoMes: 28/29/30/31 días, febrero bisiesto y no bisiesto, barrido 2024-2028, regresión septiembre 2026 y guarda anti `${mes}-31`.");
