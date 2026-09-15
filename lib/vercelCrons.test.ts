import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guardia estructural del plan de Vercel (Bloque M5B.1).
// Ejecutar: npx tsx lib/vercelCrons.test.ts
//
// El proyecto está en plan HOBBY, y Hobby solo admite crons de UNA ejecución
// diaria: una expresión más frecuente hace FALLAR el deployment con
// "Hobby accounts are limited to daily cron jobs".
//
// Eso fue exactamente lo que dejó a M5B sin desplegar: su barrido de retenciones
// pedía `*/10 * * * *`. Este test existe para que no vuelva a pasar en silencio.
// Si algún día se contrata Pro, hay que bajar PLAN_HOBBY a false a propósito,
// que es justamente la decisión que se quiere hacer explícita.

const PLAN_HOBBY = true;

type Cron = { path: string; schedule: string };

const vercelJson = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
) as { crons?: Cron[] };

const crons = vercelJson.crons ?? [];

/**
 * ¿Esta expresión corre COMO MUCHO una vez por día?
 *
 * Solo es así cuando el minuto y la hora son un valor fijo. Cualquier `*`,
 * lista (`0,30`), rango (`0-30`) o paso (`*​/10`) en esos dos campos dispara
 * más de una vez al día. Los campos de día/mes/semana pueden ser lo que sea:
 * restringen, nunca agregan ejecuciones dentro de un mismo día.
 */
export function corremenosDeUnaVezPorDia(schedule: string): boolean {
  const campos = schedule.trim().split(/\s+/);
  if (campos.length !== 5) return false; // forma rara: se trata como no segura
  const [minuto, hora] = campos;
  const fijo = (c: string) => /^\d{1,2}$/.test(c);
  return fijo(minuto) && fijo(hora);
}

// ── 1) Ninguna expresión puede correr más de una vez al día ─────────────────
if (PLAN_HOBBY) {
  const infractores = crons.filter((c) => !corremenosDeUnaVezPorDia(c.schedule));
  assert.deepEqual(
    infractores.map((c) => `${c.path} (${c.schedule})`),
    [],
    "Plan Hobby: estos crons correrían más de una vez por día y harían fallar el deployment",
  );
}

// ── 2) El cron de liberación de M5B no puede reaparecer ────────────────────
assert.equal(
  crons.some((c) => c.path.includes("/api/mensualidades/liberar")),
  false,
  "M5B.1 retiró el barrido de retenciones: no debe haber un cron de liberación",
);
assert.equal(
  crons.some((c) => c.schedule === "*/10 * * * *"),
  false,
  "El cron `*/10 * * * *` de M5B no puede volver mientras el plan sea Hobby",
);

// ── 3) Los tres crons diarios preexistentes siguen intactos ────────────────
const esperados = [
  { path: "/api/admin/ia/purga", schedule: "0 4 * * *" },
  { path: "/api/admin/ia/informes/purga", schedule: "30 4 * * *" },
  { path: "/api/admin/ia/creditos/sincronizar", schedule: "0 5 * * *" },
];
for (const e of esperados) {
  assert.ok(
    crons.some((c) => c.path === e.path && c.schedule === e.schedule),
    `Falta o cambió el cron preexistente ${e.path} (${e.schedule})`,
  );
}
assert.equal(crons.length, esperados.length, "No debería haber más crons que los tres diarios");

// ── 4) Cordura del detector ────────────────────────────────────────────────
for (const ok of ["0 4 * * *", "30 4 * * *", "0 5 * * *", "15 3 * * 1", "0 0 1 * *"]) {
  assert.equal(corremenosDeUnaVezPorDia(ok), true, `${ok} corre una vez por día o menos`);
}
for (const mal of ["*/10 * * * *", "0 * * * *", "* * * * *", "0,30 4 * * *", "0 0-6 * * *", "0 */2 * * *"]) {
  assert.equal(corremenosDeUnaVezPorDia(mal), false, `${mal} corre más de una vez por día`);
}

console.log(`vercelCrons.test.ts OK (${crons.length} crons, todos diarios)`);
