// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Cupones · COMPATIBILIDAD del despliegue de db/cupones-retencion.sql, contra
// el stack LOCAL. Recorre el orden de despliegue documentado:
//   A. Aplicación nueva + base SIN la migración (estado real de Producción hoy,
//      que se arma con db/cupones-retencion.rollback.sql y sin la tabla):
//      los cupones limitados fallan cerrados (503) sin crear nada; sin cupón o
//      con cupón sin límite todo funciona; un webhook de una compra vieja
//      consume por el camino de siempre.
//   B. Se aplica la migración: las compras pendientes con cupón limitado reciben
//      su retención 'legado', que cuenta contra el límite; el pago tardío de una
//      compra vieja consume UNA vez; una vieja sin nada pagable se libera; y si
//      el camino viejo ya había contado el uso, no se cuenta dos veces.
// Cambia el ESQUEMA local (quita y vuelve a crear objetos): correrla sola. Pase
// lo que pase, al final deja la migración aplicada de nuevo.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/cuponesRetencion.compatibilidad.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const RUN = Date.now().toString(36);
const MARCA = `zzcompat_${RUN}`;
const PREFIJO = `ZZCMP${RUN.toUpperCase()}`.slice(0, 14);
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
const aplicar = (archivo: string) => sql(readFileSync(archivo, "utf8"));
type Resp = { status: number; json: Record<string, unknown> };

