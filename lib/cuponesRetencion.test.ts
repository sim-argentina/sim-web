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

  // ── 5. Turno de preparación: otro pedido del intento está creando el link ─
  const futuro = new Date(AHORA.getTime() + 30_000).toISOString();
  assert.equal(paso(ret({ reserva_id: 7, preparando_hasta: futuro }), "en_preparacion"), "rechazar:intento_en_curso", "aunque ya pasó la gracia");
  assert.equal(paso(ret({ reserva_id: 7, preparando_hasta: futuro }), "fallida"), "rechazar:intento_en_curso", "ni aunque el anterior haya fallado");
  assert.equal(paso(ret({ reserva_id: 7, preparando_hasta: hace(1000) }), "fallida"), "rehacer_preferencia", "turno vencido (el pedido murió): se recupera");
  assert.equal(paso({ ...conLink, preparando_hasta: futuro }, "en_preparacion"), "devolver", "con link guardado, el link");

  // ── 6. Sin la migración: fallar cerrado (función o tabla inexistentes) ────
  const { faltaMigracion } = await import("@/lib/cuponesRetencion");
  for (const code of ["PGRST202", "PGRST205", "42883", "42P01"]) assert.equal(faltaMigracion({ code }), true, code);
  for (const e of [{ code: "23505" }, { code: "PGRST116" }, { message: "x" }, null, undefined]) assert.equal(faltaMigracion(e), false);

  // ── 7. Panel: qué pide revisión ───────────────────────────────────────────
  const { requiereRevision } = await import("@/lib/cuponesRetencionPanel");
  assert.equal(requiereRevision({ estado: "retenido", vence_en: hace(-60_000), nota: null }, AHORA), null, "vigente: no");
  assert.equal(requiereRevision({ estado: "retenido", vence_en: hace(1000), nota: null }, AHORA), "vencida_sin_confirmar");
  assert.equal(requiereRevision({ estado: "retenido", vence_en: hace(1000), nota: "legado" }, AHORA), "legado_sin_confirmar");
  assert.equal(requiereRevision({ estado: "liberado", vence_en: hace(1000), nota: "aprobado_sin_cupo" }, AHORA), "pagada_sin_cupo");
  assert.equal(requiereRevision({ estado: "consumido", vence_en: hace(1000), nota: null }, AHORA), null);

  // ── 8. Clave del intento en el navegador: misma para el mismo pedido, sin datos ─
  const almacen = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).sessionStorage = {
    getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => { almacen.set(k, v); }, removeItem: (k) => { almacen.delete(k); },
  };
  const { intentoParaPedido, olvidarIntento, intentoTerminado } = await import("@/lib/intentoCompra");
  const pedido = { nombre: "Ana Prueba", telefono: "3519990000", fecha: "2026-11-02", simuladores: ["Ferrari"] };
  const i1 = intentoParaPedido("reserva", pedido);
  assert.equal(intentoParaPedido("reserva", { ...pedido }), i1, "recargar con el mismo pedido: la misma clave");
  assert.notEqual(intentoParaPedido("reserva", { ...pedido, simuladores: ["McLaren"] }), i1, "otro pedido: otra clave");
  const i3 = intentoParaPedido("reserva", pedido);
  assert.notEqual(i3, i1, "volver al pedido anterior después de cambiarlo: clave nueva (la vieja ya no se usa)");
  assert.equal(intentoParaPedido("gift_card", pedido) === i3, false, "cada flujo, su clave");
  const guardado = [...almacen.values()].join(" ");
  assert.ok(!guardado.includes("Ana") && !guardado.includes("3519990000"), "el navegador no guarda nombre ni teléfono");
  olvidarIntento("reserva");
  assert.notEqual(intentoParaPedido("reserva", pedido), i3, "olvidado: otra clave");
  assert.ok(intentoTerminado("intento_vencido") && intentoTerminado("intento_con_otro_pedido") && intentoTerminado("compra_ya_pagada"));
  assert.ok(!intentoTerminado("en_uso") && !intentoTerminado("intento_en_curso"), "esperar o probar otro código no renueva la clave");

  // ── 9. Mercado Pago simulado: solo en el entorno local de pruebas ─────────
  const { modoSimulado } = await import("@/lib/mercadoPagoSimulado");
  const conEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const antes = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fn(); } finally { for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const local = { MERCADOPAGO_SIMULADO: "1", NODE_ENV: "test", VERCEL: undefined, VERCEL_ENV: undefined, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" };
  conEnv(local, () => assert.equal(modoSimulado(), true));
  conEnv({ ...local, MERCADOPAGO_SIMULADO: undefined }, () => assert.equal(modoSimulado(), false, "sin la llave"));
  conEnv({ ...local, NODE_ENV: "production" }, () => assert.equal(modoSimulado(), false, "nunca en producción"));
  conEnv({ ...local, VERCEL: "1" }, () => assert.equal(modoSimulado(), false, "nunca en Vercel"));
  conEnv({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://bcmoewwhsyxsiyvroarj.supabase.co" }, () => assert.equal(modoSimulado(), false, "nunca contra una base alojada"));

  console.log("cuponesRetencion: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
