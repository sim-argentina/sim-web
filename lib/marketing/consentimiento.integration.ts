// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MENSAJE_ALTA_OK, MENSAJE_BAJA_OK } from "@/lib/marketing/consentimiento";

// Marketing · consentimiento y bajas — las RUTAS reales de Next contra el stack
// LOCAL (db/marketing-consentimiento.sql aplicado). Cubre: las dos llaves (entorno
// y texto vigente), formularios públicos sin filtrar si un número estaba anotado,
// evidencia sin IP, idempotencia, texto que cambia en el medio, trampa para bots,
// límite por IP, panel con sesión/rol/origen, alta del panel que no revierte una
// baja, permisos reales de PostgREST y que no se toca ninguna otra tabla.
//
// La sesión se firma con un secreto DESCARTABLE y next/headers se reemplaza por un
// almacén en memoria (mismo patrón que lib/interacciones.integration.ts). Los
// textos de prueba y la limpieza van por psql DENTRO del contenedor local.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/marketing/consentimiento.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const RUN = Date.now().toString(36);
const V1 = `zzmkt-${RUN}-a`;
const V2 = `zzmkt-${RUN}-b`;
// Teléfonos sintéticos de esta corrida: 3519 + 6 dígitos.
const base6 = String(Date.now() % 1_000_000).padStart(6, "0");
const usados = new Set<string>();
function tel(n: number): string {
  const t = `3519${String((Number(base6) + n) % 1_000_000).padStart(6, "0")}`;
  usados.add(t);
  return t;
}

