import { strict as assert } from "node:assert";
import {
  MAX_TRASLADO_MINUTOS, UNIDAD_MINUTOS, DURACIONES_MENSUALIDAD, CODIGO_RE,
  minutosDeReserva, duracionValida, cantidadSimuladoresValida,
  normalizarTelefono, normalizarTelefonoDetallado, telefonoNormalizadoValido,
  normalizarCodigo, estadoMensualidad, simularCompra, AREAS_3_DIGITOS,
} from "@/lib/mensualidades";
import {
  CASOS_TELEFONO, AREA_OFICIAL_2, AREAS_OFICIALES_3, AREAS_OFICIALES_4_MUESTRA,
  formatosEquivalentes, localDe,
} from "@/lib/mensualidadesTelefono.fixtures";

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

// ── Normalización argentina de teléfonos (M2.1) ────────────────────────────
// La misma tabla se corre contra la función SQL en mensualidades.integration.ts,
// así que estos casos son también el contrato de paridad SQL/TypeScript.
for (const [entrada, esperado, nota] of CASOS_TELEFONO) {
  assert.equal(normalizarTelefono(entrada), esperado, `teléfono ${nota}: "${entrada}"`);
  // Idempotencia: normalizar(normalizar(x)) === normalizar(x).
  assert.equal(
    normalizarTelefono(normalizarTelefono(entrada)), esperado,
    `teléfono no idempotente (${nota}): "${entrada}"`
  );
}

// ── M2.2 · Cada indicativo oficial en sus tres formatos ────────────────────
// La lista que usa el código tiene que ser EXACTAMENTE la de ENACOM.
assert.deepEqual(
  [...AREAS_3_DIGITOS].sort(), [...AREAS_OFICIALES_3].sort(),
  "AREAS_3_DIGITOS difiere del snapshot oficial de ENACOM"
);
assert.equal(AREAS_OFICIALES_3.length, 38, "ENACOM lista 38 indicativos de 3 dígitos");

let combinaciones = 0;
for (const area of [AREA_OFICIAL_2, ...AREAS_OFICIALES_3, ...AREAS_OFICIALES_4_MUESTRA]) {
  const local = localDe(area);
  const canonico = `${area}${local}`;
  assert.equal(canonico.length, 10, `área ${area}: el canónico debe tener 10 dígitos`);
  for (const formato of formatosEquivalentes(area, local)) {
    assert.equal(normalizarTelefono(formato), canonico, `área ${area}, formato "${formato}"`);
    combinaciones++;
  }
}
assert.equal(combinaciones, (1 + 38 + 5) * 3, "faltaron combinaciones de indicativos");

// Un valor ya canónico no se toca.
assert.equal(normalizarTelefono("3515123456"), "3515123456");
assert.equal(normalizarTelefono("1112345678"), "1112345678");
assert.equal(normalizarTelefono(null), null);

// Motivos de rechazo explícitos (error controlado, no un valor inventado).
assert.equal(normalizarTelefonoDetallado("351ABC3456").ok, false);
assert.equal((normalizarTelefonoDetallado("351ABC3456") as { motivo: string }).motivo, "simbolos_invalidos");
assert.equal((normalizarTelefonoDetallado("+1 555 123 4567") as { motivo: string }).motivo, "prefijo_extranjero");
assert.equal((normalizarTelefonoDetallado("35112") as { motivo: string }).motivo, "largo_invalido");
assert.equal((normalizarTelefonoDetallado("341512345615") as { motivo: string }).motivo, "sin_15_en_el_borde");
assert.equal((normalizarTelefonoDetallado("1512345678") as { motivo: string }).motivo, "area_invalida");
assert.equal(normalizarTelefonoDetallado("0351 15-5123456").ok, true);

// El canónico son EXACTAMENTE 10 dígitos.
assert.ok(telefonoNormalizadoValido("3515123456"));
assert.ok(!telefonoNormalizadoValido("351512"), "menos de 10 dígitos es inválido");
assert.ok(!telefonoNormalizadoValido("35151234567"), "más de 10 dígitos es inválido");
assert.ok(!telefonoNormalizadoValido("35151234a6"));
assert.ok(!telefonoNormalizadoValido(null));

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
