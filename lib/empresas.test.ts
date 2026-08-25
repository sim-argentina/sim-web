import { strict as assert } from "node:assert";
import {
  vigenciaDias,
  sumarDias,
  calcularVencimiento,
  inicioValido,
  ivaDesglose,
  estadoEfectivo,
  puedeCanjear,
  estadoCodigoEfectivo,
  metricasCampania,
  formatearCodigo,
} from "./empresas";

// npx tsx lib/empresas.test.ts

// ── Vigencia 60 / 30 ─────────────────────────────────────────────────────────
assert.equal(vigenciaDias("unica"), 60);
assert.equal(vigenciaDias("mensual"), 30);
assert.equal(vigenciaDias("otra"), 60); // default compra única
// inicio 01/10 + 60 → 30/11 ; + 30 → 31/10
assert.equal(calcularVencimiento("2026-10-01", "unica"), "2026-11-30");
assert.equal(calcularVencimiento("2026-10-01", "mensual"), "2026-10-31");
assert.equal(sumarDias("2026-12-20", 15), "2027-01-04"); // cruza año
assert.equal(calcularVencimiento(null, "unica"), null);

// ── Fecha de inicio programable hasta 30 días post-pago ──────────────────────
assert.equal(inicioValido("2026-10-01", "2026-10-01"), true); // inmediato
assert.equal(inicioValido("2026-10-01", "2026-10-16"), true); // +15 días
assert.equal(inicioValido("2026-10-01", "2026-10-31"), true); // +30 (límite)
assert.equal(inicioValido("2026-10-01", "2026-11-05"), false); // +35 → inválido
assert.equal(inicioValido("2026-10-01", "2026-09-30"), false); // antes del pago

// ── IVA neto/iva/total ───────────────────────────────────────────────────────
assert.deepEqual(ivaDesglose(100000, 21), { neto: 100000, iva: 21000, total: 121000 });
assert.deepEqual(ivaDesglose(0, 21), { neto: 0, iva: 0, total: 0 });

// ── Estados efectivos ────────────────────────────────────────────────────────
const HOY = "2026-10-15";
assert.equal(estadoEfectivo({ estado: "borrador" }, HOY), "borrador");
assert.equal(estadoEfectivo({ estado: "activa", estado_pago: "pendiente" }, HOY), "pendiente_pago");
// pagada, inicio futuro → programada
assert.equal(estadoEfectivo({ estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-11-01", fecha_vencimiento: "2026-12-31" }, HOY), "programada");
// pagada, iniciada, vigente → activa
assert.equal(estadoEfectivo({ estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-10-01", fecha_vencimiento: "2026-11-30" }, HOY), "activa");
// vencida
assert.equal(estadoEfectivo({ estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-08-01", fecha_vencimiento: "2026-10-01" }, HOY), "vencida");
// cancelada / borrada
assert.equal(estadoEfectivo({ estado: "cancelada", estado_pago: "pagado" }, HOY), "cancelada");
assert.equal(estadoEfectivo({ estado: "activa", estado_pago: "pagado", deleted_at: "x", fecha_inicio: "2026-10-01", fecha_vencimiento: "2026-11-30" }, HOY), "cancelada");
// finalizada explícita
assert.equal(estadoEfectivo({ estado: "finalizada", estado_pago: "pagado", fecha_inicio: "2026-10-01", fecha_vencimiento: "2026-11-30" }, HOY), "finalizada");

// puedeCanjear solo cuando 'activa'
assert.equal(puedeCanjear({ estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-10-01", fecha_vencimiento: "2026-11-30" }, HOY), true);
assert.equal(puedeCanjear({ estado: "activa", estado_pago: "pendiente", fecha_inicio: "2026-10-01", fecha_vencimiento: "2026-11-30" }, HOY), false);
assert.equal(puedeCanjear({ estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-11-01", fecha_vencimiento: "2026-12-31" }, HOY), false); // programada
assert.equal(puedeCanjear({ estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-08-01", fecha_vencimiento: "2026-10-01" }, HOY), false); // vencida

// ── Estado efectivo de código ────────────────────────────────────────────────
assert.equal(estadoCodigoEfectivo({ estado: "disponible" }, "activa"), "disponible");
assert.equal(estadoCodigoEfectivo({ estado: "disponible" }, "vencida"), "vencido"); // deriva por campaña
assert.equal(estadoCodigoEfectivo({ estado: "utilizado" }, "vencida"), "utilizado"); // usado no se "vence"
assert.equal(estadoCodigoEfectivo({ estado: "cancelado" }, "activa"), "cancelado");

// ── Métricas de campaña ──────────────────────────────────────────────────────
const campania = { estado: "activa", estado_pago: "pagado", fecha_inicio: "2026-10-01", fecha_vencimiento: "2026-11-30", cantidad_contratada: 25, duracion_minutos: 15 };
const codigos = [
  ...Array.from({ length: 20 }, () => ({ estado: "disponible", usos_actuales: 0, usos_maximos: 1 })),
  ...Array.from({ length: 4 }, () => ({ estado: "utilizado", usos_actuales: 1, usos_maximos: 1 })),
  { estado: "cancelado", usos_actuales: 0, usos_maximos: 1 },
];
const m = metricasCampania({ campania, codigos, usos: Array.from({ length: 4 }), hoy: HOY });
assert.equal(m.generados, 25);
assert.equal(m.disponibles, 20);
assert.equal(m.utilizados, 4);
assert.equal(m.cancelados, 1);
assert.equal(m.vencidos, 0);
assert.equal(m.pctUtilizacion, 16); // 4/25 = 16%
assert.equal(m.turnos_contratados, 25);
assert.equal(m.turnos_utilizados, 4);
assert.equal(m.turnos_restantes, 21);
assert.equal(m.minutos_contratados, 375); // 25*15
assert.equal(m.minutos_utilizados, 60); // 4*15
// Campaña vencida: los disponibles pasan a vencidos.
const mVenc = metricasCampania({
  campania: { ...campania, fecha_vencimiento: "2026-10-10" },
  codigos, usos: Array.from({ length: 4 }), hoy: HOY,
});
assert.equal(mVenc.estado, "vencida");
assert.equal(mVenc.vencidos, 20);
assert.equal(mVenc.disponibles, 0);
assert.equal(mVenc.utilizados, 4);

// ── Generación de código: formato, sin ambiguos, determinista por bytes ──────
const cod = formatearCodigo(new Uint8Array([0, 5, 10, 15, 20, 25, 30, 1, 2, 3]));
assert.match(cod, /^EMP-[A-Z2-9]{4}-[A-Z2-9]{6}$/);
assert.ok(!/[01OI]/.test(cod.replace(/^EMP-/, "").replace(/-/g, ""))); // sin 0/1/O/I
// Determinista: mismos bytes → mismo código.
assert.equal(formatearCodigo(new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7, 7, 7])), formatearCodigo(new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7, 7, 7])));

console.log("OK — empresas: vigencia 60/30, inicio programable, IVA, estados efectivos, " +
  "canje solo si activa, estado de código, métricas (contratado/usado/restante/vencido) y generación de código.");
