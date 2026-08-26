import { strict as assert } from "node:assert";
import {
  getInscripcionCampos, campoVisible, campoRequerido, faltantesRequeridos,
  presetInscripcion, estadoPendientePago, PRESET_LIGA, PRESET_ELIMINACION,
} from "@/lib/campeonatosInscripcionConfig";

// Ejecutar: npx tsx lib/campeonatosInscripcionConfig.test.ts

// ── CASO A: Liga sin config custom → comportamiento histórico EXACTO ────────────
{
  const campos = getInscripcionCampos({ modalidad: "liga" });
  assert.deepEqual(campos, PRESET_LIGA, "A: liga sin config = preset liga (todo visible)");
  // Requeridos históricos: nombre/apellido/teléfono/DNI.
  for (const k of ["nombre", "apellido", "telefono", "dni"] as const) assert.ok(campoRequerido(campos, k), `A: ${k} requerido`);
  // El resto visible y opcional (no oculto).
  for (const k of ["instagram", "escuderia", "categoria", "mejor_tiempo", "monto", "hora_toma"] as const) {
    assert.ok(campoVisible(campos, k) && !campoRequerido(campos, k), `A: ${k} visible y opcional`);
  }
  // Validación: con los 4 obligatorios pasa; sin DNI falla.
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1", dni: "123" }), [], "A: completos ok");
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1" }), ["DNI"], "A: falta DNI");
}

// ── Modalidad sin config (default sin fila) → liga por compatibilidad ────────────
assert.deepEqual(getInscripcionCampos(null), PRESET_LIGA, "sin fila → preset liga");
assert.deepEqual(getInscripcionCampos(undefined), PRESET_LIGA, "undefined → preset liga");

// ── Presets por modalidad ───────────────────────────────────────────────────────
assert.deepEqual(presetInscripcion("liga"), PRESET_LIGA);
assert.deepEqual(presetInscripcion("eliminacion"), PRESET_ELIMINACION);
assert.deepEqual(presetInscripcion("cualquier_otra"), PRESET_LIGA, "modalidad desconocida → liga");

// ── CASO B: Eliminatorio personalizado (nombre/apellido/tel required; resto hidden) ─
{
  const camp = { modalidad: "eliminacion", config: { inscripcion: { campos: {
    nombre: "required", apellido: "required", telefono: "required",
    dni: "hidden", categoria: "hidden", escuderia: "hidden",
  } } } };
  const campos = getInscripcionCampos(camp);
  assert.ok(campoRequerido(campos, "telefono"), "B: teléfono requerido");
  for (const k of ["dni", "categoria", "escuderia"] as const) assert.ok(!campoVisible(campos, k), `B: ${k} oculto`);
  // Inscripción válida SIN esos campos.
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1" }), [], "B: válida sin dni/categoría/escudería");
}

// ── CASO C: DNI required → backend/cliente lo exigen ────────────────────────────
{
  const campos = getInscripcionCampos({ modalidad: "eliminacion", config: { inscripcion: { campos: { dni: "required" } } } });
  assert.ok(campoRequerido(campos, "dni"), "C: dni required");
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1" }), ["DNI"], "C: rechaza si falta DNI");
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1", dni: "123" }), [], "C: acepta con DNI");
}

// ── CASO D: DNI optional → acepta con o sin DNI ─────────────────────────────────
{
  const campos = getInscripcionCampos({ modalidad: "eliminacion", config: { inscripcion: { campos: { dni: "optional" } } } });
  assert.ok(campoVisible(campos, "dni") && !campoRequerido(campos, "dni"), "D: dni visible y opcional");
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1" }), [], "D: acepta sin DNI");
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1", dni: "1" }), [], "D: acepta con DNI");
}

// ── CASO E: DNI hidden → no visible y no exigido ────────────────────────────────
{
  const campos = getInscripcionCampos({ modalidad: "liga", config: { inscripcion: { campos: { dni: "hidden" } } } });
  assert.ok(!campoVisible(campos, "dni"), "E: dni oculto (override sobre preset liga)");
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "A", apellido: "B", telefono: "1" }), [], "E: no exige DNI oculto");
  // Sólo dni cambió; el resto del preset liga se preserva.
  assert.ok(campoRequerido(campos, "telefono"), "E: teléfono sigue requerido");
}

// ── Estructural: nombre/apellido SIEMPRE requeridos (no se pueden ocultar) ───────
{
  const campos = getInscripcionCampos({ modalidad: "eliminacion", config: { inscripcion: { campos: { nombre: "hidden", apellido: "optional" } } } });
  assert.equal(campos.nombre, "required", "estructural: nombre no se puede ocultar");
  assert.equal(campos.apellido, "required", "estructural: apellido no se puede degradar");
}

// ── CASO G: Duelo (config real aplicada) → alta simple ──────────────────────────
{
  // Config equivalente a la aplicada a Duelo (config.inscripcion.campos).
  const duelo = { modalidad: "eliminacion", config: { inscripcion: { nota: "no devolución", campos: {
    nombre: "required", apellido: "required", telefono: "required",
    dni: "hidden", instagram: "hidden", escuderia: "hidden", categoria: "hidden", mejor_tiempo: "hidden",
    forma_pago: "optional", monto: "hidden",
    hora_toma: "hidden", hora_estimada_subida: "hidden", hora_subida: "hidden", hora_bajada: "hidden", cantidad_minutos: "hidden",
  } } } };
  const campos = getInscripcionCampos(duelo);
  for (const k of ["nombre", "apellido", "telefono"] as const) assert.ok(campoRequerido(campos, k), `G: ${k} requerido`);
  for (const k of ["dni", "instagram", "escuderia", "categoria", "mejor_tiempo", "monto", "hora_toma", "hora_estimada_subida", "hora_subida", "hora_bajada", "cantidad_minutos"] as const) {
    assert.ok(!campoVisible(campos, k), `G: ${k} oculto en Duelo`);
  }
  assert.ok(campoVisible(campos, "forma_pago"), "G: forma de pago visible (admin conserva herramientas)");

  // CASO H: Duelo sin mejor tiempo → inscripción válida (se carga luego en Bracket).
  assert.deepEqual(faltantesRequeridos(campos, { nombre: "Juan", apellido: "Pérez", telefono: "1130001111" }), [], "H: alta válida sin mejor tiempo");
}

// ── CASO I: permite_pago_stand=false → pendiente NUNCA es "cobro en stand" ───────
assert.equal(estadoPendientePago(true), "pendiente_pago_stand", "I: con pago en stand, pendiente = stand");
assert.equal(estadoPendientePago(false), "pendiente_pago_online", "I: sin pago en stand, pendiente = online (no bypass)");

// ── Overrides inválidos se ignoran (cae al preset) ──────────────────────────────
{
  const campos = getInscripcionCampos({ modalidad: "liga", config: { inscripcion: { campos: { dni: "cualquier_cosa", telefono: 123 } } } });
  assert.equal(campos.dni, PRESET_LIGA.dni, "estado inválido → se ignora (preset)");
  assert.equal(campos.telefono, PRESET_LIGA.telefono, "valor no-string → se ignora (preset)");
}

console.log("OK — config inscripción: A) liga histórica intacta, B) eliminatorio personalizado, " +
  "C) required exige, D) optional acepta, E) hidden no exige, estructurales nombre/apellido, " +
  "G) Duelo alta simple, H) sin mejor tiempo válido, I) sin pago en stand nunca pendiente-stand, " +
  "presets y overrides inválidos.");
