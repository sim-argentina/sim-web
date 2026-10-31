// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// Integración LOCAL del CRM con Empresas B8 (código común; cupo en experiencias), por
// las rutas reales de Administración del CRM y las funciones reales de Empresas, con
// datos ficticios:
//   1. un negocio ficticio (cliente previo) con su contacto;
//   2. una recompra de Administración y la venta de un Pack 10 en el CRM;
//   3. un pack común de 10 en Empresas, con el código generado ANTES del pago (para
//      imprimir las tarjetas), vinculado a la venta;
//   4. el 50% al confirmar: el código sigue bloqueado;
//   5. el saldo y la entrega en el CRM: el CRM avisa que Empresas todavía figura
//      pendiente, y el código sigue bloqueado;
//   6. la activación en Empresas (pagada + inicio = entrega): canjea y vence a los
//      60 días;
//   7. reservas de 2 y de 1 simulador; cancelación de la de 2 con su reintento;
//   8. en cada paso, el detalle de la venta en el CRM muestra las experiencias
//      compradas, usadas y disponibles reales, sin datos de beneficiarios;
//   9. Finanzas intacto (conteos de fin_*) y la campaña de Empresas sin escrituras
//      del CRM.
// Ejecutar contra una instancia local con la cadena combinada (CRM + B8):
//   node <entorno local> suite lib/crmEmpresasB8.integration.ts
const MARCA = `zzcrmb8${Date.now().toString(36)}`;
const CONTENEDOR = process.env.SIM_TEST_CONTENEDOR_DB || "";
assert.match(CONTENEDOR, /^supabase_db_[a-z0-9-]+$/, "falta SIM_TEST_CONTENEDOR_DB");
const ORIGEN = "https://simexperience.com.ar";
{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const BENEF = { nombre: "ZZTEST", apellido: "B8CRM", telefono: "000", email: "zz@test.b8crm" };

function limpiar() {
  sql(`set session_replication_role = replica;
    create temp table zz_e as select id from public.crm_empresas where nombre_comercial like 'zzcrmb8%';
    create temp table zz_o as select id from public.crm_oportunidades where empresa_id in (select id from zz_e);
    create temp table zz_s as select id from public.crm_ventas where empresa_id in (select id from zz_e);
    delete from public.crm_auditoria where entidad_id in (select id from zz_e union all select id from zz_o union all select id from zz_s
      union all select id from public.crm_contactos where empresa_id in (select id from zz_e)
      union all select id from public.crm_cobros where venta_id in (select id from zz_s)
      union all select id from public.crm_actividades where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_seguimientos where oportunidad_id in (select id from zz_o));
    delete from public.crm_operaciones where oportunidad_id in (select id from zz_o);
    delete from public.crm_cobros where venta_id in (select id from zz_s);
    delete from public.crm_ventas where id in (select id from zz_s);
    delete from public.crm_actividades where oportunidad_id in (select id from zz_o);
    delete from public.crm_seguimientos where oportunidad_id in (select id from zz_o);
    delete from public.crm_oportunidad_ciclos where oportunidad_id in (select id from zz_o);
    delete from public.crm_oportunidades where id in (select id from zz_o);
    delete from public.crm_contactos where empresa_id in (select id from zz_e);
    delete from public.crm_empresas where id in (select id from zz_e);
    create temp table zz_r as select id from public.reservas where nombre = 'ZZTEST' and apellido = 'B8CRM'
      or empresa_campania_id in (select id from public.empresa_campanias where empresa like 'zzcrmb8%');
    delete from public.reserva_slots where reserva_id in (select id from zz_r);
    delete from public.reservas where id in (select id from zz_r);
    delete from public.empresa_campanias where empresa like 'zzcrmb8%';`);
}

// Todas las tablas fin_* que existan, con su cantidad de filas.
const FOTO_FINANZAS = `select string_agg(table_name || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', table_name), false, true, '')))[1]::text, ',' order by table_name)
  from information_schema.tables where table_schema = 'public' and left(table_name, 4) = 'fin_' and table_type = 'BASE TABLE'`;

type J = Record<string, unknown>;
const o = (v: unknown) => v as J;

async function main() {
  limpiar();
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.CRM_SESSION_SECRET = randomBytes(32).toString("hex");
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
  const almacen = new AsyncLocalStorage<Map<string, string>>();
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => {
      const jar = almacen.getStore() ?? new Map<string, string>();
      return { get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) };
    } },
  } as unknown as NodeJS.Module;

  const { createSessionToken, ADMIN_COOKIE } = await import("@/lib/adminSession");
  const E = await import("@/lib/empresasServer");
  const { catalogoEmpresasVigente } = await import("@/lib/empresasComercial");
  const { hoyEnSim } = await import("@/lib/agenda");
  const { sumarDias } = await import("@/lib/empresas");
  const A = {
    negocios: await import("@/app/api/admin/crm/negocios/route"),
    contactos: await import("@/app/api/admin/crm/negocios/[id]/contactos/route"),
    recompra: await import("@/app/api/admin/crm/negocios/[id]/recompra/route"),
    venta: await import("@/app/api/admin/crm/oportunidades/[id]/venta/route"),
    ventaId: await import("@/app/api/admin/crm/ventas/[id]/route"),
    campanias: await import("@/app/api/admin/crm/campanias/route"),
  };
  const comoAdmin = { [ADMIN_COOKIE]: await createSessionToken("admin") };
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let ipN = 0;
  async function http(h: unknown, metodo: string, url: string, op: { body?: unknown; id?: string } = {}) {
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers: { "content-type": "application/json", "x-real-ip": `10.97.0.${++ipN}`, origin: ORIGEN },
      body: op.body === undefined ? undefined : JSON.stringify(op.body) });
    const res = await almacen.run(new Map(Object.entries(comoAdmin)), () => (h as Handler)(req, { params: Promise.resolve({ id: op.id ?? "" }) }));
    const texto = await res.text();
    let json: J = {};
    try { json = JSON.parse(texto); } catch { /* sin cuerpo JSON */ }
    return { status: res.status, json, texto };
  }
  const versionVenta = (id: string) => Number(sql(`select version from public.crm_ventas where id = ${lit(id)}`));
  const accion = (venta: string, ac: string, datos: J = {}) => http(A.ventaId.POST, "POST", `/api/admin/crm/ventas/${venta}`,
    { id: venta, body: { clave: randomUUID(), version: versionVenta(venta), accion: ac, datos } });
  const detalle = async (venta: string) => {
    const r = await http(A.ventaId.GET, "GET", `/api/admin/crm/ventas/${venta}`, { id: venta });
    assert.equal(r.status, 200, r.texto);
    return r.json;
  };
  const campaniaEnCrm = async (venta: string) => o((await detalle(venta)).campania);
  const experienciasEnCrm = async (venta: string) => o((await campaniaEnCrm(venta)).experiencias);

  const hoy = hoyEnSim();
  const cat = await catalogoEmpresasVigente();
  assert.equal(cat.modalidad, "v2_10", "modalidad vigente v2_10 (experiencias de 20 minutos)");
  const dia = (() => { for (let i = 7; i < 20; i++) { const f = sumarDias(hoy, i); const w = new Date(`${f}T12:00:00Z`).getUTCDay(); if (w >= 1 && w <= 5) return f; } throw new Error("sin día"); })();
  const finAntes = sql(FOTO_FINANZAS);

  try {
    // ── 1-2) CRM: negocio, contacto, recompra y venta de un Pack 10 ─────────────
    const n = await http(A.negocios.POST, "POST", "/api/admin/crm/negocios", { body: { datos: { nombre_comercial: `${MARCA} Logística Andes`, cliente_previo: true } } });
    assert.equal(n.status, 201, n.texto);
    const N = String(n.json.id);
    const c = await http(A.contactos.POST, "POST", `/api/admin/crm/negocios/${N}/contactos`, { id: N, body: { datos: { nombre: "Encargada RR. HH.", es_decisor: "si" } } });
    assert.equal(c.status, 201, c.texto);
    const contacto = String(c.json.id);
    const rc = await http(A.recompra.POST, "POST", `/api/admin/crm/negocios/${N}/recompra`, { id: N, body: { clave: randomUUID(), datos: { contacto_id: contacto } } });
    assert.equal(rc.status, 201, rc.texto);
    const R = String(o(rc.json.oportunidad).id);
    const versionOp = Number(sql(`select version from public.crm_oportunidades where id = ${lit(R)}`));
    const rv = await http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${R}/venta`, { id: R, body: { clave: randomUUID(), version: versionOp,
      datos: { producto: "pack_10", comision: { tipo: "no_corresponde", fundamento: "recompra_espontanea" } } } });
    assert.equal(rv.status, 201, rv.texto);
    const V = String(o(rv.json.venta).id);
    assert.equal(sql(`select experiencias || '|' || duracion_minutos from public.crm_ventas where id = ${lit(V)}`), "10|20", "la venta: 10 experiencias de 20 minutos");

    // ── 3) Empresas: pack común de 10, código generado antes del pago ──────────
    const kc = await E.crearCampania({ empresa: `${MARCA} Logística Andes`, nombre_campania: "Pack 10", modalidad: "unica", cantidad_contratada: 10,
      duracion_minutos: 20, usos_por_codigo: 1, codigo_comun: true, precio_neto: 150000, iva_porcentaje: 21, modalidad_vista: cat.modalidad }, "admin");
    assert.ok(kc.ok, kc.ok ? "" : kc.error);
    const K = (kc.data as { id: string }).id;
    assert.ok((await E.generarCodigos(K)).ok, "genera el código común sin pago");
    const CODIGO = sql(`select codigo from public.empresa_codigos where campania_id = ${lit(K)}`);
    assert.equal(sql(`select count(*) || '|' || max(usos_maximos) from public.empresa_codigos where campania_id = ${lit(K)}`), "1|10");
    assert.equal((await accion(V, "vincular_campania", { campania_id: K })).status, 201);
    const huellaEmpresas = () => sql(`select updated_at::text || estado || estado_pago || coalesce(fecha_inicio::text, '-') from public.empresa_campanias where id = ${lit(K)}`);
    const antesDeVincular = huellaEmpresas();
    let k = await campaniaEnCrm(V);
    assert.equal(k.codigo_comun, true, "el CRM ve el código común");
    assert.deepEqual(o(k.experiencias), { contratadas: 10, usadas: 0, restantes: 10 }, "compradas 10, usadas 0, disponibles 10");
    assert.deepEqual(k.avisos, [], "cantidad y duración coinciden con la venta");
    assert.equal(k.fecha_vencimiento, null, "sin activación no hay vencimiento");
    assert.ok(!JSON.stringify(k).includes(CODIGO), "el CRM no lee el código en sí");

    // ── 4) 50% al confirmar: el código sigue bloqueado ────────────────────────
    assert.equal((await accion(V, "cobro", { fecha_efectiva: hoy, importe: "75000.00", medio: "transferencia", concepto: "anticipo" })).status, 201);
    assert.ok(!(await E.validarCodigo(CODIGO)).ok, "con el anticipo, bloqueado");

    // ── 5) Saldo y entrega en el CRM; Empresas todavía pendiente ───────────────
    assert.equal((await accion(V, "cobro", { fecha_efectiva: hoy, importe: "75000.00", medio: "transferencia", concepto: "saldo", confirmar_duplicado: true })).status, 201,
      "saldo igual al anticipo el mismo día: el CRM avisa el posible duplicado y se confirma");
    assert.equal((await accion(V, "entrega", { estado: "entregada", fecha: hoy })).status, 201);
    const v5 = o((await detalle(V)).venta);
    assert.deepEqual([v5.estado_cobro, o(v5.entrega).estado], ["cobrada", "entregada"]);
    k = await campaniaEnCrm(V);
    assert.ok((k.avisos as string[]).some((x) => x.includes("figura con el pago pendiente")), "el CRM avisa que falta registrar el pago en Empresas");
    assert.ok(!(await E.validarCodigo(CODIGO)).ok, "sin la activación en Empresas, bloqueado");
    assert.equal(huellaEmpresas(), antesDeVincular, "el CRM no escribe la campaña");

    // ── 6) Activación en Empresas: pagada + inicio = entrega → vence a los 60 días ─
    assert.ok((await E.marcarPagada(K, hoy, "transferencia")).ok);
    const act = await E.actualizarCampania(K, { fecha_inicio: hoy });
    assert.ok(act.ok, act.ok ? "" : act.error);
    assert.ok((await E.validarCodigo(CODIGO)).ok, "activado: canjea");
    k = await campaniaEnCrm(V);
    assert.deepEqual([k.estado, k.estado_pago, k.fecha_inicio, k.fecha_vencimiento], ["activa", "pagado", hoy, sumarDias(hoy, 60)]);
    assert.deepEqual(k.avisos, [], "cobro y pago coinciden");

    // ── 7) Reservas de 2 y de 1 simulador; cancelación con reintento ────────────
    const dos = await E.reservarConCodigo(CODIGO, BENEF, dia, "10:00", ["Ferrari", "McLaren"], `${MARCA}-dos`);
    assert.ok(dos.ok, dos.ok ? "" : dos.error);
    assert.ok((await E.reservarConCodigo(CODIGO, BENEF, dia, "10:30", ["Red Bull"], `${MARCA}-uno`)).ok);
    assert.deepEqual(await experienciasEnCrm(V), { contratadas: 10, usadas: 3, restantes: 7 }, "2 + 1 simuladores = 3 experiencias");
    const ridDos = (dos as { ok: true; data: { reserva_id: number } }).data.reserva_id;
    assert.ok((await E.cancelarReservaEmpresa(ridDos, true)).ok);
    assert.ok((await E.cancelarReservaEmpresa(ridDos, true)).ok, "reintento");
    assert.deepEqual(await experienciasEnCrm(V), { contratadas: 10, usadas: 1, restantes: 9 }, "vuelven las 2, una sola vez");
    assert.equal(sql(`select usos_actuales from public.empresa_codigos where campania_id = ${lit(K)}`), "1");
    k = await campaniaEnCrm(V);
    assert.ok(!/ZZTEST|B8CRM|zz@test/.test(JSON.stringify(k)), "sin datos de beneficiarios en el CRM");

    // ── 9) Finanzas intacto ───────────────────────────────────────────────────
    assert.equal(sql(FOTO_FINANZAS), finAntes, "ninguna escritura en fin_*");

    console.log("OK — CRM + Empresas B8: venta de Pack 10 en el CRM; pack común de 10 con el código generado antes del pago y vinculado; " +
      "bloqueado con el anticipo y con el saldo y la entrega registrados solo en el CRM (el CRM avisa el pago pendiente en Empresas); " +
      "activación en Empresas (pagada + inicio) con vencimiento a los 60 días; reservas de 2 y 1 simulador = 3 experiencias en el CRM; " +
      "cancelación con reintento devuelve 2 una sola vez; el CRM no escribe la campaña ni lee códigos ni beneficiarios; Finanzas intacto.");
  } finally {
    limpiar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
