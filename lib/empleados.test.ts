import { strict as assert } from "node:assert";
import { normalizarAlias, validarEmpleadoInput } from "@/lib/empleados";

// Ejecutar: npx tsx lib/empleados.test.ts
// Pruebas puras (sin DB): normalización de alias + validación server-side.

// ── normalizarAlias: minúsculas, trim, colapsa espacios, sin diacríticos ──────
assert.equal(normalizarAlias("Ramiro"), "ramiro", "minúsculas");
assert.equal(normalizarAlias("  Fran  "), "fran", "trim");
assert.equal(normalizarAlias("FEDE"), "fede", "mayúsculas");
assert.equal(normalizarAlias("José"), "jose", "diacríticos (é)");
assert.equal(normalizarAlias("Martín"), "martin", "diacríticos (í)");
assert.equal(normalizarAlias("José   María"), "jose maria", "colapsa espacios internos + diacríticos");
assert.equal(normalizarAlias("  MÁXI  MO "), "maxi mo", "todo junto");
assert.equal(normalizarAlias(null), "", "null → vacío");
assert.equal(normalizarAlias(undefined), "", "undefined → vacío");
// Mismo alias con distinto casing/acentos/espacios → misma forma normal (base del UNIQUE).
assert.equal(normalizarAlias("rámiro") === normalizarAlias("Ramiro"), true, "colisión esperada");

// ── validarEmpleadoInput ──────────────────────────────────────────────────────
// Nombre vacío → error.
assert.equal(validarEmpleadoInput({ nombre: "   ", aliases: ["x"] }).ok, false, "nombre vacío");
assert.equal(validarEmpleadoInput({ aliases: ["x"] }).ok, false, "sin nombre");
// Nombre demasiado largo → error.
assert.equal(validarEmpleadoInput({ nombre: "a".repeat(81), aliases: ["x"] }).ok, false, "nombre >80");

// Dedup por alias normalizado dentro del payload.
const dedup = validarEmpleadoInput({ nombre: "Francisco", aliases: ["Fran", "fran", "  FRAN  ", "Francisco"] });
assert.equal(dedup.ok, true, "payload válido");
if (dedup.ok) {
  assert.deepEqual(
    dedup.aliases.map((a) => a.alias_normalizado).sort(),
    ["fran", "francisco"],
    "deduplica a fran + francisco",
  );
}

// Alias por defecto = nombre cuando no se cargan alias.
const soloNombre = validarEmpleadoInput({ nombre: "Martín", aliases: [] });
assert.equal(soloNombre.ok, true, "solo nombre es válido");
if (soloNombre.ok) {
  assert.equal(soloNombre.aliases.length, 1, "un alias por defecto");
  assert.equal(soloNombre.aliases[0].alias_normalizado, "martin", "alias por defecto = nombre normalizado");
}

// No acepta campos internos: activo/es_fallback/id se ignoran (anti mass-assignment).
const conBasura = validarEmpleadoInput({
  nombre: "Test",
  aliases: ["Test"],
  activo: false,
  es_fallback: true,
  id: "hackeado",
});
assert.equal(conBasura.ok, true);
if (conBasura.ok) {
  // El resultado solo expone nombre + aliases; no hay forma de setear es_fallback/activo.
  assert.deepEqual(Object.keys(conBasura).sort(), ["aliases", "nombre", "ok"]);
}

// Alias demasiado largo → error.
assert.equal(validarEmpleadoInput({ nombre: "Ok", aliases: ["a".repeat(61)] }).ok, false, "alias >60");

console.log("OK — empleados (puro): normalización (min/trim/espacios/diacríticos) + validación (nombre, dedup, default, anti mass-assignment, longitudes).");
