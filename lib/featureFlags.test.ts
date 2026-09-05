import { strict as assert } from "node:assert";
import { flagHabilitada, mensualidadesHabilitadas } from "@/lib/featureFlags";

// Ejecutar: npx tsx lib/featureFlags.test.ts
// La flag tiene que ser ESTRICTA: solo el string exacto "true" habilita. Un typo
// en Vercel no debe publicar un módulo a medio hacer.

// CASO A — ausente o vacía → deshabilitada.
assert.equal(flagHabilitada(undefined), false);
assert.equal(flagHabilitada(null), false);
assert.equal(flagHabilitada(""), false);

// CASO B — valores "parecidos a true" que NO deben habilitar.
for (const v of ["TRUE", "True", " true", "true ", "1", "yes", "si", "on", "enabled"]) {
  assert.equal(flagHabilitada(v), false, `"${v}" no debe habilitar la flag`);
}

// CASO C — valores explícitamente falsos.
for (const v of ["false", "0", "off", "no"]) {
  assert.equal(flagHabilitada(v), false, `"${v}" no debe habilitar la flag`);
}

// CASO D — el único valor que habilita.
assert.equal(flagHabilitada("true"), true);

// CASO E — mensualidadesHabilitadas() lee MENSUALIDADES_ENABLED del entorno.
const original = process.env.MENSUALIDADES_ENABLED;
try {
  delete process.env.MENSUALIDADES_ENABLED;
  assert.equal(mensualidadesHabilitadas(), false, "sin variable → deshabilitada");

  process.env.MENSUALIDADES_ENABLED = "false";
  assert.equal(mensualidadesHabilitadas(), false, '"false" → deshabilitada');

  process.env.MENSUALIDADES_ENABLED = "TRUE";
  assert.equal(mensualidadesHabilitadas(), false, '"TRUE" → deshabilitada');

  process.env.MENSUALIDADES_ENABLED = "true";
  assert.equal(mensualidadesHabilitadas(), true, '"true" → habilitada');
} finally {
  if (original === undefined) delete process.env.MENSUALIDADES_ENABLED;
  else process.env.MENSUALIDADES_ENABLED = original;
}

// CASO F — la flag NO puede exponerse al cliente: nunca debe existir una variable
// pública equivalente (eso la volvería falsificable desde el navegador).
assert.equal(
  process.env.NEXT_PUBLIC_MENSUALIDADES_ENABLED,
  undefined,
  "la flag de mensualidades no debe tener versión NEXT_PUBLIC_*"
);

console.log("featureFlags.test.ts OK");
