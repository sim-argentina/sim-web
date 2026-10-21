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

  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: {
      cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }),
      headers: async () => new Headers(),
    },
  } as unknown as NodeJS.Module;

  // ── Mercado Pago interceptado ─────────────────────────────────────────────
  // Lo que usa la app de la API (y lo que dice su documentación): crear,
  // obtener y buscar preferencias (paginado, con expires/expiration_date_to) y
  // obtener y buscar pagos (paging.total). Modos para los fallos a probar.
  const { Preference, Payment } = await import("mercadopago");
  const prefs: { id: string; init_point: string; body: Record<string, unknown> }[] = [];
  let modoPref: "ok" | "falla" | "creada_sin_respuesta" | "colgada_tras_crear" | "colgada_antes" = "ok";
  let demoraPref = 15; // ms: que los pedidos simultáneos se crucen
  const nunca = new Promise<never>(() => {}); // un pedido que "murió" con el proceso
  (Preference.prototype as unknown as { create: (a: { body: Record<string, unknown> }) => Promise<unknown> }).create = async (a) => {
    const modo = modoPref;
    if (modo === "falla") throw Object.assign(new Error("Mercado Pago no disponible (simulado)"), { status: 503 });
    if (modo === "colgada_antes") return nunca;
    const n = prefs.length + 1;
    const p = { id: `pref-${RUN}-${n}`, init_point: `https://cupon.invalid/pagar/${n}`, body: a.body };
    prefs.push(p);
    if (modo === "creada_sin_respuesta") throw new Error("tiempo agotado (simulado): la preferencia se creó, la respuesta no llegó");
    if (modo === "colgada_tras_crear") return nunca;
    await new Promise((r) => setTimeout(r, demoraPref));
    return { id: p.id, init_point: p.init_point, sandbox_init_point: null };
  };
  let busquedaPrefs: "ok" | "falla" | "incompleta" = "ok";
  const vistaPref = (p: (typeof prefs)[number]) => ({
    id: p.id, external_reference: p.body.external_reference, expires: p.body.expires ?? false, expiration_date_to: p.body.expiration_date_to ?? null,
  });
  (Preference.prototype as unknown as { search: (a: { options: Record<string, unknown> }) => Promise<unknown> }).search = async ({ options }) => {
    if (busquedaPrefs === "falla") throw Object.assign(new Error("búsqueda de preferencias caída (simulado)"), { status: 500 });
    const todas = prefs.filter((p) => p.body.external_reference === options.external_reference);
    const offset = Number(options.offset ?? 0);
    const pagina = todas.slice(offset, offset + 30).map(vistaPref);
    return { elements: busquedaPrefs === "incompleta" ? [] : pagina, total: todas.length + (busquedaPrefs === "incompleta" ? 1 : 0), next_offset: offset + pagina.length };
  };
  (Preference.prototype as unknown as { get: (a: { preferenceId: string }) => Promise<unknown> }).get = async ({ preferenceId }) => {
    const p = prefs.find((x) => x.id === preferenceId);
    if (!p) throw Object.assign(new Error("preferencia inexistente"), { status: 404 });
    return { ...vistaPref(p), init_point: p.init_point, sandbox_init_point: null };
  };
  /** Pasa el tiempo para Mercado Pago: las preferencias de esa compra quedan vencidas. */
  const vencerEnMp = (ref: string) => {
    for (const p of prefs) if (p.body.external_reference === ref && p.body.expires === true) p.body.expiration_date_to = new Date(Date.now() - 60 * 60_000).toISOString();
  };
  const pagos: Record<string, Record<string, unknown>> = {};
  let mpNoResponde = false;
  let pagosIncompletos = false;
  (Payment.prototype as unknown as { get: (a: { id: string }) => Promise<unknown> }).get = async ({ id }) => {
    const p = pagos[String(id)];
    if (!p) throw new Error(`pago ${id} inexistente`);
    return p;
  };
  (Payment.prototype as unknown as { search: (a: { options: Record<string, unknown> }) => Promise<unknown> }).search = async ({ options }) => {
    if (mpNoResponde) throw Object.assign(new Error("Mercado Pago no responde (simulado)"), { status: 503 });
    assert.ok(Number(options.limit) <= 50, "la búsqueda de pagos admite hasta 50 por página");
    const todos = Object.values(pagos).filter((p) => p.external_reference === options.external_reference);
    const offset = Number(options.offset ?? 0);
    const limit = Number(options.limit ?? 30);
    const results = pagosIncompletos ? todos.slice(offset, offset + limit).slice(0, 0) : todos.slice(offset, offset + limit);
    return { results, paging: { total: todos.length + (pagosIncompletos ? 1 : 0), limit, offset } };
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
  const CONCILIAR = await import("@/app/api/admin/cupones/conciliar/route");
  const CODIGOS = await import("@/app/api/codigos-descuento/route");
  const RETENCIONES = await import("@/app/api/codigos-descuento/[id]/retenciones/route");
  const { createSessionToken } = await import("@/lib/adminSession");
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");
  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
  // "SIM recibe la preferencia pero falla al guardarla": la próxima escritura del
  // link en la retención no llega a la base.
  let fallarGuardadoDelLink = 0;
  const rpcOriginal = supabaseAdmin.rpc.bind(supabaseAdmin);
  (supabaseAdmin as unknown as { rpc: (fn: string, a?: Record<string, unknown>) => unknown }).rpc = (fn: string, a: Record<string, unknown> = {}) => {
    if (fn === "codigo_retencion_vincular" && fallarGuardadoDelLink > 0 && (a.p_datos as Record<string, unknown>)?.preferencia_id) {
      fallarGuardadoDelLink--;
      return Promise.resolve({ data: null, error: { message: "simulado: la base no respondió", code: "08006" } });
    }
    return (rpcOriginal as unknown as (fn: string, a: Record<string, unknown>) => unknown)(fn, a);
  };
  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const esperar = async (cond: () => boolean, que: string) => {
    for (let i = 0; i < 100; i++) { if (cond()) return; await dormir(50); }
    assert.fail(`no pasó: ${que}`);
  };

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
  /**
   * Pasa el tiempo para las retenciones de c: venció la gracia del intento, el
   * vence_en de la base y, en Mercado Pago, las preferencias de esas compras.
   */
  const vencer = (c: string) => {
    const refs = sql(`select coalesce(string_agg(external_reference, ','), '') from public.codigo_retenciones where codigo = ${lit(c)} and estado = 'retenido'`);
    for (const ref of refs.split(",").filter(Boolean)) vencerEnMp(ref);
    sql(`update public.codigo_retenciones set vence_en = now() - interval '1 second', retenido_en = now() - interval '1 hour', preparando_hasta = null
         where codigo = ${lit(c)} and estado = 'retenido'`);
  };
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

  // ── 16. Operaciones incompletas: nunca una segunda oportunidad de pago ────
  {
    // (a) Mercado Pago creó la preferencia pero SIM perdió la respuesta.
    const C = codigo(10, 1);
    const body = reserva({ codigo_descuento: C });
    modoPref = "creada_sin_respuesta";
    assert.equal((await post(MP.POST, "/api/mercadopago/preference", body)).status, 500);
    modoPref = "ok";
    const perdida = prefs[prefs.length - 1];
    const antes = prefs.length;
    const r = await post(MP.POST, "/api/mercadopago/preference", body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.init_point, perdida.init_point, "el reintento recupera ESA preferencia (Buscar en preferencias)");
    assert.equal(prefs.length, antes, "no se creó otra");
    assert.equal(retencion(C)!.preferencia_id, perdida.id);

    // (b) SIM recibió la preferencia pero no pudo guardarla.
    const C2 = codigo(10, 1);
    const body2 = giftCard({ codigo_descuento: C2 });
    fallarGuardadoDelLink = 1;
    assert.equal((await post(GC.POST, "/api/gift-cards/preference", body2)).status, 500, "sin link guardado, no se entrega");
    const sinGuardar = prefs[prefs.length - 1];
    const antes2 = prefs.length;
    const r2 = await post(GC.POST, "/api/gift-cards/preference", body2);
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    assert.equal(r2.json.init_point, sinGuardar.init_point, "se recupera la que quedó sin guardar");
    assert.equal(prefs.length, antes2);

    // (c) El navegador reintenta mientras el primer pedido sigue en Mercado Pago.
    const C3 = codigo(10, 1);
    const body3 = reserva({ codigo_descuento: C3 });
    demoraPref = 1500;
    const primero = post(MP.POST, "/api/mercadopago/preference", body3);
    await esperar(() => sql(`select coalesce((select (preparando_hasta > now())::text from public.codigo_retenciones where codigo = ${lit(C3)}), 'no')`) === "true", "el primero tomó el turno");
    // Aunque ya hubiera pasado la gracia del intento, el turno de preparación lo frena.
    sql(`update public.codigo_retenciones set retenido_en = now() - interval '1 hour' where codigo = ${lit(C3)}`);
    const mientras = await post(MP.POST, "/api/mercadopago/preference", body3);
    assert.equal(mientras.json.codigo, "intento_en_curso", JSON.stringify(mientras.json));
    const r3 = await primero;
    demoraPref = 15;
    assert.equal(r3.status, 200);
    const despues = await post(MP.POST, "/api/mercadopago/preference", body3);
    assert.equal(despues.json.init_point, r3.json.init_point, "y después recibe el mismo link");
    assert.equal(prefs.filter((p) => p.body.external_reference === `reserva_${r3.json.reserva_id}`).length, 1, "una sola preferencia");

    // (d) El proceso del servidor se cae entre los pasos.
    //   · Después de que Mercado Pago creó la preferencia, antes de guardarla:
    const C4 = codigo(10, 1);
    const body4 = reserva({ codigo_descuento: C4 });
    modoPref = "colgada_tras_crear";
    const enPrefs = prefs.length;
    void post(MP.POST, "/api/mercadopago/preference", body4); // nunca vuelve: "murió"
    await esperar(() => prefs.length === enPrefs + 1, "Mercado Pago creó la preferencia");
    modoPref = "ok";
    const huerfana = prefs[prefs.length - 1];
    // Reinicio: el turno del pedido muerto vence (45 s; acá se adelanta el reloj).
    sql(`update public.codigo_retenciones set preparando_hasta = now() - interval '1 second', retenido_en = now() - interval '1 hour' where codigo = ${lit(C4)}`);
    const tras = await post(MP.POST, "/api/mercadopago/preference", body4);
    assert.equal(tras.status, 200, JSON.stringify(tras.json));
    assert.equal(tras.json.init_point, huerfana.init_point, "se recupera la preferencia del pedido muerto");
    assert.equal(prefs.length, enPrefs + 1, "sin otra");
    //   · Antes de que Mercado Pago creara nada:
    const C5 = codigo(10, 1);
    const body5 = giftCard({ codigo_descuento: C5 });
    modoPref = "colgada_antes";
    void post(GC.POST, "/api/gift-cards/preference", body5);
    await esperar(() => sql(`select coalesce((select con_pago::text from public.codigo_retenciones where codigo = ${lit(C5)}), 'no')`) === "true", "la oportunidad de pago quedó anotada");
    modoPref = "ok";
    sql(`update public.codigo_retenciones set preparando_hasta = now() - interval '1 second', retenido_en = now() - interval '1 hour' where codigo = ${lit(C5)}`);
    const enPrefs5 = prefs.length;
    const tras5 = await post(GC.POST, "/api/gift-cards/preference", body5);
    assert.equal(tras5.status, 200, JSON.stringify(tras5.json));
    assert.equal(prefs.length, enPrefs5 + 1, "no había ninguna: se crea una (la única)");
    assert.equal(estados(C5), "retenido", "una sola retención");
  }
  console.log("OK — 16: respuesta perdida, link sin guardar, reintento en curso y caída del proceso: se recupera la preferencia existente, nunca una segunda.");

  // ── 17. Ante la duda, la retención se conserva (con su motivo) ────────────
  {
    const C = codigo(10, 1);
    const a = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    assert.equal(a.status, 200);
    const ref = `gift_card_${a.json.grupo_compra_id}`;
    vencer(C);
    const motivo = () => sql(`select revision_motivo from public.codigo_retenciones where external_reference = ${lit(ref)}`);
    const otro = () => post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    pagosIncompletos = true;
    assert.equal((await otro()).json.codigo, "en_uso");
    assert.equal(motivo(), "consulta_de_pagos_incompleta", "paginación pendiente no es 'no hay pagos'");
    pagosIncompletos = false;
    mpNoResponde = true;
    assert.equal((await otro()).json.codigo, "en_uso");
    assert.match(motivo(), /^mercado_pago_no_responde/);
    mpNoResponde = false;
    busquedaPrefs = "incompleta";
    assert.equal((await otro()).json.codigo, "en_uso");
    assert.equal(motivo(), "consulta_de_preferencias_incompleta");
    busquedaPrefs = "falla";
    assert.equal((await otro()).json.codigo, "en_uso");
    assert.match(motivo(), /^mercado_pago_no_responde/);
    busquedaPrefs = "ok";
    const suya = prefs.find((p) => p.body.external_reference === ref)!;
    suya.body.expires = false;
    assert.equal((await otro()).json.codigo, "en_uso");
    assert.equal(motivo(), "preferencia_sin_vencimiento", "un link que no vence sigue siendo pagable");
    suya.body.expires = true;
    suya.body.expiration_date_to = new Date(Date.now() + 10 * 60_000).toISOString();
    assert.equal((await otro()).json.codigo, "en_uso");
    assert.equal(motivo(), "preferencia_vigente");
    suya.body.expiration_date_to = new Date(Date.now() - 5 * 60_000).toISOString();
    assert.equal((await otro()).json.codigo, "en_uso", "vencida hace menos que el margen: todavía no");
    vencerEnMp(ref);
    const ahora = await otro();
    assert.equal(ahora.status, 200, "cerrada de verdad: se libera");
    assert.equal(sql(`select estado || '|' || motivo_liberacion || '|' || revisiones from public.codigo_retenciones where external_reference = ${lit(ref)}`), "liberado|sin_pago_tras_vencer|8", "ocho revisiones registradas, una por consulta");
  }
  console.log("OK — 17: consulta incompleta, Mercado Pago caído o link pagable: se conserva con su motivo; solo se libera con todo confirmado.");

  // ── 18. Conciliación operativa: cron con secreto y panel con sesión ───────
  {
    process.env.CRON_SECRET = randomBytes(24).toString("hex");
    const cron = (auth?: string) => (CONCILIAR.GET as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}/api/admin/cupones/conciliar`, { headers: auth ? { authorization: auth } : {} }));
    const panel = async (body: unknown, origen = ORIGEN) => {
      const res = await (CONCILIAR.POST as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}/api/admin/cupones/conciliar`, {
        method: "POST", headers: { "content-type": "application/json", origin: origen, "x-real-ip": unaIp() }, body: JSON.stringify(body),
      }));
      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    };
    assert.equal((await cron()).status, 401, "sin secreto");
    assert.equal((await cron("Bearer otro")).status, 401, "con otro secreto");
    cookie = undefined;
    assert.equal((await panel({})).status, 401, "sin sesión");
    cookie = staff;
    assert.equal((await panel({})).status, 403, "staff no concilia");
    cookie = admin;
    assert.equal((await panel({}, "https://ajeno.example")).status, 403, "desde un origen ajeno");

    // Una abandonada (sin pagos, preferencia vencida) y una con pago en proceso.
    const C1 = codigo(10, 1);
    const g1 = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C1 }));
    const C2 = codigo(10, 1);
    const g2 = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C2 }));
    pago(`gift_card_${g2.json.grupo_compra_id}`, "in_process", 1);
    vencer(C1);
    vencer(C2);
    const r = await cron(`Bearer ${process.env.CRON_SECRET}`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as { resultados: { id: string; resultado: string; motivo: string }[] };
    const de = (ref: string) => j.resultados.find((x) => x.id === sql(`select id from public.codigo_retenciones where external_reference = ${lit(ref)}`));
    assert.equal(de(`gift_card_${g1.json.grupo_compra_id}`)?.resultado, "liberada", "la abandonada, confirmada en Mercado Pago");
    assert.deepEqual(de(`gift_card_${g2.json.grupo_compra_id}`), { id: de(`gift_card_${g2.json.grupo_compra_id}`)!.id, resultado: "retenida", motivo: "pago_abierto" });
    // Repetir es seguro: nada cambia de más.
    const again = (await (await cron(`Bearer ${process.env.CRON_SECRET}`)).json()) as { resultados: { id: string; resultado: string }[] };
    assert.ok(!again.resultados.some((x) => x.resultado === "liberada" && x.id === de(`gift_card_${g2.json.grupo_compra_id}`)!.id));
    // Desde el panel, una sola retención.
    const id2 = de(`gift_card_${g2.json.grupo_compra_id}`)!.id;
    const p = await panel({ retencion_id: id2 });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.deepEqual((p.json.resultados as { resultado: string }[]).map((x) => x.resultado), ["retenida"]);
    assert.equal((await panel({ retencion_id: "no-es-uuid" })).status, 400);
    assert.ok(Number(sql(`select revisiones from public.codigo_retenciones where id = ${lit(id2)}`)) >= 3, "cada revisión queda registrada");
    assert.equal(sql(`select estado from public.codigo_retenciones where id = ${lit(id2)}`), "retenido");
  }
  console.log("OK — 18: el cron (con secreto) y el panel (admin) concilian; nunca liberan algo pagable; cada revisión queda registrada.");

  // ── 19. Panel de Códigos: consumidos, retenidos, a revisar, sin datos sensibles ─
  {
    const C = codigo(10, 1);
    const a = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: C }));
    assert.equal(a.status, 200);
    const id = Number(sql(`select id from public.codigos_descuento where codigo = ${lit(C)}`));
    const listar = async () => {
      const res = await (CODIGOS.GET as () => Promise<Response>)();
      return { status: res.status, json: (await res.json()) as { codigos: { codigo: string; usos_actuales: number; usos_maximos: number; retenciones: { retenidas: number; a_revisar: number } | null }[]; retenciones_instaladas: boolean } };
    };
    cookie = staff;
    assert.equal((await listar()).status, 403, "el panel de Códigos sigue siendo de admin");
    cookie = admin;
    let l = await listar();
    assert.equal(l.json.retenciones_instaladas, true);
    let fila = l.json.codigos.find((c) => c.codigo === C)!;
    assert.deepEqual([fila.usos_actuales, fila.usos_maximos, fila.retenciones?.retenidas, fila.retenciones?.a_revisar], [0, 1, 1, 0], "0 consumidos, 1 retenido: no disponible");
    vencer(C);
    l = await listar();
    fila = l.json.codigos.find((c) => c.codigo === C)!;
    assert.equal(fila.retenciones?.a_revisar, 1, "vencida sin confirmar: a revisar");
    const det = await (RETENCIONES.GET as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
      new Request(`${ORIGEN}/api/codigos-descuento/${id}/retenciones`), { params: Promise.resolve({ id: String(id) }) });
    assert.equal(det.status, 200);
    const texto = await det.clone().text();
    const dj = (await det.json()) as { retenciones: { estado: string; producto: string; compra: { tipo: string; estado: string; tarjetas: number }; requiere_revision: string | null; external_reference: string }[] };
    assert.equal(dj.retenciones.length, 1);
    assert.deepEqual([dj.retenciones[0].estado, dj.retenciones[0].producto, dj.retenciones[0].compra.tipo, dj.retenciones[0].compra.estado, dj.retenciones[0].compra.tarjetas],
      ["retenido", "gift_card", "gift_card", "pendiente_pago", 1]);
    assert.equal(dj.retenciones[0].requiere_revision, "vencida_sin_confirmar");
    for (const k of ["intento", "huella", "init_point", "preparando_por", "cupon.invalid", "3519990102", "Comprador"]) assert.ok(!texto.includes(k), `sin ${k}`);
    cookie = staff;
    assert.equal((await (RETENCIONES.GET as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
      new Request(`${ORIGEN}/api/codigos-descuento/${id}/retenciones`), { params: Promise.resolve({ id: String(id) }) })).status, 403);
    cookie = undefined;
  }
  console.log("OK — 19: el panel distingue consumidos, retenidos y a revisar, con la compra vinculada y sin datos de la persona ni el link.");

  // ── 20. El intento no autoriza nada ───────────────────────────────────────
  {
    const C = codigo(10, 1);
    const body = reserva({ codigo_descuento: C });
    const a = await post(MP.POST, "/api/mercadopago/preference", body);
    assert.equal(a.status, 200);
    const ajeno = await post(MP.POST, "/api/mercadopago/preference", { ...body, nombre: `Reserva ${MARCA} otra`, telefono: "3519990777" });
    assert.equal(ajeno.status, 409);
    assert.deepEqual(Object.keys(ajeno.json).sort(), ["codigo", "error"], "solo el error: ni reserva, ni link, ni datos");
    assert.equal(ajeno.json.codigo, "intento_con_otro_pedido");
    const otraCompra = await post(GC.POST, "/api/gift-cards/preference", { ...giftCard({ codigo_descuento: C }), intento_id: body.intento_id });
    assert.deepEqual(Object.keys(otraCompra.json).sort(), ["codigo", "error"], "ni con otro producto");
  }
  console.log("OK — 20: el mismo intento con otro pedido no devuelve la compra anterior ni datos de nadie.");
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
