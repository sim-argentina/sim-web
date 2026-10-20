// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// Marketing · casilla voluntaria de promociones en el checkout — las RUTAS reales
// de compra (Gift Cards y Reservas, pagas y 100 % bonificadas) contra el stack
// LOCAL, con Mercado Pago interceptado (no sale nada a la red). Comprueba:
//   · comprar sin marcar la casilla funciona igual y no registra nada;
//   · marcarla registra el texto, la versión, el origen y la compra como evidencia;
//   · si el registro falla (captación apagada, texto retirado, token roto), la
//     compra sale igual y la respuesta dice "no_registrada" (nada de confirmar);
//   · la Gift Card sigue venciendo a los 30 días y el Turnero no se toca.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/marketing/checkoutPromos.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const RUN = Date.now().toString(36);
const MARCA = `zzmktck_${RUN}`;
const V1 = `zzmktck-${RUN}-a`;
const V2 = `zzmktck-${RUN}-b`;
const CODIGO = `ZZMKT${RUN.toUpperCase()}`.slice(0, 20);
const base6 = String((Date.now() + 500_000) % 1_000_000).padStart(6, "0");
const usados = new Set<string>();
function tel(n: number): string {
  const t = `3519${String((Number(base6) + n) % 1_000_000).padStart(6, "0")}`;
  usados.add(t);
  return t;
}
const grupos: string[] = [];
const reservas: string[] = [];
/** El texto que estaba vigente antes de la corrida: se restaura SIEMPRE en limpiar(). */
let vigentePrevio = "";

