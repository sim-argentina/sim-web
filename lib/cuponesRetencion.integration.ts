// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// Cupones de usos limitados · retención compartida Reservas / Gift Cards — las
// RUTAS reales (preferencias, compras bonificadas y webhooks) contra el stack
// LOCAL, con Mercado Pago interceptado: no sale nada a la red y no hay pagos.
//
// CONCURRENCIA REAL: los pedidos simultáneos van con Promise.all a las rutas;
// cada uno llega a la base por PostgREST con su propia conexión, así que las
// transacciones compiten de verdad (execute_sql en paralelo no sirve: corre en
// serie). Una corrida de control con el código anterior tiene que FALLAR acá.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/cuponesRetencion.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const RUN = Date.now().toString(36);
const MARCA = `zzcup_${RUN}`;
const PREFIJO = `ZZCUP${RUN.toUpperCase()}`.slice(0, 14);
const codigos: string[] = [];
const pagosUsados: string[] = [];

{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

type Resp = { status: number; json: Record<string, unknown> };

async function main() {
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-CUPON-SIN-RED";
  process.env.MERCADOPAGO_WEBHOOK_SECRET = randomBytes(24).toString("hex");
  process.env.NEXT_PUBLIC_BASE_URL = "https://cupon.invalid";
  delete process.env.MARKETING_CONSENTIMIENTO_ENABLED;
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];

  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() },
  } as unknown as NodeJS.Module;

  // ── Mercado Pago interceptado ─────────────────────────────────────────────
  const { Preference, Payment } = await import("mercadopago");
  const prefs: { id: string; body: Record<string, unknown> }[] = [];
  let modoPref: "ok" | "falla" | "creada_sin_respuesta" = "ok";
  (Preference.prototype as unknown as { create: (a: { body: Record<string, unknown> }) => Promise<unknown> }).create = async (a) => {
    if (modoPref === "falla") throw new Error("Mercado Pago no disponible (simulado)");
    const n = prefs.length + 1;
    const id = `pref-${RUN}-${n}`;
    prefs.push({ id, body: a.body });
    if (modoPref === "creada_sin_respuesta") throw new Error("tiempo agotado (simulado): la preferencia se creó, la respuesta no llegó");
    await new Promise((r) => setTimeout(r, 15)); // que los pedidos simultáneos se crucen
    return { id, init_point: `https://cupon.invalid/pagar/${n}`, sandbox_init_point: null };
  };
  const pagos: Record<string, Record<string, unknown>> = {};
  let mpNoResponde = false;
  (Payment.prototype as unknown as { get: (a: { id: string }) => Promise<unknown> }).get = async ({ id }) => {
    const p = pagos[String(id)];
    if (!p) throw new Error(`pago ${id} inexistente`);
    return p;
  };
  (Payment.prototype as unknown as { search: (a: { options: Record<string, unknown> }) => Promise<unknown> }).search = async ({ options }) => {
    if (mpNoResponde) throw new Error("Mercado Pago no responde (simulado)");
    return { results: Object.values(pagos).filter((p) => p.external_reference === options.external_reference) };
  };
  let nPago = 0;
  const pago = (ref: string, status: string, monto: number) => {
    const id = `${9_000_000 + Number.parseInt(RUN.slice(-4), 36) % 100_000}${String(++nPago).padStart(3, "0")}`;
    pagosUsados.push(id);
    pagos[id] = { id, status, status_detail: status, external_reference: ref, transaction_amount: monto, currency_id: "ARS", date_approved: new Date().toISOString() };
    return id;
  };

  const MP = await import("@/app/api/mercadopago/preference/route");
  const RESV = await import("@/app/api/reservas/route");
  const GC = await import("@/app/api/gift-cards/preference/route");
  const WH_RESV = await import("@/app/api/mercadopago/webhook/route");
  const WH_GC = await import("@/app/api/gift-cards/webhook/route");
  const CATALOGO_GC = await import("@/app/api/gift-cards/catalogo/route");
  const { disponibilidadReservas } = await import("@/lib/reservasComercial");

  let ip = 0;
  const unaIp = () => `198.20.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
  async function post(h: unknown, ruta: string, body: unknown): Promise<Resp> {
    const req = new Request(`${ORIGEN}${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, "x-real-ip": unaIp() },
      body: JSON.stringify(body),
    });
    const res = await (h as (r: Request) => Promise<Response>)(req);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }
  async function notificar(h: unknown, ruta: string, paymentId: string): Promise<number> {
    const ts = String(Date.now());
    const rid = randomUUID();
    const v1 = createHmac("sha256", process.env.MERCADOPAGO_WEBHOOK_SECRET!).update(`id:${paymentId.toLowerCase()};request-id:${rid};ts:${ts};`).digest("hex");
    const res = await (h as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid, "x-real-ip": unaIp() },
      body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
    }));
    return res.status;
  }
  const notificarReserva = (id: string) => notificar(WH_RESV.POST, "/api/mercadopago/webhook", id);
  const notificarGc = (id: string) => notificar(WH_GC.POST, "/api/gift-cards/webhook", id);

  // ── Datos sintéticos ──────────────────────────────────────────────────────
  let nCodigo = 0;
  function codigo(valor: number, max: number | null): string {
    const c = `${PREFIJO}${++nCodigo}`;
    codigos.push(c);
    sql(`insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
         values (${lit(c)}, ${lit(MARCA)}, 'porcentaje', ${valor}, ${max ?? "null"}, 0, true, ${lit(MARCA)})`);
    return c;
  }
  const usos = (c: string) => Number(sql(`select usos_actuales from public.codigos_descuento where codigo = ${lit(c)}`));
  const estados = (c: string) => sql(`select coalesce(string_agg(estado, ',' order by retenido_en), '') from public.codigo_retenciones where codigo = ${lit(c)}`);
  const registrosDeUso = (c: string) => Number(sql(`select count(*) from public.usos_codigos_descuento where codigo = ${lit(c)}`));
  /** Pasa el tiempo para las retenciones de c: venció la preferencia y la gracia del intento. */
  const vencer = (c: string) => sql(`update public.codigo_retenciones set vence_en = now() - interval '1 second', retenido_en = now() - interval '1 hour'
                                     where codigo = ${lit(c)} and estado = 'retenido'`);
  const retencion = (c: string, extra = "") => JSON.parse(sql(`select row_to_json(r) from public.codigo_retenciones r where codigo = ${lit(c)} ${extra} order by retenido_en desc limit 1`) || "null") as Record<string, unknown> | null;

  const disp = await disponibilidadReservas({ ahora: new Date() });
  assert.ok(disp.ok, "disponibilidad local");
  const d = disp.data;
  // Turnos que no se pisan entre sí: por simulador, inicios separados 60 minutos.
  const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const libresPorSim = new Map<string, number>();
  const turnos: { hora: string; sim: string }[] = [];
  for (const h of [...d.horarios].sort((a, b) => minutos(a.hora) - minutos(b.hora))) {
    for (const sim of h.libres) {
      const ultimo = libresPorSim.get(sim);
      if (ultimo !== undefined && minutos(h.hora) - ultimo < 60) continue;
      libresPorSim.set(sim, minutos(h.hora));
      turnos.push({ hora: h.hora, sim });
    }
  }
  let nTurno = 0;
  const turno = () => {
    const t = turnos[nTurno++];
    assert.ok(t, `hacen falta más turnos libres en el stack local (${turnos.length})`);
    return t;
  };
  const reserva = (extra: Record<string, unknown> = {}, t = turno()) => ({
    nombre: `Reserva ${MARCA}`, telefono: "3519990101", fecha: d.fecha, hora: t.hora, simuladores: [t.sim], cantidad_turnos: 1,
    total: d.precio, acepto_condiciones: true, duracion_minutos: d.duracion, modalidad_vista: d.modalidad, precio_visto: d.precio,
    intento_id: randomUUID(), ...extra,
  });
  const catalogoGc = (await (await (CATALOGO_GC.GET as (r: Request) => Promise<Response>)(
    new Request(`${ORIGEN}/api/gift-cards/catalogo`, { headers: { "x-real-ip": "198.20.250.1" } }),
  )).json()) as { modalidad: string; productos: { duracion: number; monto: number }[]; vigencia_dias: number };
  assert.equal(catalogoGc.vigencia_dias, 30, "la vigencia pública de las Gift Cards sigue en 30 días");
  const producto = catalogoGc.productos[0];
  const giftCard = (extra: Record<string, unknown> = {}) => ({
    comprador_nombre: `Comprador ${MARCA}`, comprador_telefono: "3519990102", destinatario_nombre: null,
    duracion_minutos: producto.duracion, cantidad: 1, modo_uso: "separadas", modalidad_vista: catalogoGc.modalidad,
    intento_id: randomUUID(), ...extra,
  });
  const exito = (rs: Resp[]) => rs.filter((r) => r.status === 200 || r.status === 201);
  const conCodigo = (rs: Resp[], codigo: string) => rs.filter((r) => r.json.codigo === codigo);
  const precioReserva = d.precio;

  // ── 1. Reserva contra Reserva: 5 a la vez, un solo uso ────────────────────
  {
    const C = codigo(10, 1);
    const antes = prefs.length;
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: C }))));
    assert.equal(exito(rs).length, 1, `una sola compra con el cupón: ${JSON.stringify(rs.map((r) => [r.status, r.json.codigo]))}`);
    assert.equal(conCodigo(rs, "en_uso").length, 4, "las demás: el cupón está apartado");
    assert.equal(prefs.length - antes, 1, "una sola preferencia con descuento");
    const p = prefs[prefs.length - 1].body as { items: { unit_price: number }[]; expires?: boolean; expiration_date_to?: string; external_reference: string };
    const ok = exito(rs)[0].json;
    assert.equal(p.items[0].unit_price, Math.round(precioReserva * 0.9), "el precio con descuento sale del servidor");
    assert.equal(ok.total_final, p.items[0].unit_price);
    assert.equal(p.expires, true, "la preferencia con cupón limitado vence");
    assert.ok(Date.parse(String(p.expiration_date_to)) > Date.now() + 25 * 60_000, "a los 30 minutos");
    assert.equal(estados(C), "retenido");
    assert.equal(usos(C), 0, "retenido no es consumido");
    assert.equal(sql(`select count(*) from public.reservas where codigo_descuento = ${lit(C)}`), "1", "una sola reserva con ese código");
    const r = retencion(C)!;
    assert.equal(r.external_reference, p.external_reference, "retención ↔ compra ↔ preferencia");
    assert.equal(r.reserva_id, ok.reserva_id);
    assert.equal(r.preferencia_id, prefs[prefs.length - 1].id);
  }
  console.log("OK — 1: Reserva contra Reserva (5 simultáneas): una retención, una preferencia, las demás 409 en_uso.");

  // ── 2. Gift Card contra Gift Card: 6 a la vez ─────────────────────────────
  {
    const C = codigo(10, 1);
    const antes = prefs.length;
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }))));
    assert.equal(exito(rs).length, 1, `una sola compra: ${JSON.stringify(rs.map((r) => [r.status, r.json.codigo]))}`);
    assert.equal(conCodigo(rs, "en_uso").length, 5);
    assert.equal(prefs.length - antes, 1);
    assert.equal(sql(`select count(distinct grupo_compra_id) from public.gift_cards where codigo_descuento = ${lit(C)}`), "1", "un solo grupo con el código");
    assert.equal(estados(C), "retenido");
  }
  console.log("OK — 2: Gift Card contra Gift Card (6 simultáneas): una sola compra con el cupón.");

  // ── 3. Reserva contra Gift Card: el mismo cupón en los dos productos ──────
  {
    const C = codigo(10, 1);
    const rs = await Promise.all([
      ...Array.from({ length: 3 }, () => post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: C }))),
      ...Array.from({ length: 3 }, () => post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }))),
    ]);
    assert.equal(exito(rs).length, 1, `una sola compra entre los dos productos: ${JSON.stringify(rs.map((r) => [r.status, r.json.codigo]))}`);
    assert.equal(conCodigo(rs, "en_uso").length, 5);
    const compras = Number(sql(`select (select count(*) from public.reservas where codigo_descuento = ${lit(C)}) + (select count(distinct grupo_compra_id) from public.gift_cards where codigo_descuento = ${lit(C)})`));
    assert.equal(compras, 1);
  }
  console.log("OK — 3: Reserva contra Gift Card (3 + 3 simultáneas): una sola compra en total.");

  // ── 4. Bonificadas sin Mercado Pago, a la vez ─────────────────────────────
  {
    const C = codigo(100, 1);
    const antes = prefs.length;
    const rs = await Promise.all([
      ...Array.from({ length: 3 }, () => post(RESV.POST, "/api/reservas", reserva({ codigo_descuento: C, total: 0 }))),
      ...Array.from({ length: 3 }, () => post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }))),
    ]);
    assert.equal(exito(rs).length, 1, `una sola bonificada: ${JSON.stringify(rs.map((r) => [r.status, r.json.codigo ?? r.json.error]))}`);
    assert.equal(prefs.length, antes, "sin Mercado Pago");
    assert.equal(usos(C), 1, "consumida en el mismo pedido");
    assert.equal(estados(C), "consumido");
    assert.equal(registrosDeUso(C), 1, "un registro de uso");
    const activas = Number(sql(`select (select count(*) from public.reservas where codigo_descuento = ${lit(C)} and estado = 'activa')
                                     + (select count(distinct grupo_compra_id) from public.gift_cards where codigo_descuento = ${lit(C)} and estado_pago = 'pagado')`));
    assert.equal(activas, 1, "una sola compra bonificada quedó activa");
    if (sql(`select count(*) from public.gift_cards where codigo_descuento = ${lit(C)} and estado_pago = 'pagado'`) !== "0") {
      assert.equal(sql(`select round(extract(epoch from (fecha_vencimiento - fecha_pago)) / 86400) from public.gift_cards where codigo_descuento = ${lit(C)} and estado_pago = 'pagado' limit 1`), "30");
    }
  }
  console.log("OK — 4: bonificadas simultáneas (Reserva y Gift Card): una sola, consumida en el acto, sin Mercado Pago.");

  // ── 5. Reintentos del mismo intento ───────────────────────────────────────
  {
    const C = codigo(10, 1);
    const body = reserva({ codigo_descuento: C });
    const antes = prefs.length;
    const a = await post(MP.POST, "/api/mercadopago/preference", body);
    const b = await post(MP.POST, "/api/mercadopago/preference", body);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.equal(b.json.init_point, a.json.init_point, "el reintento recibe el MISMO link");
    assert.equal(b.json.reserva_id, a.json.reserva_id, "y la misma reserva");
    assert.equal(b.json.total_final, a.json.total_final);
    assert.equal(prefs.length - antes, 1, "no se abrió otra oportunidad de pago");
    assert.equal(estados(C), "retenido", "una sola retención");
    const otro = await post(MP.POST, "/api/mercadopago/preference", { ...body, nombre: `Reserva ${MARCA} `, telefono: "3519990199" });
    assert.equal(otro.json.codigo, "intento_con_otro_pedido", "la misma clave con otro pedido no se mezcla");

    // Doble clic: dos pedidos IGUALES a la vez.
    const C2 = codigo(10, 1);
    const body2 = reserva({ codigo_descuento: C2 });
    const antes2 = prefs.length;
    const rs = await Promise.all([post(MP.POST, "/api/mercadopago/preference", body2), post(MP.POST, "/api/mercadopago/preference", body2)]);
    const links = new Set(exito(rs).map((r) => r.json.init_point));
    assert.equal(links.size, 1, `nunca dos links distintos: ${JSON.stringify(rs.map((r) => [r.status, r.json.codigo, r.json.init_point]))}`);
    assert.ok(rs.every((r) => r.status === 200 || r.json.codigo === "intento_en_curso"), "el otro espera, no paga aparte");
    assert.equal(prefs.length - antes2, 1);
    assert.equal(sql(`select count(*) from public.reservas where codigo_descuento = ${lit(C2)} and estado = 'pendiente_pago'`), "1");
  }
  console.log("OK — 5: el reintento devuelve el mismo link y la misma reserva; doble clic: un solo link.");

  // ── 6. Mercado Pago falla al crear la preferencia ─────────────────────────
  {
    const C = codigo(10, 1);
    const body = reserva({ codigo_descuento: C });
    modoPref = "falla";
    const r1 = await post(MP.POST, "/api/mercadopago/preference", body);
    modoPref = "ok";
    assert.equal(r1.status, 500);
    const r = retencion(C)!;
    assert.equal(r.estado, "retenido", "la oportunidad de pago se anotó antes de llamar: no se libera sola");
    assert.equal(r.con_pago, true);
    assert.equal(sql(`select estado from public.reservas where id = ${Number(r.reserva_id)}`), "error_pago");
    const otro = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: C }));
    assert.equal(otro.json.codigo, "en_uso", "otra persona no lo puede usar mientras tanto");
    const antes = prefs.length;
    const r2 = await post(MP.POST, "/api/mercadopago/preference", body);
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    assert.equal(r2.json.reserva_id, r.reserva_id, "el reintento rehace la preferencia de LA MISMA reserva");
    assert.equal(sql(`select estado from public.reservas where id = ${Number(r.reserva_id)}`), "pendiente_pago");
    assert.equal(prefs.length - antes, 1);
    assert.equal(retencion(C)!.preferencia_id, prefs[prefs.length - 1].id);
  }
  console.log("OK — 6: si Mercado Pago falla, la retención queda y el reintento rehace la preferencia de la misma compra.");

  // ── 7. Mercado Pago la creó pero la respuesta no llegó ────────────────────
  {
    const C = codigo(10, 1);
    modoPref = "creada_sin_respuesta";
    const r1 = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    modoPref = "ok";
    assert.equal(r1.status, 500);
    const r = retencion(C)!;
    assert.equal(r.estado, "retenido");
    assert.ok(Date.parse(String(r.vence_en)) > Date.now() + 30 * 60_000, "no se libera antes del vencimiento de esa preferencia (+5 min)");
    const temprano = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    assert.equal(temprano.json.codigo, "en_uso", "antes de vencer, nadie más");
    // Pasó el tiempo y Mercado Pago no tiene ningún pago de esa compra: se libera.
    vencer(C);
    const tarde = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    assert.equal(tarde.status, 200, JSON.stringify(tarde.json));
    assert.equal(sql(`select estado || '|' || motivo_liberacion from public.codigo_retenciones where id = ${lit(String(r.id))}`), "liberado|sin_pago_tras_vencer");
    assert.equal(estados(C), "liberado,retenido");
  }
  console.log("OK — 7: preferencia creada sin respuesta: retenida hasta vencer; después, verificado en Mercado Pago, se libera.");

  // ── 8. Pago pendiente o Mercado Pago sin respuesta: no se libera ──────────
  {
    const C = codigo(10, 1);
    const a = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    assert.equal(a.status, 200);
    const ref = `gift_card_${a.json.grupo_compra_id}`;
    const pendiente = pago(ref, "in_process", 1);
    vencer(C);
    assert.equal((await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }))).json.codigo, "en_uso", "un pago en proceso todavía puede aprobarse");
    pagos[pendiente].status = "rejected";
    mpNoResponde = true;
    assert.equal((await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }))).json.codigo, "en_uso", "sin poder verificar, no se libera");
    mpNoResponde = false;
    // El pago pendiente se aprueba después: el webhook consume.
    const aprobado = pago(ref, "approved", 1);
    assert.equal(await notificarGc(aprobado), 200);
    assert.equal(usos(C), 1);
    assert.equal(estados(C), "consumido");
    const agotado = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    assert.equal(agotado.status, 400);
    assert.match(String(agotado.json.error), /máximo de usos|no está activo/, "agotado (al llegar al máximo el código se desactiva, como siempre)");
    assert.equal(sql(`select string_agg(distinct estado_pago, ',') from public.gift_cards where grupo_compra_id = ${lit(String(a.json.grupo_compra_id))}`), "pagado");
  }
  console.log("OK — 8: un pago abierto o Mercado Pago sin respuesta mantienen la retención; el pago aprobado la consume.");

  // ── 9. Rechazo, reintento con otro medio y notificaciones fuera de orden ──
  {
    const C = codigo(10, 1);
    const body = giftCard({ codigo_descuento: C });
    const a = await post(GC.POST, "/api/gift-cards/preference", body);
    const ref = `gift_card_${a.json.grupo_compra_id}`;
    const rechazado = pago(ref, "rejected", 1);
    assert.equal(await notificarGc(rechazado), 200);
    assert.equal(estados(C), "retenido", "un rechazo no libera: la preferencia sigue sirviendo");
    assert.equal((await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }))).json.codigo, "en_uso");
    const otraVez = await post(GC.POST, "/api/gift-cards/preference", body);
    assert.equal(otraVez.json.init_point, a.json.init_point, "volver a intentar = el mismo link");
    const aprobado = pago(ref, "approved", 1);
    assert.equal(await notificarGc(aprobado), 200);
    assert.equal(await notificarGc(rechazado), 200, "el rechazo viejo que llega tarde");
    assert.equal(sql(`select string_agg(distinct estado_pago, ',') from public.gift_cards where grupo_compra_id = ${lit(String(a.json.grupo_compra_id))}`), "pagado", "no pisa el pago");
    assert.equal(usos(C), 1);
    assert.equal(registrosDeUso(C), 1);
  }
  console.log("OK — 9: rechazo → la retención sigue; aprobado después → consumida; el rechazo tardío no pisa nada.");

  // ── 10. Notificaciones duplicadas y simultáneas del mismo pago (Reserva) ─
  const turnoOcupado = turno();
  {
    const C = codigo(10, 1);
    const a = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: C }, turnoOcupado));
    assert.equal(a.status, 200);
    const p = pago(`reserva_${a.json.reserva_id}`, "approved", Number(a.json.total_final));
    const estadosHttp = await Promise.all([notificarReserva(p), notificarReserva(p), notificarReserva(p), notificarReserva(p)]);
    assert.ok(estadosHttp.every((s) => s === 200 || s === 500), JSON.stringify(estadosHttp));
    for (let i = 0; i < 3 && estadosHttp.some((s) => s === 500); i++) estadosHttp.push(await notificarReserva(p)); // los reintentos de Mercado Pago
    assert.equal(await notificarReserva(p), 200, "una tardía más");
    assert.equal(sql(`select estado || '|' || mercado_pago_payment_id from public.reservas where id = ${Number(a.json.reserva_id)}`), `activa|${p}`);
    assert.equal(usos(C), 1, "un solo uso");
    assert.equal(registrosDeUso(C), 1, "un solo registro de uso");
    assert.equal(sql(`select pago_id from public.codigo_retenciones where codigo = ${lit(C)}`), p, "la retención sabe qué pago la consumió");
  }
  console.log("OK — 10: cuatro notificaciones simultáneas + una tardía del mismo pago: un solo uso.");

  // ── 11. Pago aprobado después del vencimiento local ───────────────────────
  {
    // (a) Venció pero nadie la liberó: el pago la consume igual.
    const C = codigo(10, 1);
    const a = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    vencer(C);
    assert.equal(await notificarGc(pago(`gift_card_${a.json.grupo_compra_id}`, "approved", 1)), 200);
    assert.equal(estados(C), "consumido");
    assert.equal(usos(C), 1);

    // (b) Se liberó (Mercado Pago no tenía nada) y otra compra lo tomó; aun así
    // llega el pago aprobado de la primera: la compra queda paga, el límite no se pasa.
    const C2 = codigo(10, 1);
    const primera = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C2 }));
    vencer(C2);
    const segunda = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C2 }));
    assert.equal(segunda.status, 200, "la verificación liberó la primera");
    assert.equal(await notificarGc(pago(`gift_card_${primera.json.grupo_compra_id}`, "approved", 1)), 200);
    assert.equal(sql(`select string_agg(distinct estado_pago, ',') from public.gift_cards where grupo_compra_id = ${lit(String(primera.json.grupo_compra_id))}`), "pagado", "la compra pagada no se bloquea");
    assert.equal(sql(`select estado || '|' || nota from public.codigo_retenciones where grupo_compra_id = ${lit(String(primera.json.grupo_compra_id))}`), "liberado|aprobado_sin_cupo", "queda anotada para revisar");
    assert.equal(usos(C2), 0);
    assert.equal(await notificarGc(pago(`gift_card_${segunda.json.grupo_compra_id}`, "approved", 1)), 200);
    assert.equal(usos(C2), 1, "nunca más usos que el máximo");

    // (c) Se liberó y nadie lo tomó (la compra que la verificó no llegó a nada:
    // su turno estaba ocupado y soltó su propia retención): el pago tardío consume.
    const C3 = codigo(10, 1);
    const tercera = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C3 }));
    vencer(C3);
    const sondeo = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: C3 }, turnoOcupado));
    assert.equal(sondeo.status, 409, JSON.stringify(sondeo.json));
    assert.notEqual(sondeo.json.codigo, "en_uso", "el cupón estaba libre: lo que falló fue el turno");
    assert.equal(estados(C3), "liberado,liberado");
    assert.equal(await notificarGc(pago(`gift_card_${tercera.json.grupo_compra_id}`, "approved", 1)), 200);
    assert.equal(sql(`select estado || '|' || nota from public.codigo_retenciones where grupo_compra_id = ${lit(String(tercera.json.grupo_compra_id))}`), "consumido|consumida_tras_liberar");
    assert.equal(usos(C3), 1);
  }
  console.log("OK — 11: pago aprobado después de vencer: consume si la retención sigue; si se liberó, solo con cupo; la compra paga nunca se bloquea.");

  // ── 12. Reserva pagada que queda en conflicto: el uso se cuenta igual ─────
  {
    const C = codigo(10, 1);
    const a = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: C }));
    sql(`update public.reservas set simuladores = '[]'::jsonb where id = ${Number(a.json.reserva_id)}`); // ya no se puede ubicar el turno
    assert.equal(await notificarReserva(pago(`reserva_${a.json.reserva_id}`, "approved", Number(a.json.total_final))), 200);
    assert.equal(sql(`select estado from public.reservas where id = ${Number(a.json.reserva_id)}`), "conflicto_pago");
    assert.equal(estados(C), "consumido", "el descuento se cobró: el uso cuenta aunque falte el turno");
    assert.equal(usos(C), 1);
  }
  console.log("OK — 12: reserva pagada en conflicto: la retención se consume igual (sin devolver usos).");

  // ── 13. Reserva bonificada: se consume en el pedido; el reintento no vuelve a consumir ─
  {
    const C = codigo(100, 1);
    const body = reserva({ codigo_descuento: C, total: 0 });
    const a = await post(RESV.POST, "/api/reservas", body);
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(a.json.estado, "activa");
    const b = await post(RESV.POST, "/api/reservas", body);
    assert.equal(b.status, 201, JSON.stringify(b.json));
    assert.equal(b.json.id, a.json.id, "el reintento devuelve la misma reserva");
    assert.equal(usos(C), 1);
    assert.equal(registrosDeUso(C), 1);
    assert.equal(sql(`select reserva_id from public.usos_codigos_descuento where codigo = ${lit(C)}`), String(a.json.id), "el uso apunta a la reserva");
    assert.equal(sql(`select count(*) from public.reservas where codigo_descuento = ${lit(C)}`), "1");
  }
  console.log("OK — 13: Reserva bonificada: consumida una vez; el reintento devuelve la misma reserva.");

  // ── 13b. Gift Card bonificada cortada entre el consumo y la activación ────
  {
    const C = codigo(100, 1);
    const body = giftCard({ codigo_descuento: C });
    const a = await post(GC.POST, "/api/gift-cards/preference", body);
    assert.equal(a.json.free, true, JSON.stringify(a.json));
    const g = String(a.json.grupo_compra_id);
    // Falla parcial simulada: el uso quedó consumido pero la tarjeta no llegó a activarse.
    sql(`update public.gift_cards set estado_pago = 'pendiente_pago', fecha_pago = null, fecha_vencimiento = null where grupo_compra_id = ${lit(g)}`);
    const b = await post(GC.POST, "/api/gift-cards/preference", body);
    assert.deepEqual([b.status, b.json.free, b.json.grupo_compra_id], [200, true, g], "el reintento devuelve la misma compra");
    assert.equal(sql(`select estado_pago || '|' || round(extract(epoch from (fecha_vencimiento - fecha_pago)) / 86400) from public.gift_cards where grupo_compra_id = ${lit(g)}`), "pagado|30", "y la termina de activar, con 30 días");
    assert.equal(usos(C), 1, "sin consumir de nuevo");
    assert.equal(sql(`select count(distinct grupo_compra_id) from public.gift_cards where codigo_descuento = ${lit(C)}`), "1");
  }
  console.log("OK — 13b: Gift Card bonificada cortada a mitad de camino: el reintento la completa sin consumir otra vez.");

  // ── 14. Varias Gift Cards en una compra: un descuento sobre el total, un uso ─
  {
    const C = codigo(10, 1);
    const a = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C, cantidad: 3 }));
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const g = String(a.json.grupo_compra_id);
    const total = producto.monto * 3;
    const r = retencion(C)!;
    assert.deepEqual([Number(r.total_original), Number(r.descuento), Number(r.total_final)], [total, Math.round(total * 0.1), total - Math.round(total * 0.1)]);
    assert.equal(Number(sql(`select sum(monto) from public.gift_cards where grupo_compra_id = ${lit(g)}`)), total - Math.round(total * 0.1), "repartido entre las tres");
    assert.equal(sql(`select count(*) from public.gift_cards where grupo_compra_id = ${lit(g)}`), "3");
    assert.equal(await notificarGc(pago(`gift_card_${g}`, "approved", total - Math.round(total * 0.1))), 200);
    assert.equal(usos(C), 1, "tres tarjetas, un uso del código (regla de siempre)");
  }
  console.log("OK — 14: tres Gift Cards: descuento único sobre el total, repartido, y un solo uso.");

  // ── 15. Sin cupón y con cupón sin límite: como siempre ────────────────────
  {
    const filasAntes = Number(sql(`select count(*) from public.codigo_retenciones`));
    const sinCodigo = await post(GC.POST, "/api/gift-cards/preference", giftCard());
    assert.equal(sinCodigo.status, 200);
    assert.equal(prefs[prefs.length - 1].body.expires, undefined, "sin cupón, la preferencia no vence (como siempre)");
    const sinCodigoR = await post(MP.POST, "/api/mercadopago/preference", reserva({ total: 1, descuento_aplicado: 99999 }));
    assert.equal(sinCodigoR.status, 200);
    assert.equal((prefs[prefs.length - 1].body.items as { unit_price: number }[])[0].unit_price, precioReserva, "el total del navegador se ignora");
    const L = codigo(10, null);
    const libre = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: L }));
    assert.equal(libre.status, 200);
    assert.equal(prefs[prefs.length - 1].body.expires, undefined, "código sin límite: sin vencimiento ni retención");
    assert.equal(Number(sql(`select count(*) from public.codigo_retenciones`)), filasAntes, "nada se retuvo");
    assert.equal(await notificarReserva(pago(`reserva_${libre.json.reserva_id}`, "approved", Number(libre.json.total_final))), 200);
    assert.equal(usos(L), 1, "el consumo de siempre");
  }
  console.log("OK — 15: sin cupón o con cupón sin límite, todo igual que antes (sin retención ni vencimiento).");
}

