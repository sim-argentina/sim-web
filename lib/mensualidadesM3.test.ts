import { strict as assert } from "node:assert";
import { calcularMontos, idDePagoDeNotificacion, PREFIJO_EXT_REF } from "@/lib/mensualidadesPago";
import { validarDatosCompra, nuevoTokenPublico, nuevaExternalReference } from "@/lib/mensualidadesCompra";
import { CONDICIONES_VERSION, CONDICIONES_MENSUALIDAD } from "@/lib/mensualidadesCondiciones";

// Ejecutar: npx tsx lib/mensualidadesM3.test.ts
// Reglas PURAS de la compra pública (M3). Lo que toca base y Mercado Pago está en
// lib/mensualidadesM3.integration.ts.

// ── Bruto / comisión / neto ────────────────────────────────────────────────
// Un solo cargo, con el neto informado por Mercado Pago.
assert.deepEqual(
  calcularMontos({
    transaction_amount: 30000,
    fee_details: [{ type: "mercadopago_fee", amount: 2049, fee_payer: "collector" }],
    transaction_details: { net_received_amount: 27951 },
  }),
  { bruto: 30000, comision: 2049, neto: 27951 }
);
// Varios cargos: se suman, no se toma solo el primero.
assert.deepEqual(
  calcularMontos({
    transaction_amount: 100000,
    fee_details: [
      { type: "mercadopago_fee", amount: 6100, fee_payer: "collector" },
      { type: "financing_fee", amount: 1500, fee_payer: "collector" },
      { type: "application_fee", amount: 400, fee_payer: "collector" },
    ],
    transaction_details: { net_received_amount: 92000 },
  }),
  { bruto: 100000, comision: 8000, neto: 92000 }
);
// Los cargos que paga el comprador no son comisión nuestra.
assert.deepEqual(
  calcularMontos({
    transaction_amount: 55000,
    fee_details: [
      { type: "mercadopago_fee", amount: 3355, fee_payer: "collector" },
      { type: "financing_fee", amount: 9000, fee_payer: "payer" },
    ],
    transaction_details: { net_received_amount: 51645 },
  }),
  { bruto: 55000, comision: 3355, neto: 51645 }
);
// Sin neto informado se deriva de bruto − comisión (nunca un porcentaje fijo).
assert.deepEqual(
  calcularMontos({ transaction_amount: 30000, fee_details: [{ amount: 2049 }] }),
  { bruto: 30000, comision: 2049, neto: 27951 }
);
// Sin cargos todavía (pago pendiente): comisión 0 y neto = bruto.
assert.deepEqual(
  calcularMontos({ transaction_amount: 30000, fee_details: [] }),
  { bruto: 30000, comision: 0, neto: 30000 }
);
// Coherencia bruto − comisión = neto en los casos derivados.
for (const [bruto, com] of [[30000, 2049], [55000, 3355], [100000, 6100]]) {
  const m = calcularMontos({ transaction_amount: bruto, fee_details: [{ amount: com }] });
  assert.equal(Math.round((m.bruto - m.comision) * 100) / 100, m.neto);
}

// ── Id de pago desde la notificación ───────────────────────────────────────
const reqPlano = new Request("https://x.test/api/mensualidades/webhook");
assert.equal(idDePagoDeNotificacion(reqPlano, { data: { id: "123" } }), "123");
assert.equal(idDePagoDeNotificacion(reqPlano, { id: 456 }), "456");
assert.equal(
  idDePagoDeNotificacion(new Request("https://x.test/wh?data.id=789"), null), "789"
);
assert.equal(idDePagoDeNotificacion(new Request("https://x.test/wh?id=321"), null), "321");
assert.equal(idDePagoDeNotificacion(reqPlano, null), null);

// ── Tokens y external_reference ────────────────────────────────────────────
const tokens = new Set<string>();
for (let i = 0; i < 500; i++) {
  const t = nuevoTokenPublico();
  assert.match(t, /^[A-Za-z0-9_-]{24,64}$/, `token con formato inesperado: ${t}`);
  assert.ok(t.length >= 32, "el token debe tener entropía suficiente");
  tokens.add(t);
}
assert.equal(tokens.size, 500, "los tokens no pueden repetirse");

const refs = new Set<string>();
for (let i = 0; i < 200; i++) {
  const r = nuevaExternalReference();
  assert.ok(r.startsWith(PREFIJO_EXT_REF), "la referencia debe llevar el prefijo del producto");
  // Sin PII: nada de teléfono ni email en la referencia.
  assert.match(r.slice(PREFIJO_EXT_REF.length), /^[A-Za-z0-9_-]{20,}$/);
  refs.add(r);
}
assert.equal(refs.size, 200, "las referencias no pueden repetirse");