{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-MKT-SIN-RED";
  process.env.NEXT_PUBLIC_BASE_URL = "https://mkt.invalid";
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const flag = (on: boolean) => { if (on) process.env.MARKETING_CONSENTIMIENTO_ENABLED = "true"; else delete process.env.MARKETING_CONSENTIMIENTO_ENABLED; };
  flag(true);

  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: () => undefined }) },
  } as unknown as NodeJS.Module;
  const { Preference } = await import("mercadopago");
  let preferencias = 0;
  (Preference.prototype as unknown as { create: (a: unknown) => Promise<unknown> }).create = async () => {
    preferencias++;
    return { id: `pref-${MARCA}-${preferencias}`, init_point: "https://mkt.invalid/pagar", sandbox_init_point: null };
  };

  const TEXTO = await import("@/app/api/promos/texto/route");
  const GC = await import("@/app/api/gift-cards/preference/route");
  const RESV = await import("@/app/api/reservas/route");
  const MP = await import("@/app/api/mercadopago/preference/route");
  const CATALOGO_GC = await import("@/app/api/gift-cards/catalogo/route");
  const { disponibilidadReservas } = await import("@/lib/reservasComercial");
  const { registrarPromosCheckout } = await import("@/lib/marketing/checkoutPromos");

  let ip = 0;
  type Resp = { status: number; json: Record<string, unknown> };
  async function post(h: unknown, ruta: string, body: unknown): Promise<Resp> {
    const req = new Request(`${ORIGEN}${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, "x-real-ip": `198.19.${Math.floor(++ip / 250)}.${(ip % 250) + 1}` },
      body: JSON.stringify(body),
    });
    const res = await (h as (r: Request) => Promise<Response>)(req);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }
  async function token(): Promise<{ texto_version: string; texto_huella: string; token: string }> {
    const res = await (TEXTO.GET as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}/api/promos/texto`, { headers: { "x-real-ip": `198.18.9.${++ip % 250}` } }));
    const d = (await res.json()) as { texto: { version: string; huella: string }; token: string };
    assert.equal(res.status, 200, "texto vigente");
    return { texto_version: d.texto.version, texto_huella: d.texto.huella, token: d.token };
  }
  const eventosDe = (t: string) => Number(sql(`select count(*) from public.mkt_consentimiento_eventos where telefono = ${lit(t)}`));
  const huellaTurnero = () => sql(`select md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) from public.turnos_stand t`);
  const huellaMensualidades = () => sql(`select md5(coalesce(string_agg(md5(m::text), '' order by md5(m::text)), '')) from public.mensualidades m`);
  const turneroAntes = huellaTurnero();
  const mensualidadesAntes = huellaMensualidades();

  // ── Fixtures: texto publicado y un código 100 % ───────────────────────────
  vigentePrevio = sql(`select coalesce((select version from public.mkt_textos_consentimiento where estado = 'vigente'), '')`);
  if (vigentePrevio) sql(`select public.mkt_texto_retirar(${lit(vigentePrevio)}, 'admin')`);
  sql(`insert into public.mkt_textos_consentimiento (version, titulo, texto, huella) values
       (${lit(V1)}, 'Prueba checkout A', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp (checkout ${RUN}, A).', ''),
       (${lit(V2)}, 'Prueba checkout B', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp (checkout ${RUN}, B).', '');
       select public.mkt_texto_publicar(${lit(V1)}, 'admin');
       insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
       values (${lit(CODIGO)}, ${lit(MARCA)}, 'porcentaje', 100, 50, 0, true, ${lit(MARCA)});`);

  // La oferta vigente, tal como la ve el navegador (sin importar el núcleo de modalidad).
  const catalogoGc = (await (await (CATALOGO_GC.GET as (r: Request) => Promise<Response>)(
    new Request(`${ORIGEN}/api/gift-cards/catalogo`, { headers: { "x-real-ip": "198.18.200.1" } }),
  )).json()) as {
    modalidad: string; productos: { duracion: number }[]; vigencia_dias: number;
  };
  assert.equal(catalogoGc.vigencia_dias, 30, "la vigencia pública de las Gift Cards sigue en 30 días");
  const modalidad = catalogoGc.modalidad;
  const producto = catalogoGc.productos[0];
  const giftCard = (telefono: string, extra: Record<string, unknown> = {}) => ({
    comprador_nombre: `Comprador ${MARCA}`, comprador_telefono: telefono, destinatario_nombre: null,
    duracion_minutos: producto.duracion, cantidad: 1, modo_uso: "separadas", modalidad_vista: modalidad, ...extra,
  });
  const registrarGrupo = (r: Resp) => { if (typeof r.json.grupo_compra_id === "string") grupos.push(r.json.grupo_compra_id); };

  // ── 1. Gift Card bonificada CON casilla: se registra, con su evidencia ────
  {
    const T = tel(1);
    const p = await token();
    const r = await post(GC.POST, "/api/gift-cards/preference", giftCard(T, { codigo_descuento: CODIGO, promos: { acepto: true, ...p } }));
    registrarGrupo(r);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.free, true);
    assert.equal(r.json.promos, "registrada");
    const ev = JSON.parse(sql(`select row_to_json(e) from public.mkt_consentimiento_eventos e where telefono = ${lit(T)}`)) as Record<string, unknown>;
    assert.equal(ev.fuente, "checkout_gift_card");
    assert.equal(ev.actor_rol, "publico");
    assert.equal(ev.texto_version, V1);
    assert.equal((ev.evidencia as Record<string, string>).grupo_compra_id, r.json.grupo_compra_id);
    assert.equal((ev.evidencia as Record<string, string>).pagina, "/gift-cards");
    assert.ok(ev.solicitado_en, "con el momento en que se mostró el texto");
    // La Gift Card es la de siempre: paga y con 30 días de vigencia.
    const gc = sql(`select estado_pago || '|' || round(extract(epoch from (fecha_vencimiento - fecha_pago)) / 86400) from public.gift_cards where grupo_compra_id = ${lit(String(r.json.grupo_compra_id))}`);
    assert.equal(gc, "pagado|30", "vigencia de 30 días intacta");
  }
  console.log("OK — 1: Gift Card bonificada con la casilla: compra normal y suscripción registrada con evidencia.");

  // ── 2. Sin casilla, o desmarcada: la compra sale y no se registra nada ────
  {
    for (const [n, extra] of [[2, {}], [3, { promos: { acepto: false } }], [4, { promos: { acepto: "true" } }]] as [number, Record<string, unknown>][]) {
      const T = tel(n);
      const r = await post(GC.POST, "/api/gift-cards/preference", giftCard(T, { codigo_descuento: CODIGO, ...extra }));
      registrarGrupo(r);
      assert.equal(r.status, 200);
      assert.equal(r.json.free, true, "la compra se hizo");
      assert.equal(r.json.promos, "no_solicitada");
      assert.equal(eventosDe(T), 0, `${JSON.stringify(extra)}: nadie queda anotado sin marcar la casilla`);
    }
  }
  console.log("OK — 2: comprar sin marcar la casilla funciona igual y no anota a nadie.");

  // ── 3. Si el registro falla, la compra sale igual y no se finge la suscripción ─
  {
    // Captación apagada.
    flag(false);
    const A = tel(5);
    let p = await (async () => { flag(true); const x = await token(); flag(false); return x; })();
    let r = await post(GC.POST, "/api/gift-cards/preference", giftCard(A, { codigo_descuento: CODIGO, promos: { acepto: true, ...p } }));
    registrarGrupo(r);
    assert.equal(r.status, 200);
    assert.equal(r.json.free, true);
    assert.equal(r.json.promos, "no_registrada");
    assert.equal(eventosDe(A), 0);
    flag(true);
    // Token alterado.
    const B = tel(6);
    p = await token();
    r = await post(GC.POST, "/api/gift-cards/preference", giftCard(B, { codigo_descuento: CODIGO, promos: { acepto: true, ...p, token: `${p.token.split(".")[0]}.${"A".repeat(32)}` } }));
    registrarGrupo(r);
    assert.equal(r.json.free, true);
    assert.equal(r.json.promos, "no_registrada");
    assert.equal(eventosDe(B), 0);
    // La base rechaza (texto retirado en el medio): falla del registro, no de la compra.
    const C = tel(7);
    p = await token();
    sql(`select public.mkt_texto_retirar(${lit(V1)}, 'admin')`);
    r = await post(GC.POST, "/api/gift-cards/preference", giftCard(C, { codigo_descuento: CODIGO, promos: { acepto: true, ...p } }));
    registrarGrupo(r);
    assert.equal(r.status, 200);
    assert.equal(r.json.free, true, "la compra se hizo");
    assert.equal(r.json.promos, "no_registrada", "y no se confirma una suscripción que no existe");
    assert.equal(eventosDe(C), 0);
    assert.equal(sql(`select estado_pago from public.gift_cards where grupo_compra_id = ${lit(String(r.json.grupo_compra_id))}`), "pagado");
    sql(`select public.mkt_texto_publicar(${lit(V2)}, 'admin')`);
  }
  console.log("OK — 3: con la captación apagada, un token roto o la base rechazando, la compra sale y la respuesta dice no_registrada.");

  // ── 4. Gift Card PAGA con casilla: preferencia de siempre + suscripción ───
  {
    const T = tel(8);
    const antes = preferencias;
    const r = await post(GC.POST, "/api/gift-cards/preference", giftCard(T, { promos: { acepto: true, ...(await token()) } }));
    registrarGrupo(r);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.init_point, "https://mkt.invalid/pagar");
    assert.equal(preferencias, antes + 1);
    assert.equal(r.json.promos, "registrada");
    assert.equal(sql(`select string_agg(distinct estado_pago, ',') from public.gift_cards where grupo_compra_id = ${lit(String(r.json.grupo_compra_id))}`), "pendiente_pago");
    assert.equal(sql(`select fuente || '|' || texto_version from public.mkt_consentimiento_eventos where telefono = ${lit(T)}`), `checkout_gift_card|${V2}`);
  }
  console.log("OK — 4: Gift Card paga con la casilla: preferencia normal y suscripción registrada.");

  // ── 5. Reservas: bonificada con casilla, paga sin casilla y paga con casilla ─
  {
    const disp = await disponibilidadReservas({ ahora: new Date() });
    assert.ok(disp.ok, "disponibilidad local");
    const d = disp.data;
    // Un mismo horario con tres simuladores libres: tres reservas que no se pisan.
    const h = d.horarios.find((x) => x.libres.length >= 3);
    assert.ok(h, "hace falta un horario con 3 simuladores libres en el stack local");
    const reserva = (simulador: string, telefono: string, extra: Record<string, unknown> = {}) => ({
      nombre: `Reserva ${MARCA}`, telefono, fecha: d.fecha, hora: h.hora, simuladores: [simulador], cantidad_turnos: 1,
      total: d.precio, acepto_condiciones: true, duracion_minutos: d.duracion, modalidad_vista: d.modalidad, precio_visto: d.precio, ...extra,
    });
    const libres = h.libres;

    // 5a. Bonificada (100 %), con casilla.
    const R1 = tel(9);
    const r1 = await post(RESV.POST, "/api/reservas", reserva(libres[0], R1, { codigo_descuento: CODIGO, promos: { acepto: true, ...(await token()) } }));
    if (r1.json.id) reservas.push(String(r1.json.id));
    assert.equal(r1.status, 201, JSON.stringify(r1.json));
    assert.equal(r1.json.estado, "activa");
    assert.equal(r1.json.promos, "registrada");
    const ev = JSON.parse(sql(`select row_to_json(e) from public.mkt_consentimiento_eventos e where telefono = ${lit(R1)}`)) as Record<string, unknown>;
    assert.equal(ev.fuente, "checkout_reserva");
    assert.equal((ev.evidencia as Record<string, string>).reserva_id, String(r1.json.id));
    assert.equal((ev.evidencia as Record<string, string>).pagina, "/reservas");

    // 5b. Paga, sin casilla: preferencia de siempre, nada registrado.
    const R2 = tel(10);
    const antes = preferencias;
    const r2 = await post(MP.POST, "/api/mercadopago/preference", reserva(libres[1], R2));
    if (r2.json.reserva_id) reservas.push(String(r2.json.reserva_id));
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    assert.equal(r2.json.init_point, "https://mkt.invalid/pagar");
    assert.equal(preferencias, antes + 1);
    assert.equal(r2.json.promos, "no_solicitada");
    assert.equal(eventosDe(R2), 0);
    assert.equal(sql(`select estado from public.reservas where id = ${Number(r2.json.reserva_id)}`), "pendiente_pago");

    // 5c. Paga, con casilla.
    const R3 = tel(11);
    const r3 = await post(MP.POST, "/api/mercadopago/preference", reserva(libres[2], R3, { promos: { acepto: true, ...(await token()) } }));
    if (r3.json.reserva_id) reservas.push(String(r3.json.reserva_id));
    assert.equal(r3.status, 200, JSON.stringify(r3.json));
    assert.equal(r3.json.promos, "registrada");
    assert.equal(sql(`select evidencia ->> 'reserva_id' from public.mkt_consentimiento_eventos where telefono = ${lit(R3)}`), String(r3.json.reserva_id));

    // 5d. Repetir el registro de la MISMA compra no duplica (clave derivada de la compra).
    const g = await token();
    const otraVez = await registrarPromosCheckout({
      body: { promos: { acepto: true, ...g } }, fuente: "checkout_reserva", telefono: R3, nombre: null,
      compra: { reserva_id: String(r3.json.reserva_id) }, ip: "198.18.0.1",
    });
    assert.equal(otraVez.estado, "no_registrada", "otro token = otro contenido con la misma clave: no se pisa el original");
    assert.equal(eventosDe(R3), 1);
  }
  console.log("OK — 5: Reservas bonificada y paga, con y sin casilla: la compra no cambia y la suscripción solo existe si se marcó.");

  assert.equal(huellaTurnero(), turneroAntes, "el Turnero no se tocó");
  assert.equal(huellaMensualidades(), mensualidadesAntes, "Mensualidades no se tocó");
  console.log("OK — 6: Turnero y Mensualidades intactos.");

}