function limpiar() {
  const cs = codigos.map(lit).join(", ") || "''";
  const ps = pagosUsados.map(lit).join(", ") || "''";
  sql(`begin;
       set local session_replication_role = replica;
       delete from public.codigo_retenciones where codigo in (${cs});
       delete from public.usos_codigos_descuento where codigo in (${cs});
       delete from public.fin_pagos_web where payment_id in (${ps});
       delete from public.gift_cards where comprador_nombre = ${lit(`Comprador ${MARCA}`)};
       delete from public.reserva_slots where reserva_id in (select id from public.reservas where nombre like ${lit(`Reserva ${MARCA}%`)});
       delete from public.reservas where nombre like ${lit(`Reserva ${MARCA}%`)};
       delete from public.codigos_descuento where codigo in (${cs});
       commit;`);
  assert.equal(sql(`select count(*) from public.codigo_retenciones where codigo in (${cs})`), "0");
  assert.equal(sql(`select count(*) from public.reservas where nombre like ${lit(`Reserva ${MARCA}%`)}`), "0");
  assert.equal(sql(`select count(*) from public.gift_cards where comprador_nombre = ${lit(`Comprador ${MARCA}`)}`), "0");
  assert.equal(sql(`select count(*) from public.codigos_descuento where codigo in (${cs})`), "0");
}

main()
  .then(() => { limpiar(); console.log("Limpieza hecha."); })
  .catch((e) => {
    console.error(e);
    try { limpiar(); } catch (err) { console.error("Limpieza falló:", err); }
    process.exit(1);
  });