// ── Validación del formulario ──────────────────────────────────────────────
const base = {
  nombre: "Ana", apellido: "Pérez", telefono: "0351 15-5123456",
  email: "Ana@Correo.com", plan_slug: "2h", acepto_condiciones: true,
};

const ok = validarDatosCompra(base);
assert.ok(ok.ok, "los datos base deberían ser válidos");
if (ok.ok) {
  assert.equal(ok.data.telefonoNorm, "3515123456", "el teléfono se guarda canónico");
  assert.equal(ok.data.email, "ana@correo.com", "el email se normaliza a minúsculas");
  assert.ok(ok.data.idempotencyKey.length > 0, "siempre hay idempotency key");
}

// Formatos equivalentes del mismo teléfono → misma forma canónica.
for (const tel of ["3515123456", "0351 15-5123456", "+54 9 351 512-3456", "0351 5123456"]) {
  const r = validarDatosCompra({ ...base, telefono: tel });
  assert.ok(r.ok, `debería aceptar "${tel}"`);
  if (r.ok) assert.equal(r.data.telefonoNorm, "3515123456", `"${tel}" no normalizó igual`);
}

// Rechazos, con el campo señalado.
const casosInvalidos: Array<[Record<string, unknown>, string]> = [
  [{ ...base, nombre: "" }, "nombre"],
  [{ ...base, nombre: "x".repeat(61) }, "nombre"],
  [{ ...base, nombre: `Ana${String.fromCharCode(7)}` }, "nombre"],
  [{ ...base, apellido: "" }, "apellido"],
  [{ ...base, telefono: "1234" }, "telefono"],
  [{ ...base, telefono: "+1 555 123 4567" }, "telefono"],
  [{ ...base, telefono: "abc" }, "telefono"],
  [{ ...base, email: "sin-arroba" }, "email"],
  [{ ...base, email: "a@b" }, "email"],
  [{ ...base, email: "" }, "email"],
  [{ ...base, plan_slug: "" }, "plan_slug"],
  [{ ...base, plan_slug: "PLAN CON ESPACIOS" }, "plan_slug"],
  [{ ...base, acepto_condiciones: false }, "acepto_condiciones"],
  [{ ...base, acepto_condiciones: "true" }, "acepto_condiciones"],
  [{ ...base, acepto_condiciones: undefined }, "acepto_condiciones"],
];
for (const [body, campo] of casosInvalidos) {
  const r = validarDatosCompra(body);
  assert.equal(r.ok, false, `debería rechazar ${campo}: ${JSON.stringify(body[campo])}`);
  if (!r.ok) assert.equal(r.campo, campo, `campo señalado incorrecto para ${campo}`);
}

// Precio, minutos y vigencia enviados por el cliente se IGNORAN por completo.
const conBasura = validarDatosCompra({
  ...base, precio: 1, plan_precio: 1, minutos: 99999, plan_minutos: 99999,
  vigencia_dias: 3650, saldo_minutos: 99999, comision_mp: 0, importe_neto: 999999,
});
assert.ok(conBasura.ok, "los campos monetarios extra no deben romper la validación");
if (conBasura.ok) {
  assert.deepEqual(
    Object.keys(conBasura.data).sort(),
    ["apellido", "email", "idempotencyKey", "nombre", "planSlug", "telefono", "telefonoNorm"],
    "la validación solo debe devolver datos del comprador y el slug"
  );
}

// La idempotency key del cliente se respeta si tiene forma segura; si no, se genera.
const conKey = validarDatosCompra({ ...base, idempotency_key: "abc-123_XYZ" });
assert.ok(conKey.ok && conKey.data.idempotencyKey === "abc-123_XYZ");
const keyRara = validarDatosCompra({ ...base, idempotency_key: "con espacios y $" });
assert.ok(keyRara.ok && keyRara.data.idempotencyKey !== "con espacios y $");

// ── Condiciones ────────────────────────────────────────────────────────────
assert.ok(CONDICIONES_VERSION.length > 0, "las condiciones tienen versión");
assert.ok(CONDICIONES_MENSUALIDAD.length >= 12, "faltan condiciones obligatorias");
const textoCondiciones = CONDICIONES_MENSUALIDAD.join(" ").toLowerCase();
for (const obligatoria of [
  "30 días", "23:59", "renovación automática", "reserv", "disponibilidad",
  "15, 30, 45 o 60", "1 a 4 simuladores", "60 minutos", "no se recupera",
  "1,35", "110 kg", "descuento",
]) {
  assert.ok(textoCondiciones.includes(obligatoria.toLowerCase()), `falta la condición: ${obligatoria}`);
}

console.log("mensualidadesM3.test.ts OK");