function limpiar() {
  const tels = [...usados].map(lit).join(", ") || "''";
  const gs = grupos.map(lit).join(", ") || "''";
  const rs = reservas.filter((r) => /^\d+$/.test(r)).join(", ") || "-1";
  sql(`begin;
       set local session_replication_role = replica;
       delete from public.mkt_consentimiento_eventos where telefono in (${tels});
       delete from public.mkt_textos_consentimiento where version in (${lit(V1)}, ${lit(V2)});
       delete from public.gift_cards where grupo_compra_id::text in (${gs}) or comprador_nombre = ${lit(`Comprador ${MARCA}`)};
       delete from public.reserva_slots where reserva_id in (${rs});
       delete from public.usos_codigos_descuento where codigo = ${lit(CODIGO)};
       delete from public.reservas where id in (${rs}) or nombre = ${lit(`Reserva ${MARCA}`)};
       delete from public.codigos_descuento where codigo = ${lit(CODIGO)};
       ${vigentePrevio ? `update public.mkt_textos_consentimiento set estado = 'vigente', retirado_en = null, retirado_por_rol = null where version = ${lit(vigentePrevio)};` : ""}
       commit;`);
  assert.equal(sql(`select count(*) from public.mkt_consentimiento_eventos where telefono in (${tels})`), "0");
  assert.equal(sql(`select count(*) from public.reservas where nombre = ${lit(`Reserva ${MARCA}`)}`), "0");
  assert.equal(sql(`select count(*) from public.gift_cards where comprador_nombre = ${lit(`Comprador ${MARCA}`)}`), "0");
}

main()
  .then(() => { limpiar(); console.log("Limpieza hecha."); })
  .catch((e) => {
    console.error(e);
    try { limpiar(); } catch (err) { console.error("Limpieza falló:", err); }
    process.exit(1);
  });
