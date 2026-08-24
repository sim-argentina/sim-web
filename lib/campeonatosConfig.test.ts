import { strict as assert } from "node:assert";
import {
  normalizarModalidad,
  esEliminacion,
  permitePagoStand,
  usaRondaPreliminar,
  normalizarCupoMaximo,
  hayCupo,
  metodosPagoPublicos,
  metodoPagoPermitido,
  requiereEscuderia,
  usaCategoriasLiga,
  normalizarCampeonatoConfig,
  MODALIDAD_DEFAULT,
} from "./campeonatosConfig";

// El proyecto no tiene runner de tests; se ejecuta con:
//   npx tsx lib/campeonatosConfig.test.ts

// ── Modalidad ────────────────────────────────────────────────────────────────
assert.equal(normalizarModalidad("eliminacion"), "eliminacion");
assert.equal(normalizarModalidad("liga"), "liga");
assert.equal(normalizarModalidad(null), MODALIDAD_DEFAULT); // histórico sin columna → liga
assert.equal(normalizarModalidad("otra_cosa"), "liga"); // desconocido → liga (no rompe)
assert.equal(esEliminacion("eliminacion"), true);
assert.equal(esEliminacion("liga"), false);
assert.equal(esEliminacion(undefined), false);

// ── Pago en stand: default true (compatibilidad histórica) ───────────────────
assert.equal(permitePagoStand({}), true); // histórico sin columna
assert.equal(permitePagoStand({ permite_pago_stand: null }), true);
assert.equal(permitePagoStand({ permite_pago_stand: true }), true);
assert.equal(permitePagoStand({ permite_pago_stand: false }), false); // solo explícito

// ── Ronda preliminar: default false ──────────────────────────────────────────
assert.equal(usaRondaPreliminar({}), false);
assert.equal(usaRondaPreliminar({ usa_ronda_preliminar: false }), false);
assert.equal(usaRondaPreliminar({ usa_ronda_preliminar: true }), true);

// ── Cupo máximo: 0/neg/NaN = ilimitado ───────────────────────────────────────
assert.equal(normalizarCupoMaximo(32), 32);
assert.equal(normalizarCupoMaximo("64"), 64);
assert.equal(normalizarCupoMaximo(0), 0);
assert.equal(normalizarCupoMaximo(-5), 0);
assert.equal(normalizarCupoMaximo(null), 0);
assert.equal(normalizarCupoMaximo("no"), 0);

// ── Cupo: no hay límite global de 32 ─────────────────────────────────────────
// Duelo: cupo 32 → 1..32 permitido, 33 rechazado.
assert.equal(hayCupo(32, 31), true); // inscripción 32
assert.equal(hayCupo(32, 32), false); // inscripción 33 → rechazada
// Otro campeonato con 64 cupos: 64 sí entra.
assert.equal(hayCupo(64, 63), true);
assert.equal(hayCupo(64, 64), false);
// Campeonato con 20 cupos.
assert.equal(hayCupo(20, 19), true);
assert.equal(hayCupo(20, 20), false);
// Ilimitado (0): nunca se llena.
assert.equal(hayCupo(0, 9999), true);
assert.equal(hayCupo(null, 100000), true);

// ── Métodos de pago públicos ─────────────────────────────────────────────────
assert.deepEqual(metodosPagoPublicos({ permite_pago_stand: true }), ["mercadopago", "stand"]);
assert.deepEqual(metodosPagoPublicos({ permite_pago_stand: false }), ["mercadopago"]);
assert.deepEqual(metodosPagoPublicos({}), ["mercadopago", "stand"]); // histórico

// ── Gate server-side de pago en stand ────────────────────────────────────────
assert.equal(metodoPagoPermitido({ permite_pago_stand: false }, "stand"), false); // bypass rechazado
assert.equal(metodoPagoPermitido({ permite_pago_stand: false }, "mercadopago"), true);
assert.equal(metodoPagoPermitido({ permite_pago_stand: true }, "stand"), true);
assert.equal(metodoPagoPermitido({ permite_pago_stand: true }, "mercadopago"), true);

// ── Escudería / categorías según modalidad ───────────────────────────────────
assert.equal(requiereEscuderia({ modalidad: "liga" }), true);
assert.equal(requiereEscuderia({ modalidad: "eliminacion" }), false);
assert.equal(requiereEscuderia({ modalidad: "eliminacion", config: { requiere_escuderia: true } }), true); // override
assert.equal(usaCategoriasLiga({ modalidad: "liga" }), true);
assert.equal(usaCategoriasLiga({ modalidad: "eliminacion" }), false);

// ── Fixtures de configurabilidad (secciones 31-34): NO hardcodeamos Duelo ─────
// Campeonato A: eliminación, 32 cupos, sin pago stand, sin preliminar.
const A = normalizarCampeonatoConfig({
  modalidad: "eliminacion",
  cupos_maximos: 32,
  permite_pago_stand: false,
  usa_ronda_preliminar: false,
});
assert.equal(A.modalidad, "eliminacion");
assert.equal(A.cupos_maximos, 32);
assert.equal(A.permite_pago_stand, false);
assert.equal(A.usa_ronda_preliminar, false);
assert.deepEqual(metodosPagoPublicos(A), ["mercadopago"]); // solo MP
assert.equal(metodoPagoPermitido(A, "stand"), false); // request manual rechazado
assert.equal(hayCupo(A.cupos_maximos, 32), false); // 33 rechazada
assert.equal(requiereEscuderia(A), false); // escudería no requerida

// Campeonato B: liga, 64 cupos, con pago stand, con preliminar (arquitectura
// admite la configuración, no está bloqueada globalmente).
const B = normalizarCampeonatoConfig({
  modalidad: "liga",
  cupos_maximos: 64,
  permite_pago_stand: true,
  usa_ronda_preliminar: true,
});
assert.equal(B.modalidad, "liga");
assert.equal(B.cupos_maximos, 64);
assert.equal(B.permite_pago_stand, true);
assert.equal(B.usa_ronda_preliminar, true);
assert.deepEqual(metodosPagoPublicos(B), ["mercadopago", "stand"]);
assert.equal(hayCupo(B.cupos_maximos, 63), true);
assert.equal(requiereEscuderia(B), true);

// Campeonato histórico (sin columnas nuevas): liga, ilimitado, pago stand, sin preliminar.
const H = normalizarCampeonatoConfig({ cupos_maximos: 0 });
assert.equal(H.modalidad, "liga");
assert.equal(H.permite_pago_stand, true);
assert.equal(H.usa_ronda_preliminar, false);
assert.equal(H.cupos_maximos, 0);
assert.deepEqual(metodosPagoPublicos(H), ["mercadopago", "stand"]); // no se rompe el flujo histórico

console.log(
  "OK — config por campeonato: modalidad, cupo (sin límite global), pago en stand, " +
    "ronda preliminar, escudería/categorías y fixtures A/B/histórico.",
);