{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

let vigentePrevio: string | null = null;

async function main() {
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }) },
  } as unknown as NodeJS.Module;
  const { createSessionToken } = await import("@/lib/adminSession");
  const staff = await createSessionToken("staff");
  const admin = await createSessionToken("admin");
  const TEXTO = await import("@/app/api/promos/texto/route");
  const ALTA = await import("@/app/api/promos/alta/route");
  const BAJA = await import("@/app/api/promos/baja/route");
  const PANEL = await import("@/app/api/admin/marketing/consentimientos/route");
  const TEXTOS = await import("@/app/api/admin/marketing/textos/route");
  const { registroParaAudiencia } = await import("@/lib/marketing/consentimientoServer");

  type Resp = { status: number; json: Record<string, unknown>; crudo: string };
  async function http(h: unknown, metodo: string, url: string, o: { token?: string; body?: unknown; origin?: string | null; ip?: string; crudo?: string } = {}): Promise<Resp> {
    cookie = o.token;
    // Una IP distinta por pedido salvo que la prueba fije una: el límite por IP se prueba aparte (11).
    const ip = o.ip ?? `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
    const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": ip };
    if (o.origin !== null) headers.origin = o.origin ?? ORIGEN;
    const body = o.crudo ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers, body });
    const res = await (h as (r: Request) => Promise<Response>)(req);
    const crudo = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(crudo); } catch { /* sin cuerpo */ }
    return { status: res.status, json, crudo };
  }
  const flag = (on: boolean) => { if (on) process.env.MARKETING_CONSENTIMIENTO_ENABLED = "true"; else delete process.env.MARKETING_CONSENTIMIENTO_ENABLED; };
  const estado = (t: string) => sql(`select coalesce((select estado || '|' || coalesce(alta_fuente, '-') from public.mkt_consentimiento_estado where telefono = ${lit(t)}), 'sin_registro')`);
  const eventos = (t: string) => Number(sql(`select count(*) from public.mkt_consentimiento_eventos where telefono = ${lit(t)}`));
  const huellaAjena = () => sql(`select md5(string_agg(h, '|' order by h)) from (
      select md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as h from public.turnos_stand t
      union all select md5(coalesce(string_agg(md5(r::text), '' order by md5(r::text)), '')) from public.reservas r
      union all select md5(coalesce(string_agg(md5(c::text), '' order by md5(c::text)), '')) from public.codigos_descuento c
      union all select md5(coalesce(string_agg(md5(g::text), '' order by md5(g::text)), '')) from public.gift_cards g
      union all select md5(coalesce(string_agg(md5(m::text), '' order by md5(m::text)), '')) from public.mensualidades m) x`);

  const ajenaAntes = huellaAjena();
  vigentePrevio = sql(`select coalesce((select version from public.mkt_textos_consentimiento where estado = 'vigente'), '')`) || null;
  if (vigentePrevio) sql(`select public.mkt_texto_retirar(${lit(vigentePrevio)}, 'admin')`);
  sql(`insert into public.mkt_textos_consentimiento (version, titulo, texto, huella) values
       (${lit(V1)}, 'Prueba A', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp (corrida ${RUN}, versión A).', ''),
       (${lit(V2)}, 'Prueba B', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp (corrida ${RUN}, versión B).', '')`);

  // ── 1. Llave de entorno apagada: lo público no existe; el panel sí ────────
  flag(false);
  assert.equal((await http(TEXTO.GET, "GET", "/api/promos/texto")).status, 404);
  assert.equal((await http(ALTA.POST, "POST", "/api/promos/alta", { body: {} })).status, 404);
  assert.equal((await http(BAJA.POST, "POST", "/api/promos/baja", { body: {} })).status, 404);
  {
    const r = await http(PANEL.GET, "GET", "/api/admin/marketing/consentimientos", { token: staff });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.modulo, { instalado: true, formulario_publico: false, texto_vigente: null });
  }
  console.log("OK — 1: con la llave apagada, /api/promos/* da 404 y el panel funciona.");

  // ── 2. Llave prendida sin texto vigente: altas cerradas, bajas abiertas ───
  flag(true);
  {
    const t = await http(TEXTO.GET, "GET", "/api/promos/texto");
    assert.equal(t.status, 503);
    assert.equal(t.json.codigo, "consentimiento_no_habilitado");
    const a = await http(ALTA.POST, "POST", "/api/promos/alta", {
      body: { idempotency_key: randomUUID(), telefono: tel(1), acepto: true, texto_version: V1, texto_huella: "a".repeat(64) },
    });
    assert.equal(a.status, 503);
    assert.equal(eventos(tel(1)), 0);
  }
  console.log("OK — 2: sin texto publicado no hay altas (503).");

  // ── 3. Textos: solo admin, con origen, y publicar es idempotente ──────────
  {
    assert.equal((await http(TEXTOS.GET, "GET", "/api/admin/marketing/textos")).status, 401);
    assert.equal((await http(TEXTOS.GET, "GET", "/api/admin/marketing/textos", { token: staff })).status, 403);
    const lista = await http(TEXTOS.GET, "GET", "/api/admin/marketing/textos", { token: admin });
    assert.equal(lista.status, 200);
    assert.ok((lista.json.textos as { version: string; estado: string }[]).some((t) => t.version === V1 && t.estado === "borrador"));
    assert.equal((await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: staff, body: { accion: "publicar", version: V1 } })).status, 403);
    assert.equal((await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, origin: "https://ajeno.example", body: { accion: "publicar", version: V1 } })).status, 403);
    assert.equal((await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, body: { accion: "editar", version: V1 } })).status, 400);
    const p = await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, body: { accion: "publicar", version: V1 } });
    assert.equal(p.status, 200);
    assert.equal((p.json.resultado as { estado: string }).estado, "vigente");
    const p2 = await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, body: { accion: "publicar", version: V1 } });
    assert.equal((p2.json.resultado as { sin_cambios: boolean }).sin_cambios, true);
    assert.equal((await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, body: { accion: "publicar", version: "zz-no-existe" } })).status, 404);
  }
  console.log("OK — 3: publicar/retirar textos es solo de admin, con control de origen.");

  // ── 4. El texto público: solo lo que hace falta mostrar y devolver ────────
  const t1 = await http(TEXTO.GET, "GET", "/api/promos/texto");
  assert.equal(t1.status, 200);
  const texto1 = t1.json.texto as { version: string; huella: string; titulo: string; texto: string };
  assert.deepEqual(Object.keys(texto1).sort(), ["huella", "texto", "titulo", "version"]);
  assert.equal(texto1.version, V1);
  assert.match(texto1.huella, /^[0-9a-f]{64}$/);
  console.log("OK — 4: el texto vigente sale con versión y huella, sin estado ni fechas.");

  // ── 5. Alta pública: genérica, idempotente, con evidencia y sin IP ────────
  const A = tel(2);
  {
    const cuerpo = { idempotency_key: randomUUID(), telefono: `+54 9 ${A.slice(0, 3)} ${A.slice(3, 6)}-${A.slice(6)}`, nombre: "  Prueba   Integración ", localidad: "Córdoba", acepto: true, texto_version: texto1.version, texto_huella: texto1.huella };
    assert.equal((await http(ALTA.POST, "POST", "/api/promos/alta", { body: { ...cuerpo, acepto: false } })).json.codigo, "falta_aceptacion");
    assert.equal((await http(ALTA.POST, "POST", "/api/promos/alta", { body: { ...cuerpo, telefono: "12345" } })).json.codigo, "telefono_invalido");
    assert.equal((await http(ALTA.POST, "POST", "/api/promos/alta", { body: { ...cuerpo, fuente: "admin_evidencia" } })).json.codigo, "campo_desconocido");
    assert.equal((await http(ALTA.POST, "POST", "/api/promos/alta", { origin: "https://ajeno.example", body: cuerpo })).status, 403);
    assert.equal((await http(ALTA.POST, "POST", "/api/promos/alta", { crudo: "{no es json" })).status, 400);
    assert.equal(eventos(A), 0, "nada se registró con los rechazos");

    const r = await http(ALTA.POST, "POST", "/api/promos/alta", { body: cuerpo, ip: "198.51.100.7" });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json, { ok: true, mensaje: MENSAJE_ALTA_OK }, "no dice nada del número");
    assert.equal(estado(A), "alta|formulario_web");
    const ev = JSON.parse(sql(`select row_to_json(e) from public.mkt_consentimiento_eventos e where telefono = ${lit(A)}`)) as Record<string, unknown>;
    assert.equal(ev.actor_rol, "publico");
    assert.equal(ev.nombre, "Prueba Integración");
    assert.equal(ev.texto_version, V1);
    assert.equal(ev.texto_huella, texto1.huella);
    const evid = ev.evidencia as Record<string, string>;
    assert.equal(evid.pagina, "/promos");
    assert.match(evid.ip_hash, /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(ev).includes("198.51.100.7"), "la IP no se guarda");

    const rep = await http(ALTA.POST, "POST", "/api/promos/alta", { body: cuerpo, ip: "198.51.100.99" });
    assert.equal(rep.status, 200, "el reintento desde otra red devuelve el original");
    assert.equal(eventos(A), 1);
    const otro = await http(ALTA.POST, "POST", "/api/promos/alta", { body: { ...cuerpo, telefono: tel(3) } });
    assert.equal(otro.status, 409);
    assert.equal(otro.json.codigo, "idempotency_key_con_otro_payload");
  }
  console.log("OK — 5: alta pública genérica, idempotente, con evidencia y sin guardar la IP.");

  // ── 6. Trampa para bots: misma respuesta, nada registrado ─────────────────
  {
    const B = tel(4);
    const r = await http(ALTA.POST, "POST", "/api/promos/alta", {
      body: { idempotency_key: randomUUID(), telefono: B, acepto: true, texto_version: texto1.version, texto_huella: texto1.huella, sitio: "https://spam.example" },
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json, { ok: true, mensaje: MENSAJE_ALTA_OK });
    assert.equal(eventos(B), 0);
  }
  console.log("OK — 6: el campo trampa no registra nada y responde igual.");

  // ── 7. El texto cambia mientras la persona lo lee → 409 con el texto nuevo ─
  {
    const p = await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, body: { accion: "publicar", version: V2 } });
    assert.equal((p.json.resultado as { retirado: string }).retirado, V1);
    const C = tel(5);
    const r = await http(ALTA.POST, "POST", "/api/promos/alta", {
      body: { idempotency_key: randomUUID(), telefono: C, acepto: true, texto_version: texto1.version, texto_huella: texto1.huella },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, "texto_desactualizado");
    assert.equal((r.json.texto as { version: string }).version, V2);
    assert.equal(eventos(C), 0);
  }
  console.log("OK — 7: con el texto cambiado, el alta vieja se rechaza y trae el texto nuevo.");

  // ── 8. Baja pública: siempre la misma respuesta; también sin alta previa ──
  {
    const D = tel(6);
    const r1 = await http(BAJA.POST, "POST", "/api/promos/baja", { body: { idempotency_key: randomUUID(), telefono: A } });
    const r2 = await http(BAJA.POST, "POST", "/api/promos/baja", { body: { idempotency_key: randomUUID(), telefono: D } });
    assert.equal(r1.status, 200);
    assert.equal(r1.crudo, r2.crudo, "anotado o no, la respuesta es idéntica");
    assert.deepEqual(r1.json, { ok: true, mensaje: MENSAJE_BAJA_OK });
    assert.equal(estado(A), "baja|-");
    assert.equal(estado(D), "baja|-", "lista de supresión");
    assert.equal((await http(BAJA.POST, "POST", "/api/promos/baja", { body: { idempotency_key: randomUUID(), telefono: D, nombre: "x" } })).status, 400);
    // El propio titular puede volver a anotarse.
    const t2 = (await http(TEXTO.GET, "GET", "/api/promos/texto")).json.texto as { version: string; huella: string };
    const r3 = await http(ALTA.POST, "POST", "/api/promos/alta", {
      body: { idempotency_key: randomUUID(), telefono: A, acepto: true, texto_version: t2.version, texto_huella: t2.huella },
    });
    assert.equal(r3.status, 201);
    assert.equal(estado(A), "alta|formulario_web");
  }
  console.log("OK — 8: la baja no revela nada, sirve como supresión y el titular puede volver.");

  // ── 9. Panel: sesión, rol, origen, consulta y cargas ──────────────────────
  {
    const E = tel(7);
    const F = tel(8);
    const D = tel(6);
    assert.equal((await http(PANEL.GET, "GET", "/api/admin/marketing/consentimientos")).status, 401);
    assert.equal((await http(PANEL.GET, "GET", "/api/admin/marketing/consentimientos?telefono=123", { token: staff })).json.codigo, "telefono_invalido");

    const g = await http(PANEL.GET, "GET", `/api/admin/marketing/consentimientos?telefono=${encodeURIComponent(`0${A.slice(0, 3)} 15 ${A.slice(3)}`)}`, { token: staff });
    assert.equal(g.status, 200);
    const consulta = g.json.consulta as { telefono: string; estado: { estado: string }; historial: unknown[] };
    assert.equal(consulta.telefono, A, "la consulta normaliza el número");
    assert.equal(consulta.estado.estado, "alta");
    assert.equal(consulta.historial.length, 3);
    const listado = JSON.stringify(g.json.recientes);
    for (const t of usados) assert.ok(!listado.includes(t), "los recientes van enmascarados");
    assert.ok(!listado.includes("Prueba Integración"), "y sin nombres");
    assert.equal((g.json.modulo as { texto_vigente: { version: string } }).texto_vigente.version, V2);

    const altaPanel = { accion: "alta", idempotency_key: randomUUID(), telefono: E, texto_version: V2, tipo_evidencia: "papel_firmado", referencia: `Planilla ${RUN}` };
    const s = await http(PANEL.POST, "POST", "/api/admin/marketing/consentimientos", { token: staff, body: altaPanel });
    assert.equal(s.status, 403);
    assert.equal(s.json.codigo, "solo_admin");
    assert.equal((await http(PANEL.POST, "POST", "/api/admin/marketing/consentimientos", { token: admin, origin: "https://ajeno.example", body: altaPanel })).status, 403);
    assert.equal((await http(PANEL.POST, "POST", "/api/admin/marketing/consentimientos", { token: admin, body: { ...altaPanel, referencia: "" } })).json.codigo, "campo_invalido");
    const a = await http(PANEL.POST, "POST", "/api/admin/marketing/consentimientos", { token: admin, body: altaPanel });
    assert.equal(a.status, 201);
    assert.equal(estado(E), "alta|admin_evidencia");

    const bajaStaff = await http(PANEL.POST, "POST", "/api/admin/marketing/consentimientos", {
      token: staff, body: { accion: "baja", idempotency_key: randomUUID(), telefono: F, canal: "presencial", nota: "lo pidió en el stand" },
    });
    assert.equal(bajaStaff.status, 201);
    assert.equal(estado(F), "baja|-");
    const revertir = await http(PANEL.POST, "POST", "/api/admin/marketing/consentimientos", {
      token: admin, body: { ...altaPanel, idempotency_key: randomUUID(), telefono: D },
    });
    assert.equal(revertir.status, 409);
    assert.equal(revertir.json.codigo, "baja_vigente", "un alta del panel no revierte una baja");
    assert.equal(estado(D), "baja|-");
  }
  console.log("OK — 9: el panel exige sesión, rol y origen; staff solo carga bajas; un alta del panel no tapa una baja.");

  // ── 10. Retirar el texto cierra las altas al instante; las bajas siguen ───
  {
    assert.equal((await http(TEXTOS.POST, "POST", "/api/admin/marketing/textos", { token: admin, body: { accion: "retirar", version: V2 } })).status, 200);
    assert.equal((await http(TEXTO.GET, "GET", "/api/promos/texto")).status, 503);
    const G = tel(9);
    const r = await http(ALTA.POST, "POST", "/api/promos/alta", { body: { idempotency_key: randomUUID(), telefono: G, acepto: true, texto_version: V2, texto_huella: "b".repeat(64) } });
    assert.equal(r.status, 503);
    assert.equal((await http(BAJA.POST, "POST", "/api/promos/baja", { body: { idempotency_key: randomUUID(), telefono: G } })).status, 200);
    assert.equal(estado(G), "baja|-");
  }
  console.log("OK — 10: retirar el texto es la pausa inmediata de las altas.");

  // ── 11. Límite por IP en las altas ────────────────────────────────────────
  {
    const ip = `192.0.2.${Number(base6) % 200 + 20}`;
    const codigos: number[] = [];
    for (let i = 0; i < 6; i++) {
      codigos.push((await http(ALTA.POST, "POST", "/api/promos/alta", { ip, body: { idempotency_key: randomUUID(), telefono: "12345" } })).status);
    }
    assert.deepEqual(codigos, [400, 400, 400, 400, 400, 429]);
  }
  console.log("OK — 11: más de 5 altas por minuto desde la misma IP → 429.");

  // ── 12. Permisos reales por PostgREST ─────────────────────────────────────
  {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    assert.ok(anonKey, "falta la anon key local");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey!, { auth: { persistSession: false } });
    const sel = await anon.from("mkt_consentimiento_eventos").select("telefono").limit(1);
    assert.ok(sel.error, "anon no lee eventos");
    const est = await anon.from("mkt_consentimiento_estado").select("telefono").limit(1);
    assert.ok(est.error, "anon no lee la vista");
    const rpc = await anon.rpc("mkt_consentimiento_registrar", { p_idempotency_key: randomUUID(), p_datos: { tipo: "baja", fuente: "formulario_web", telefono: tel(10) }, p_rol: "publico" });
    assert.ok(rpc.error, "anon no llama a la RPC");
    const ins = await supabaseAdmin.from("mkt_consentimiento_eventos").insert({
      idempotency_key: randomUUID(), huella: "x", telefono: tel(10), tipo: "baja", fuente: "formulario_web", actor_rol: "publico", ocurrido_en: new Date().toISOString(),
    });
    assert.ok(ins.error, "service_role no escribe directo: solo por la RPC");
    assert.equal(eventos(tel(10)), 0);
  }
  console.log("OK — 12: anon no ve ni escribe nada; service_role escribe solo por la RPC.");

  // ── 13. La audiencia lee el registro tal como quedó ───────────────────────
  {
    const r = await registroParaAudiencia();
    assert.ok(r.ok && r.valor.instalado);
    assert.equal(r.valor.consentimientos.get(tel(2)), "formulario_web");
    assert.equal(r.valor.consentimientos.get(tel(7)), "admin_evidencia");
    for (const t of [tel(6), tel(8), tel(9)]) assert.ok(r.valor.bajas.has(t) && !r.valor.consentimientos.has(t), `${t} es baja`);
  }
  console.log("OK — 13: la audiencia recibe altas (con su fuente) y bajas del registro.");

  assert.equal(huellaAjena(), ajenaAntes, "Turnero, Reservas, Códigos, Gift Cards y Mensualidades quedaron intactos");
  console.log("OK — 14: ninguna otra tabla de negocio cambió.");
}

function limpiar() {
  const tels = [...usados].map(lit).join(", ");
  sql(`begin;
       set local session_replication_role = replica;
       ${tels ? `delete from public.mkt_consentimiento_eventos where telefono in (${tels});` : ""}
       delete from public.mkt_textos_consentimiento where version in (${lit(V1)}, ${lit(V2)});
       ${vigentePrevio ? `update public.mkt_textos_consentimiento set estado = 'vigente', retirado_en = null, retirado_por_rol = null where version = ${lit(vigentePrevio)};` : ""}
       commit;`);
  const quedan = sql(`select count(*) from public.mkt_consentimiento_eventos where telefono in (${tels || "''"})`);
  assert.equal(quedan, "0", "limpieza: no quedaron eventos de la corrida");
}

main()
  .then(() => { limpiar(); console.log("Limpieza hecha."); })
  .catch((e) => {
    console.error(e);
    try { limpiar(); } catch (err) { console.error("Limpieza falló:", err); }
    process.exit(1);
  });