async function main() {
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-CUPON-COMPAT-SIN-RED";
  process.env.MERCADOPAGO_WEBHOOK_SECRET = randomBytes(24).toString("hex");
  process.env.NEXT_PUBLIC_BASE_URL = "https://cupon.invalid";
  delete process.env.MARKETING_CONSENTIMIENTO_ENABLED;
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() },
  } as unknown as NodeJS.Module;

  // ── Mercado Pago interceptado (como en lib/cuponesRetencion.integration.ts) ─
  const { Preference, Payment } = await import("mercadopago");
  const prefs: { id: string; init_point: string; body: Record<string, unknown> }[] = [];
  (Preference.prototype as unknown as { create: (a: { body: Record<string, unknown> }) => Promise<unknown> }).create = async (a) => {
    const n = prefs.length + 1;
    const p = { id: `pref-cmp-${RUN}-${n}`, init_point: `https://cupon.invalid/pagar/${n}`, body: a.body };
    prefs.push(p);
    return { id: p.id, init_point: p.init_point, sandbox_init_point: null };
  };
  const vista = (p: (typeof prefs)[number]) => ({ id: p.id, external_reference: p.body.external_reference, expires: p.body.expires ?? false, expiration_date_to: p.body.expiration_date_to ?? null });
  (Preference.prototype as unknown as { search: (a: { options: Record<string, unknown> }) => Promise<unknown> }).search = async ({ options }) => {
    const todas = prefs.filter((p) => p.body.external_reference === options.external_reference).map(vista);
    return { elements: todas, total: todas.length, next_offset: todas.length };
  };
  (Preference.prototype as unknown as { get: (a: { preferenceId: string }) => Promise<unknown> }).get = async ({ preferenceId }) => {
    const p = prefs.find((x) => x.id === preferenceId);
    if (!p) throw Object.assign(new Error("preferencia inexistente"), { status: 404 });
    return { ...vista(p), init_point: p.init_point };
  };
  const pagos: Record<string, Record<string, unknown>> = {};
  (Payment.prototype as unknown as { get: (a: { id: string }) => Promise<unknown> }).get = async ({ id }) => pagos[String(id)];
  (Payment.prototype as unknown as { search: (a: { options: Record<string, unknown> }) => Promise<unknown> }).search = async ({ options }) => {
    const todos = Object.values(pagos).filter((p) => p.external_reference === options.external_reference);
    return { results: todos, paging: { total: todos.length, limit: 50, offset: 0 } };
  };
  let nPago = 0;
  const pago = (ref: string, status: string, monto: number) => {
    const id = `${8_000_000 + Number.parseInt(RUN.slice(-4), 36) % 100_000}${String(++nPago).padStart(3, "0")}`;
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
  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");

  let ip = 0;
  const unaIp = () => `198.21.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
  async function post(h: unknown, ruta: string, body: unknown): Promise<Resp> {
    const res = await (h as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}${ruta}`, {
      method: "POST", headers: { "content-type": "application/json", origin: ORIGEN, "x-real-ip": unaIp() }, body: JSON.stringify(body),
    }));
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }
  async function notificar(h: unknown, ruta: string, paymentId: string): Promise<number> {
    const ts = String(Date.now());
    const rid = randomUUID();
    const v1 = createHmac("sha256", process.env.MERCADOPAGO_WEBHOOK_SECRET!).update(`id:${paymentId.toLowerCase()};request-id:${rid};ts:${ts};`).digest("hex");
    const res = await (h as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}${ruta}`, {
      method: "POST", headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid, "x-real-ip": unaIp() },
      body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
    }));
    return res.status;
  }
  const notificarReserva = (id: string) => notificar(WH_RESV.POST, "/api/mercadopago/webhook", id);
  const notificarGc = (id: string) => notificar(WH_GC.POST, "/api/gift-cards/webhook", id);

  let n = 0;
  function codigo(valor: number, max: number | null): string {
    const c = `${PREFIJO}${++n}`;
    codigos.push(c);
    sql(`insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
         values (${lit(c)}, ${lit(MARCA)}, 'porcentaje', ${valor}, ${max ?? "null"}, 0, true, ${lit(MARCA)})`);
    return c;
  }
  const limitar = (c: string, max: number) => sql(`update public.codigos_descuento set usos_maximos = ${max} where codigo = ${lit(c)}`);
  const usos = (c: string) => Number(sql(`select usos_actuales from public.codigos_descuento where codigo = ${lit(c)}`));
  /** Espera a que PostgREST vea (o deje de ver) la RPC de retención. */
  async function esquema(conMigracion: boolean) {
    sql(`notify pgrst, 'reload schema';`);
    for (let i = 0; i < 60; i++) {
      const { error } = await supabaseAdmin.rpc("codigo_retener", { p_intento: randomUUID(), p_codigo: "ZZ-NADA", p_producto: "reserva", p_huella: "x" });
      const tiene = !error || error.code !== "PGRST202";
      if (tiene === conMigracion) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.fail(`PostgREST no recargó el esquema (${conMigracion ? "con" : "sin"} migración)`);
  }

  const disp = await disponibilidadReservas({ ahora: new Date() });
  assert.ok(disp.ok);
  const d = disp.data;
  const turnos: { hora: string; sim: string }[] = [];
  const ultimo = new Map<string, number>();
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  for (const h of [...d.horarios].sort((a, b) => min(a.hora) - min(b.hora))) {
    for (const sim of h.libres) {
      const u = ultimo.get(sim);
      if (u !== undefined && min(h.hora) - u < 60) continue;
      ultimo.set(sim, min(h.hora));
      turnos.push({ hora: h.hora, sim });
    }
  }
  let nT = 0;
  const reserva = (extra: Record<string, unknown> = {}) => {
    const t = turnos[nT++];
    assert.ok(t, "faltan turnos libres");
    return {
      nombre: `Reserva ${MARCA}`, telefono: "3519990201", fecha: d.fecha, hora: t.hora, simuladores: [t.sim], cantidad_turnos: 1,
      total: d.precio, acepto_condiciones: true, duracion_minutos: d.duracion, modalidad_vista: d.modalidad, precio_visto: d.precio,
      intento_id: randomUUID(), ...extra,
    };
  };
  const catalogo = (await (await (CATALOGO_GC.GET as (r: Request) => Promise<Response>)(
    new Request(`${ORIGEN}/api/gift-cards/catalogo`, { headers: { "x-real-ip": "198.21.250.1" } }),
  )).json()) as { modalidad: string; productos: { duracion: number }[] };
  const giftCard = (extra: Record<string, unknown> = {}) => ({
    comprador_nombre: `Comprador ${MARCA}`, comprador_telefono: "3519990202", destinatario_nombre: null,
    duracion_minutos: catalogo.productos[0].duracion, cantidad: 1, modo_uso: "separadas", modalidad_vista: catalogo.modalidad,
    intento_id: randomUUID(), ...extra,
  });
  const empresasAntes = sql(`select md5(coalesce(string_agg(md5(e::text), '' order by e.id), '')) from public.empresa_codigos e`);

  // ═══ A. Aplicación nueva, base SIN la migración ═══════════════════════════
  sql(`begin; set local session_replication_role = replica; delete from public.codigo_retenciones; commit;`);
  aplicar("db/cupones-retencion.rollback.sql");
  sql(`drop table if exists public.codigo_retenciones;`);
  await esquema(false);
  console.log("A · base sin la migración (rollback aplicado y sin tabla).");

  // A1. Cupón limitado: falla cerrado, sin crear nada.
  {
    const L = codigo(10, 1);
    const L100 = codigo(100, 1);
    const rs = [
      await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: L })),
      await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: L })),
      await post(RESV.POST, "/api/reservas", reserva({ codigo_descuento: L100, total: 0 })),
      await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: L100 })),
    ];
    for (const r of rs) assert.deepEqual([r.status, r.json.codigo], [503, "no_disponible"], JSON.stringify(r.json));
    assert.equal(sql(`select count(*) from public.reservas where codigo_descuento in (${lit(L)}, ${lit(L100)})`), "0", "ninguna reserva");
    assert.equal(sql(`select count(*) from public.gift_cards where codigo_descuento in (${lit(L)}, ${lit(L100)})`), "0", "ninguna Gift Card");
    assert.equal(usos(L) + usos(L100), 0);
  }
  console.log("OK — A1: sin la migración, un cupón limitado no se acepta (503) y no se crea ninguna compra.");

  // A2. Sin cupón y con cupón sin límite: como siempre. Y compras "viejas":
  // creadas con un código sin límite que después pasa a tener límite = lo que
  // dejaría la aplicación anterior (compra con cupón limitado y sin retención).
  const VIEJA_R = codigo(10, null);
  const viejaR = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: VIEJA_R }));
  const VIEJA_G = codigo(10, null);
  const viejaG = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: VIEJA_G }));
  const VIEJA_SIN_PAGO = codigo(10, null);
  const viejaSinPago = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: VIEJA_SIN_PAGO }));
  const VIEJA_PAGA = codigo(10, null);
  const viejaPaga = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: VIEJA_PAGA }));
  const VIEJA_DOBLE = codigo(10, null);
  const viejaDoble = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: VIEJA_DOBLE }));
  const sinCodigo = await post(GC.POST, "/api/gift-cards/preference", giftCard());
  for (const r of [viejaR, viejaG, viejaSinPago, viejaPaga, viejaDoble, sinCodigo]) assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const p of prefs) assert.equal(p.body.expires, undefined, "como la aplicación anterior: preferencias sin vencimiento");
  limitar(VIEJA_R, 1);
  limitar(VIEJA_G, 1);
  limitar(VIEJA_SIN_PAGO, 1);
  limitar(VIEJA_PAGA, 1);
  limitar(VIEJA_DOBLE, 2);
  console.log("OK — A2: sin cupón y con cupón sin límite, todo igual; quedan 5 compras pendientes 'de antes' (cupón limitado, sin retención).");

  // A3. El pago de una compra vieja llega en la transición: camino de siempre.
  {
    const p = pago(`reserva_${viejaPaga.json.reserva_id}`, "approved", Number(viejaPaga.json.total_final));
    assert.equal(await notificarReserva(p), 200);
    assert.equal(await notificarReserva(p), 200, "y repetido");
    assert.equal(usos(VIEJA_PAGA), 1, "consumida una vez por la RPC de siempre");
    assert.equal(sql(`select estado from public.reservas where id = ${Number(viejaPaga.json.reserva_id)}`), "activa");
  }
  console.log("OK — A3: un webhook de una compra vieja durante la transición consume por el camino de siempre, una vez.");

  // ═══ B. Se aplica la migración ════════════════════════════════════════════
  aplicar("db/cupones-retencion.sql");
  await esquema(true);
  console.log("B · migración aplicada.");

  const legado = (ref: string) => sql(`select coalesce((select estado || '|' || coalesce(nota, '') || '|' || con_pago from public.codigo_retenciones where external_reference = ${lit(ref)}), 'ninguna')`);
  // B1. Las pendientes con cupón limitado quedaron cubiertas; la pagada, no.
  {
    assert.equal(legado(`reserva_${viejaR.json.reserva_id}`), "retenido|legado|true");
    assert.equal(legado(`gift_card_${viejaG.json.grupo_compra_id}`), "retenido|legado|true");
    assert.equal(legado(`gift_card_${viejaSinPago.json.grupo_compra_id}`), "retenido|legado|true");
    assert.equal(legado(`gift_card_${viejaDoble.json.grupo_compra_id}`), "retenido|legado|true");
    assert.equal(legado(`reserva_${viejaPaga.json.reserva_id}`), "ninguna", "la ya pagada no se cubre");
    assert.equal(sql(`select preferencia_id from public.codigo_retenciones where external_reference = ${lit(`gift_card_${viejaG.json.grupo_compra_id}`)}`), String(viejaG.json.id), "con su preferencia");
  }
  console.log("OK — B1: al migrar, cada compra pendiente con cupón limitado recibe su retención 'legado'.");

  // B2. Una compra nueva no puede usar el cupón mientras la vieja pueda pagarse.
  {
    const r = await post(MP.POST, "/api/mercadopago/preference", reserva({ codigo_descuento: VIEJA_R }));
    assert.equal(r.json.codigo, "en_uso", JSON.stringify(r.json));
    assert.equal(sql(`select revision_motivo from public.codigo_retenciones where external_reference = ${lit(`reserva_${viejaR.json.reserva_id}`)}`), "preferencia_sin_vencimiento",
      "su link (anterior) no vence: queda retenida y para revisar");
  }
  console.log("OK — B2: con la compra vieja todavía pagable, el cupón sigue apartado (no se supera el límite).");

  // B3. El pago tardío de la compra vieja consume UNA vez, con su retención.
  {
    const p = pago(`reserva_${viejaR.json.reserva_id}`, "approved", Number(viejaR.json.total_final));
    assert.equal(await notificarReserva(p), 200);
    assert.equal(await notificarReserva(p), 200);
    assert.equal(usos(VIEJA_R), 1);
    assert.equal(legado(`reserva_${viejaR.json.reserva_id}`), "consumido|legado|true");
    assert.equal(sql(`select count(*) from public.usos_codigos_descuento where codigo = ${lit(VIEJA_R)}`), "1");
  }
  console.log("OK — B3: el pago tardío de una compra vieja consume una sola vez.");

  // B4. Una compra vieja que ya no se puede pagar (su preferencia venció) se libera, verificada.
  {
    const pref = prefs.find((p) => p.id === String(viejaSinPago.json.id))!;
    Object.assign(pref.body, { expires: true, expiration_date_to: new Date(Date.now() - 60 * 60_000).toISOString() });
    const r = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: VIEJA_SIN_PAGO }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(legado(`gift_card_${viejaSinPago.json.grupo_compra_id}`), "liberado|legado|true");
  }
  console.log("OK — B4: una compra vieja sin nada pagable se libera solo después de verificarlo en Mercado Pago.");

  // B5. El camino viejo ya contó el uso (instancia anterior procesando un pago
  // con la base nueva): la retención 'legado' no lo cuenta de nuevo.
  {
    const g = String(viejaDoble.json.grupo_compra_id);
    const p = pago(`gift_card_${g}`, "approved", 1);
    // Lo que hacía el webhook anterior: transición, RPC de siempre y su registro de uso.
    sql(`update public.gift_cards set estado_pago = 'pagado', mercado_pago_payment_id = ${lit(p)}, fecha_pago = now() where grupo_compra_id = ${lit(g)}`);
    assert.equal(sql(`select public.consumir_codigo_descuento(${lit(VIEJA_DOBLE)})`), "t", "hay cupo: 0 usos + 1 retención < 2");
    sql(`insert into public.usos_codigos_descuento (codigo_id, codigo, mercado_pago_payment_id)
         select id, codigo, ${lit(p)} from public.codigos_descuento where codigo = ${lit(VIEJA_DOBLE)}`);
    assert.equal(usos(VIEJA_DOBLE), 1);
    // Llega la notificación repetida a la aplicación nueva.
    assert.equal(await notificarGc(p), 200);
    assert.equal(usos(VIEJA_DOBLE), 1, "no se cuenta dos veces");
    assert.equal(sql(`select estado || '|' || nota from public.codigo_retenciones where grupo_compra_id = ${lit(g)}`), "consumido|ya_contado");
  }
  console.log("OK — B5: si el camino anterior ya contó ese pago, la retención queda consumida sin sumar otra vez.");

  // B6. Después de migrar, un cupón limitado nuevo funciona; otros módulos intactos.
  {
    const N = codigo(10, 1);
    const r = await post(GC.POST, "/api/gift-cards/preference", giftCard({ codigo_descuento: N }));
    assert.equal(r.status, 200);
    assert.equal(prefs[prefs.length - 1].body.expires, true);
    assert.equal(sql(`select md5(coalesce(string_agg(md5(e::text), '' order by e.id), '')) from public.empresa_codigos e`), empresasAntes, "códigos de Empresas intactos");
    assert.equal(sql(`select count(*) from public.codigo_retenciones r join public.codigos_descuento c on c.id = r.codigo_id where c.codigo not like ${lit(`${PREFIJO}%`)}`), "0", "ninguna retención fuera de esta prueba");
  }
  console.log("OK — B6: después de migrar, los cupones limitados nuevos usan su retención; Empresas no se tocó.");
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
       delete from public.reserva_slots where reserva_id in (select id from public.reservas where nombre = ${lit(`Reserva ${MARCA}`)});
       delete from public.reservas where nombre = ${lit(`Reserva ${MARCA}`)};
       delete from public.codigos_descuento where codigo in (${cs});
       commit;`);
  assert.equal(sql(`select count(*) from public.reservas where nombre = ${lit(`Reserva ${MARCA}`)}`), "0");
  assert.equal(sql(`select count(*) from public.codigos_descuento where codigo in (${cs})`), "0");
}

/** Pase lo que pase, la base local queda con la migración aplicada. */
function restaurar() {
  aplicar("db/cupones-retencion.sql");
  sql(`notify pgrst, 'reload schema';`);
}

main()
  .then(() => { limpiar(); restaurar(); console.log("Limpieza hecha; migración aplicada."); })
  .catch((e) => {
    console.error(e);
    try { restaurar(); limpiar(); } catch (err) { console.error("Limpieza/restauración falló:", err); }
    process.exit(1);
  });
