import { strict as assert } from "node:assert";
import {
  descomponerFaltante, calcularDesglose,
  nuevaExternalReferenceReserva, nuevoTokenResultado, hashTokenResultado,
  TOKEN_RESULTADO_RE, RETENCION_MINUTOS, PREFIJO_EXT_REF_RESERVA,
} from "@/lib/mensualidadesReservaMixta";
import { esComplementoDeReserva } from "@/lib/mensualidadesReservaPago";
import { resolverPrecioReserva } from "@/lib/reservasPricing";
import { PRECIO_15, PRECIO_30_SEMANA, PRECIO_30_FINDE } from "@/lib/reservasSlots";

// Test PURO del Bloque M5B. Sin DB, sin red, sin Mercado Pago.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM5B.test.ts

const SEMANA = "2030-06-05"; // miércoles
const FINDE = "2030-06-08";  // sábado

// Regex EXACTA del CHECK mrp_extref_chk de la migración.
const EXTREF_DB_RE = /^mensualidad_reserva_[A-Za-z0-9_-]{8,64}$/;

function main() {
  // ── 1) Los tres ejemplos obligatorios de la fórmula ───────────────────────
  // Requiere 60, saldo 15 → faltan 45 → 1 bloque de 30 + 1 de 15.
  assert.deepEqual(descomponerFaltante(45), { bloques_30: 1, bloques_15: 1 });
  // Requiere 135, saldo 60 → faltan 75 → 2 bloques de 30 + 1 de 15.
  assert.deepEqual(descomponerFaltante(75), { bloques_30: 2, bloques_15: 1 });
  // Requiere 240, saldo 45 → faltan 195 → 6 bloques de 30 + 1 de 15.
  assert.deepEqual(descomponerFaltante(195), { bloques_30: 6, bloques_15: 1 });

  // Y los casos redondos, que no llevan bloque de 15.
  assert.deepEqual(descomponerFaltante(30), { bloques_30: 1, bloques_15: 0 });
  assert.deepEqual(descomponerFaltante(60), { bloques_30: 2, bloques_15: 0 });
  assert.deepEqual(descomponerFaltante(15), { bloques_30: 0, bloques_15: 1 });

  // Nunca más de un bloque de 15: para eso se prioriza el de 30.
  for (let m = 15; m <= 600; m += 15) {
    const d = descomponerFaltante(m);
    assert.ok(d.bloques_15 <= 1, `${m} min no puede dar ${d.bloques_15} bloques de 15`);
    assert.equal(d.bloques_30 * 30 + d.bloques_15 * 15, m, `${m} min tiene que reconstruirse exacto`);
  }

  // ── 2) Saldo 0 y saldo suficiente NO entran al pago mixto ─────────────────
  const base = { duracion: 60, cantidadSimuladores: 1, precio15: 12000, precio30: 18000, origenPrecio: "normal_semana" as const };
  assert.deepEqual(calcularDesglose({ ...base, saldoMinutos: 0 }), { error: "saldo_cero" });
  assert.deepEqual(calcularDesglose({ ...base, saldoMinutos: -15 }), { error: "saldo_cero" });
  assert.deepEqual(calcularDesglose({ ...base, saldoMinutos: 60 }), { error: "saldo_suficiente" },
    "saldo exacto deriva a M5A, no cobra nada");
  assert.deepEqual(calcularDesglose({ ...base, saldoMinutos: 120 }), { error: "saldo_suficiente" });

  // ── 3) Desglose completo con precios de semana ────────────────────────────
  const d1 = calcularDesglose({ ...base, saldoMinutos: 15 });
  assert.ok(!("error" in d1));
  if (!("error" in d1)) {
    assert.equal(d1.minutos_requeridos, 60);
    assert.equal(d1.minutos_saldo, 15);
    assert.equal(d1.minutos_faltantes, 45);
    assert.equal(d1.bloques_30, 1);
    assert.equal(d1.bloques_15, 1);
    assert.equal(d1.importe, 18000 + 12000);
  }

  // 135 requeridos = 45 x 3 escuderías, saldo 60.
  const d2 = calcularDesglose({ ...base, duracion: 45, cantidadSimuladores: 3, saldoMinutos: 60 });
  assert.ok(!("error" in d2));
  if (!("error" in d2)) {
    assert.equal(d2.minutos_requeridos, 135);
    assert.equal(d2.minutos_faltantes, 75);
    assert.equal(d2.importe, 2 * 18000 + 12000);
  }

  // 240 requeridos = 60 x 4 escuderías, saldo 45.
  const d3 = calcularDesglose({ ...base, duracion: 60, cantidadSimuladores: 4, saldoMinutos: 45 });
  assert.ok(!("error" in d3));
  if (!("error" in d3)) {
    assert.equal(d3.minutos_requeridos, 240);
    assert.equal(d3.minutos_faltantes, 195);
    assert.equal(d3.importe, 6 * 18000 + 12000);
  }

  // ── 4) Todas las duraciones y cantidades: el consumo siempre es múltiplo de 15
  for (const duracion of [15, 30, 45, 60]) {
    for (const n of [1, 2, 3, 4]) {
      const req = duracion * n;
      assert.equal(req % 15, 0, `${duracion}x${n} tiene que ser múltiplo de 15`);
      const saldo = 15; // siempre parcial salvo el caso 15x1
      const r = calcularDesglose({ ...base, duracion, cantidadSimuladores: n, saldoMinutos: saldo });
      if (req <= saldo) {
        assert.deepEqual(r, { error: "saldo_suficiente" }, `${duracion}x${n} con saldo ${saldo}`);
      } else {
        assert.ok(!("error" in r));
        if (!("error" in r)) {
          assert.equal(r.minutos_faltantes, req - saldo);
          assert.equal(r.minutos_faltantes % 15, 0);
          assert.equal(r.importe, r.bloques_30 * 18000 + r.bloques_15 * 12000);
          assert.ok(r.importe > 0, "una mixta siempre cobra algo");
        }
      }
    }
  }

  // ── 5) Precios: la fuente es EXACTAMENTE la de Reservas normales ──────────
  // Sin especial: normal de semana y de fin de semana.
  assert.equal(resolverPrecioReserva(null, SEMANA, 15), PRECIO_15);
  assert.equal(resolverPrecioReserva(null, SEMANA, 30), PRECIO_30_SEMANA);
  assert.equal(resolverPrecioReserva(null, FINDE, 30), PRECIO_30_FINDE);

  // El mismo faltante sale más caro un sábado, sin tabla paralela de tarifas.
  const semana = calcularDesglose({
    duracion: 60, cantidadSimuladores: 1, saldoMinutos: 15,
    precio15: PRECIO_15, precio30: PRECIO_30_SEMANA, origenPrecio: "normal_semana",
  });
  const finde = calcularDesglose({
    duracion: 60, cantidadSimuladores: 1, saldoMinutos: 15,
    precio15: PRECIO_15, precio30: PRECIO_30_FINDE, origenPrecio: "normal_finde",
  });
  assert.ok(!("error" in semana) && !("error" in finde));
  if (!("error" in semana) && !("error" in finde)) {
    assert.equal(semana.importe, PRECIO_30_SEMANA + PRECIO_15);
    assert.equal(finde.importe, PRECIO_30_FINDE + PRECIO_15);
    assert.ok(finde.importe > semana.importe);
  }

  // Precio especial completo, y override PARCIAL con fallback al normal.
  assert.equal(resolverPrecioReserva({ precio_15: 9000, precio_30: 14000 }, SEMANA, 15), 9000);
  assert.equal(resolverPrecioReserva({ precio_15: 9000, precio_30: 14000 }, SEMANA, 30), 14000);
  assert.equal(resolverPrecioReserva({ precio_15: 9000, precio_30: null }, SEMANA, 30), PRECIO_30_SEMANA,
    "override parcial: el 30 cae al normal");
  assert.equal(resolverPrecioReserva({ precio_15: null, precio_30: 14000 }, SEMANA, 15), PRECIO_15,
    "override parcial: el 15 cae al normal");
  assert.equal(resolverPrecioReserva({ precio_15: null, precio_30: 14000 }, FINDE, 30), 14000,
    "el especial pisa también el precio de fin de semana");

  // ── 6) El snapshot manda: cambiar la tarifa después no mueve un importe ya
  //      calculado. Se modela recalculando con los MISMOS precios guardados.
  const guardado = { precio15: 12000, precio30: 18000 };
  const antes = calcularDesglose({ ...base, saldoMinutos: 15, ...guardado });
  const tarifaNueva = calcularDesglose({ ...base, saldoMinutos: 15, precio15: 99000, precio30: 99000 });
  assert.ok(!("error" in antes) && !("error" in tarifaNueva));
  if (!("error" in antes) && !("error" in tarifaNueva)) {
    assert.notEqual(antes.importe, tarifaNueva.importe);
    // Recalcular con el snapshot devuelve SIEMPRE lo mismo.
    const recalculado = calcularDesglose({ ...base, saldoMinutos: 15, ...guardado });
    assert.ok(!("error" in recalculado));
    if (!("error" in recalculado)) assert.equal(recalculado.importe, antes.importe);
  }

  // ── 7) Enrutado de prefijos: el complemento NO es una compra ──────────────
  assert.equal(PREFIJO_EXT_REF_RESERVA, "mensualidad_reserva_");
  assert.ok(esComplementoDeReserva("mensualidad_reserva_abc12345"));
  assert.ok(!esComplementoDeReserva("mensualidad_abc12345"), "una compra de plan no es un complemento");
  assert.ok(!esComplementoDeReserva("reserva_123"));
  assert.ok(!esComplementoDeReserva("gift_card_9"));
  assert.ok(!esComplementoDeReserva(""));
  // La trampa: el prefijo de compras es prefijo del de complementos.
  assert.ok("mensualidad_reserva_x".startsWith("mensualidad_"),
    "por esto el webhook tiene que probar el prefijo específico PRIMERO");

  // ── 8) Identificadores ────────────────────────────────────────────────────
  for (let i = 0; i < 50; i++) {
    const ref = nuevaExternalReferenceReserva();
    assert.match(ref, EXTREF_DB_RE, "la external_reference tiene que pasar el CHECK de la base");
    assert.ok(esComplementoDeReserva(ref));
  }
  const tokens = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const t = nuevoTokenResultado();
    assert.match(t, TOKEN_RESULTADO_RE);
    tokens.add(t);
  }
  assert.equal(tokens.size, 50, "los tokens no se repiten");

  // El hash es sha256 hex, estable, y no contiene el token.
  const tok = "Zm9vYmFyLWJhei1xdXV4LTEyMzQ1Njc4";
  const h = hashTokenResultado(tok);
  assert.match(h, /^[a-f0-9]{64}$/, "tiene que pasar el CHECK mrp_token_chk");
  assert.equal(h, hashTokenResultado(tok));
  assert.notEqual(h, hashTokenResultado(tok + "x"));
  assert.ok(!h.includes(tok));

  // ── 9) La retención dura lo mismo que una reserva normal pendiente ────────
  assert.equal(RETENCION_MINUTOS, 15);

  console.log("mensualidadesM5B.test.ts OK (9 grupos)");
}

main();
