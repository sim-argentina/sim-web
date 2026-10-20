import { strict as assert } from "node:assert";

// Cupones de usos limitados · las decisiones puras de lib/cuponesRetencion.ts:
// qué hacer con un reintento, la huella del pedido, la clave del intento y los
// campos que hacen vencer la preferencia. Sin base ni red.
// Ejecutar: npx tsx lib/cuponesRetencion.test.ts

// El módulo crea el cliente de la base al cargarse: uno ficticio, sin red.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://base-ficticia.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-ficticia";
globalThis.fetch = (() => {
  throw new Error("red prohibida en las pruebas puras de cupones");
}) as typeof fetch;

async function main() {
  const { GRACIA_INTENTO_MS, VENTANA_PAGO_CUPON_MIN, fechaMp, huellaIntento, intentoDe, pasoReintento, vencimientoPreferencia } =
    await import("@/lib/cuponesRetencion");
  type R = Parameters<typeof pasoReintento>[0];

  const AHORA = new Date("2026-10-20T18:00:00.000Z");
  const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();
  const ret = (extra: Partial<R> = {}): R => ({
    id: "r", intento: "i", codigo: "C", producto: "reserva", estado: "retenido", reserva_id: null, grupo_compra_id: null,
    external_reference: null, con_pago: false, preferencia_id: null, init_point: null, total_original: null, descuento: null,
    total_final: null, pago_id: null, nota: null, retenido_en: hace(GRACIA_INTENTO_MS * 3), vence_en: hace(0), ...extra,
  });
  const paso = (r: R, compra: Parameters<typeof pasoReintento>[1], conPago = true) => {
    const p = pasoReintento(r, compra, AHORA, conPago);
    return p.paso === "rechazar" ? `rechazar:${p.fallo.codigo}` : p.paso;
  };

  // ── 1. Reintento con pago ─────────────────────────────────────────────────
  const conLink = ret({ con_pago: true, preferencia_id: "p1", init_point: "https://mp.invalid/1", reserva_id: 7 });
  assert.equal(paso(conLink, "en_preparacion"), "devolver", "mismo intento con link: el MISMO link");
  assert.equal(paso({ ...conLink, retenido_en: hace(1000) }, "en_preparacion"), "devolver", "aunque sea enseguida");
  assert.deepEqual(pasoReintento(conLink, "en_preparacion", AHORA, true), { paso: "devolver", preferencia_id: "p1", init_point: "https://mp.invalid/1" });
  assert.equal(paso(conLink, "fallida"), "rehacer_preferencia", "el intento anterior terminó en error: otra preferencia de la MISMA compra");
  assert.equal(paso(ret({ reserva_id: 7, retenido_en: hace(1000) }), "en_preparacion"), "rechazar:intento_en_curso", "doble clic: el otro espera");
  assert.equal(paso(ret({ retenido_en: hace(1000) }), "sin_compra"), "rechazar:intento_en_curso");
  assert.equal(paso(ret({ reserva_id: 7 }), "en_preparacion"), "rehacer_preferencia", "se cortó a mitad de camino y ya pasó la gracia");
  assert.equal(paso(ret(), "sin_compra"), "crear_compra");
  assert.equal(paso(ret({ estado: "consumido" }), "completada"), "rechazar:compra_ya_pagada");
  assert.equal(paso(ret(), "completada"), "rechazar:compra_ya_pagada");
  assert.equal(paso(ret({ estado: "liberado" }), "en_preparacion"), "rechazar:intento_vencido", "liberada: el intento terminó");
  assert.equal(paso({ ...conLink, estado: "liberado" }, "en_preparacion"), "rechazar:intento_vencido", "aunque tenga link: venció");

  // ── 2. Reintento sin pago (bonificada) ────────────────────────────────────
  assert.equal(paso(ret({ estado: "consumido" }), "completada", false), "completada", "devuelve la compra hecha");
  assert.equal(paso(ret(), "completada", false), "completada", "hecha pero sin consumir: se completa");
  assert.equal(paso(ret({ retenido_en: hace(1000) }), "sin_compra", false), "rechazar:intento_en_curso");
  assert.equal(paso(ret(), "sin_compra", false), "crear_compra");
  assert.equal(paso(ret({ grupo_compra_id: "g" }), "fallida", false), "rechazar:intento_vencido");

  // ── 3. Huella e intento ───────────────────────────────────────────────────
  assert.equal(huellaIntento({ a: 1, b: [2, 3], c: { y: 1, x: 2 } }), huellaIntento({ c: { x: 2, y: 1 }, b: [2, 3], a: 1 }), "no depende del orden de las claves");
  assert.notEqual(huellaIntento({ simuladores: ["A", "B"] }), huellaIntento({ simuladores: ["B", "A"] }), "el orden de una lista sí cuenta (la ruta la ordena antes)");
  assert.notEqual(huellaIntento({ total: 17000 }), huellaIntento({ total: 17001 }));
  assert.match(huellaIntento({}), /^[0-9a-f]{64}$/);
  const u = "6f1e8b2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
  assert.equal(intentoDe({ intento_id: u.toUpperCase() }), u, "la clave del navegador, normalizada");
  for (const malo of [undefined, null, "", "abc", 12, `${u}x`, "../../etc"]) {
    const v = intentoDe({ intento_id: malo });
    assert.match(v, /^[0-9a-f-]{36}$/, "una nueva si no sirve");
    assert.notEqual(v, intentoDe({ intento_id: malo }), "y distinta cada vez (sin reintento posible)");
  }

  // ── 4. Vencimiento de la preferencia (Checkout Pro: expires + expiration_date_*) ─
  const v = vencimientoPreferencia(AHORA);
  assert.equal(v.campos.expires, true);
  assert.equal(v.expira.getTime() - AHORA.getTime(), VENTANA_PAGO_CUPON_MIN * 60_000);
  assert.equal(v.campos.expiration_date_to, "2026-10-20T15:30:00.000-03:00", "ISO con el huso de Argentina");
  assert.equal(v.campos.expiration_date_from, "2026-10-20T14:59:00.000-03:00", "un minuto antes, por relojes desfasados");
  assert.equal(Date.parse(v.campos.expiration_date_to), v.expira.getTime(), "es el mismo instante");
  assert.equal(fechaMp(new Date("2026-01-01T02:00:00.000Z")), "2025-12-31T23:00:00.000-03:00", "cruza el día bien");

  console.log("cuponesRetencion: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
