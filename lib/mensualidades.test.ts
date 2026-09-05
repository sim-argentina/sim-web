import { strict as assert } from "node:assert";
import {
  MAX_TRASLADO_MINUTOS, UNIDAD_MINUTOS, DURACIONES_MENSUALIDAD, CODIGO_RE,
  minutosDeReserva, duracionValida, cantidadSimuladoresValida,
  normalizarTelefono, telefonoNormalizadoValido, normalizarCodigo,
  estadoMensualidad, simularCompra,
} from "@/lib/mensualidades";

// Ejecutar: npx tsx lib/mensualidades.test.ts
// Reglas PURAS del producto. La contraparte contra la base real (RPC, constraints,
// RLS, concurrencia) está en lib/mensualidades.integration.ts.

// ── Fórmula de consumo: duración × cantidad de simuladores ──────────────────
assert.equal(minutosDeReserva(15, 1), 15);
assert.equal(minutosDeReserva(30, 2), 60);
assert.equal(minutosDeReserva(30, 3), 90);
assert.equal(minutosDeReserva(30, 4), 120);
assert.equal(minutosDeReserva(60, 4), 240, "máximo técnico de una reserva");
// Todo consumo posible es múltiplo de 15.
for (const d of DURACIONES_MENSUALIDAD) {
  for (let s = 1; s <= 4; s++) {
    assert.equal(minutosDeReserva(d, s) % UNIDAD_MINUTOS, 0, `${d}x${s} no es múltiplo de 15`);
  }
}

// ── Duraciones y cantidades permitidas ──────────────────────────────────────
for (const d of [15, 30, 45, 60]) assert.ok(duracionValida(d), `${d} debería ser válida`);
for (const d of [0, 10, 20, 25, 75, 90, -15]) assert.ok(!duracionValida(d), `${d} no debería ser válida`);
for (const n of [1, 2, 3, 4]) assert.ok(cantidadSimuladoresValida(n));
for (const n of [0, 5, -1, 1.5, "abc", null]) assert.ok(!cantidadSimuladoresValida(n), `${n} no debería ser válida`);
// Coerción numérica deliberada (igual que validarReservaInput con duracion_minutos):
// los bodies JSON llegan como string y el validador los acepta.
assert.ok(cantidadSimuladoresValida("2"));
assert.ok(duracionValida("30"));

// ── Teléfono normalizado (mismo resultado que la función SQL) ───────────────
assert.equal(normalizarTelefono("+54 9 351 512-3456"), "3515123456");
assert.equal(normalizarTelefono("5493515123456"), "3515123456");
assert.equal(normalizarTelefono("+5493515123456"), "3515123456");
assert.equal(normalizarTelefono("00 54 9 3515123456"), "3515123456");
assert.equal(normalizarTelefono("3515123456"), "3515123456");
assert.equal(normalizarTelefono("351 512 3456"), "3515123456");
assert.equal(normalizarTelefono(""), "");
assert.equal(normalizarTelefono(null), "");
assert.ok(telefonoNormalizadoValido("3515123456"));
assert.ok(!telefonoNormalizadoValido("351512"), "menos de 8 dígitos es inválido");
assert.ok(!telefonoNormalizadoValido("35151234a6"));

// ── Código: normalización sin ambigüedad ────────────────────────────────────
assert.equal(normalizarCodigo("MEN-ABCD-2345"), "MEN-ABCD-2345");
assert.equal(normalizarCodigo("men abcd 2345"), "MEN-ABCD-2345");
assert.equal(normalizarCodigo("ABCD2345"), "MEN-ABCD-2345", "acepta el código sin prefijo");
assert.equal(normalizarCodigo("  MENABCD2345  "), "MEN-ABCD-2345");
// 0, O, 1 e I están fuera del alfabeto: no se adivina, se rechaza.
assert.equal(normalizarCodigo("MEN-ABC0-2345"), null);
assert.equal(normalizarCodigo("MEN-ABCO-2345"), null);
assert.equal(normalizarCodigo("MEN-ABC1-2345"), null);
assert.equal(normalizarCodigo("MEN-ABCI-2345"), null);
assert.equal(normalizarCodigo("MEN-ABCD-234"), null, "longitud incorrecta");
assert.equal(normalizarCodigo(""), null);
assert.equal(normalizarCodigo(null), null);
assert.ok(CODIGO_RE.test("MEN-ABCD-2345"));
assert.ok(!CODIGO_RE.test("MEN-ABCD-2340"));

// ── Estado derivado (precedencia bloqueada > vencida > agotada > vigente) ───
const hoy = "2026-09-05";
assert.equal(estadoMensualidad({ saldoMinutos: 60, venceEl: "2026-10-05", bloqueada: false, hoy }), "vigente");
assert.equal(estadoMensualidad({ saldoMinutos: 0, venceEl: "2026-10-05", bloqueada: false, hoy }), "agotada");
assert.equal(estadoMensualidad({ saldoMinutos: 60, venceEl: "2026-09-04", bloqueada: false, hoy }), "vencida");
assert.equal(estadoMensualidad({ saldoMinutos: 60, venceEl: "2026-09-05", bloqueada: false, hoy }), "vigente",
  "el último día todavía es utilizable");
assert.equal(estadoMensualidad({ saldoMinutos: 0, venceEl: "2026-09-04", bloqueada: false, hoy }), "vencida",
  "vencida gana sobre agotada");
assert.equal(estadoMensualidad({ saldoMinutos: 0, venceEl: "2026-09-04", bloqueada: true, hoy }), "bloqueada",
  "bloqueada gana sobre todo");

// ── Simulación de compra: los cuatro ejemplos obligatorios del producto ─────
// 1) Saldo activo 40 + plan 120 → 160 (no descarta nada).
assert.deepEqual(
  simularCompra({ saldoActual: 40, venceActual: "2026-09-20", planMinutos: 120, hoy }),
  { tipo: "renovacion", trasladados: 40, descartados: 0, saldoResultante: 160 }
);
// 2) Saldo activo 90 + plan 60 → 120: traslada 60 y descarta 30.
assert.deepEqual(
  simularCompra({ saldoActual: 90, venceActual: "2026-09-20", planMinutos: 60, hoy }),
  { tipo: "renovacion", trasladados: 60, descartados: 30, saldoResultante: 120 }
);
// 3) Saldo 0 pero sin vencer + plan 240 → renueva con 240.
assert.deepEqual(
  simularCompra({ saldoActual: 0, venceActual: "2026-09-20", planMinutos: 240, hoy }),
  { tipo: "renovacion", trasladados: 0, descartados: 0, saldoResultante: 240 }
);
// 4) Vencida con 45 minutos + plan 60 → alta nueva con 60 (no se recupera saldo).
assert.deepEqual(
  simularCompra({ saldoActual: 45, venceActual: "2026-09-04", planMinutos: 60, hoy }),
  { tipo: "alta", trasladados: 0, descartados: 0, saldoResultante: 60 }
);
// Borde: saldo EXACTAMENTE en el tope no descarta nada.
assert.deepEqual(
  simularCompra({ saldoActual: 60, venceActual: "2026-09-20", planMinutos: 60, hoy }),
  { tipo: "renovacion", trasladados: 60, descartados: 0, saldoResultante: 120 }
);
// Borde: renovar el mismo día del vencimiento sigue siendo renovación.
assert.equal(
  simularCompra({ saldoActual: 30, venceActual: hoy, planMinutos: 60, hoy }).tipo,
  "renovacion"
);
// Sin mensualidad previa → alta.
assert.equal(
  simularCompra({ saldoActual: 0, venceActual: null, planMinutos: 60, hoy }).tipo,
  "alta"
);
assert.equal(MAX_TRASLADO_MINUTOS, 60);

console.log("mensualidades.test.ts OK");
