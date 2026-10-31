// GUARDIÁN: esta suite escribe en la base (siembra su escenario). Si el destino no es
// una base de pruebas aislada, el proceso aborta acá. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// Integración del CRM B4 (métricas) contra la instancia LOCAL aislada del CRM, por la
// ruta real /api/admin/crm/metricas:
//   · permisos (sin sesión, staff, comercial) y detalle inválido;
//   · escenario sembrado con las RPCs reales (visitas repetidas, teléfono por un
//     empleado, visita sin contacto, jornada sin visitas, venta con anticipo y saldo,
//     comisión generada y pagada, recompra de Administración sin jornada, venta
//     anulada, lead corrido 40 días para separar cohorte y actividad);
//   · conciliación por la API: cada cifra = su detalle, con y sin filtros;
//   · B4 solo lee: ninguna tabla del CRM cambia al consultar.
// Las fechas son relativas al «hoy» de la base: la suite no depende del calendario.
//
// Ejecutar: node scripts/pruebas/crm-local.mjs suite lib/crmB4.integration.ts

const MARCA = `zzcrmb4${Date.now().toString(36)}`;
const CONTENEDOR = process.env.SIM_TEST_CONTENEDOR_DB || "";
assert.match(CONTENEDOR, /^supabase_db_[a-z0-9-]+$/, "falta SIM_TEST_CONTENEDOR_DB (correr con scripts/pruebas/crm-local.mjs suite)");
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

function limpiar() {
  sql(`set session_replication_role = replica;
    create temp table zz_u as select id from public.crm_usuarios where usuario like 'zzcrmb4%';
    create temp table zz_e as select id from public.crm_empresas where nombre_comercial like 'zzcrmb4%' or responsable_id in (select id from zz_u);
    create temp table zz_o as select id from public.crm_oportunidades where empresa_id in (select id from zz_e);
    create temp table zz_s as select id from public.crm_ventas where empresa_id in (select id from zz_e);
    create temp table zz_v as select id from public.crm_visitas where empresa_id in (select id from zz_e);
    create temp table zz_x as select id from public.crm_actividades where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_seguimientos where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_contactos where empresa_id in (select id from zz_e)
      union all select id from public.crm_jornadas where usuario_id in (select id from zz_u)
      union all select id from public.crm_tareas where empresa_id in (select id from zz_e)
      union all select id from public.crm_cobros where venta_id in (select id from zz_s)
      union all select id from public.crm_comision_pagos where venta_id in (select id from zz_s);
    delete from public.crm_auditoria where entidad_id in (select id from zz_u union all select id from zz_e union all select id from zz_o
      union all select id from zz_v union all select id from zz_x union all select id from zz_s) or actor_usuario_id in (select id from zz_u);
    delete from public.crm_operaciones where oportunidad_id in (select id from zz_o);
    delete from public.crm_comision_pagos where venta_id in (select id from zz_s);
    delete from public.crm_cobros where venta_id in (select id from zz_s);
    delete from public.crm_ventas where id in (select id from zz_s);
    delete from public.crm_oportunidad_ciclos where oportunidad_id in (select id from zz_o);
    delete from public.crm_seguimientos where oportunidad_id in (select id from zz_o);
    delete from public.crm_actividades where oportunidad_id in (select id from zz_o);
    delete from public.crm_visita_notas where visita_id in (select id from zz_v);
    delete from public.crm_tareas where empresa_id in (select id from zz_e);
    delete from public.crm_oportunidades where id in (select id from zz_o);
    delete from public.crm_visitas where id in (select id from zz_v);
    delete from public.crm_contactos where empresa_id in (select id from zz_e);
    delete from public.crm_jornadas where usuario_id in (select id from zz_u);
    delete from public.crm_empresas where id in (select id from zz_e);
    delete from public.crm_usuarios where id in (select id from zz_u);`);
}

let ipN = 0;
const ip = () => `10.97.${Math.floor(++ipN / 250)}.${ipN % 250}`;
type J = Record<string, unknown>;
const o = (v: unknown) => v as J;
const arr = (v: unknown) => v as J[];

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
  const { CRM_COOKIE } = await import("@/lib/crmSesion");
  const { DEFINICIONES } = await import("@/lib/crmB4");
  const USUARIOS = await import("@/app/api/admin/crm/usuarios/route");
  const INGRESAR = await import("@/app/comercial/api/ingresar/route");
  const C = { jornadas: await import("@/app/comercial/api/jornadas/route"), visitas: await import("@/app/comercial/api/visitas/route") };
  const A = {
    metricas: await import("@/app/api/admin/crm/metricas/route"),
    negocios: await import("@/app/api/admin/crm/negocios/route"),
    jornadas: await import("@/app/api/admin/crm/jornadas/route"),
    venta: await import("@/app/api/admin/crm/oportunidades/[id]/venta/route"),
    ventaId: await import("@/app/api/admin/crm/ventas/[id]/route"),
    oportunidad: await import("@/app/api/admin/crm/oportunidades/[id]/route"),
    recompra: await import("@/app/api/admin/crm/negocios/[id]/recompra/route"),
  };
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");

  type Resp = { status: number; json: J; texto: string; setCookies: string[] };
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  async function http(h: unknown, metodo: string, url: string, op: { cookies?: Record<string, string>; body?: unknown; id?: string } = {}): Promise<Resp> {
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers: { "content-type": "application/json", "x-real-ip": ip(), origin: ORIGEN },
      body: op.body === undefined ? undefined : JSON.stringify(op.body) });
    const res = await almacen.run(new Map(Object.entries(op.cookies ?? {})), () => (h as Handler)(req, { params: Promise.resolve({ id: op.id ?? "" }) }));
    const texto = await res.text();
    let json: J = {};
    try { json = JSON.parse(texto); } catch { /* sin cuerpo JSON */ }
    return { status: res.status, json, texto, setCookies: res.headers.getSetCookie() };
  }
  const comoAdmin = { [ADMIN_COOKIE]: admin };
  const crearUsuario = async (sufijo: string, nombre: string) => {
    const usuario = `${MARCA}.${sufijo}`;
    const contrasena = `Clave-${randomBytes(9).toString("base64url")}`;
    const r = await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoAdmin, body: { usuario, nombre, contrasena } });
    assert.equal(r.status, 201, r.texto);
    const ing = await http(INGRESAR.POST, "POST", "/comercial/api/ingresar", { body: { usuario, contrasena } });
    const c = ing.setCookies.find((x) => x.startsWith(`${CRM_COOKIE}=`))!;
    return { id: String(o(r.json.usuario).id), nombre, cookies: { [CRM_COOKIE]: /^[^=]+=([^;]*)/.exec(c)![1] } };
  };
  const UA = await crearUsuario("tobias", `Tobías ${MARCA}`);
  const hoy = sql("select public.crm_fecha_sim(now())");
  const dia = (d: number) => sql(`select (${lit(hoy)}::date + ${d})::text`);
  const negocio = async (nombre: string) => {
    const r = await http(A.negocios.POST, "POST", "/api/admin/crm/negocios", { cookies: comoAdmin, body: { datos: { nombre_comercial: `${MARCA} ${nombre}`, responsable_id: UA.id } } });
    assert.equal(r.status, 201, r.texto);
    return String(r.json.id);
  };
  const jA = await http(C.jornadas.POST, "POST", "/comercial/api/jornadas", { cookies: UA.cookies, body: { datos: {} } });
  assert.equal(jA.status, 201, jA.texto);
  const JA = String(jA.json.id);
  const visita = async (datos: J) => {
    const r = await http(C.visitas.POST, "POST", "/comercial/api/visitas", { cookies: UA.cookies, body: { clave: randomUUID(), datos: { jornada_id: JA, ...datos } } });
    assert.equal(r.status, 201, r.texto);
    return r.json;
  };
  const tel = () => `+54 9 351 ${String(Math.floor(Math.random() * 9e6) + 1e6)}`;
  const version = (t: string, id: string) => Number(sql(`select version from public.${t} where id = ${lit(id)}`));
  const metricas = async (qs: string, cookies: Record<string, string> = comoAdmin) => http(A.metricas.GET, "GET", `/api/admin/crm/metricas?${qs}`, { cookies });
  const huellaTablas = () => sql(`select string_agg(t || ':' || n, ',' order by t) from (
      select 'visitas' t, count(*) n from public.crm_visitas union all select 'opp', count(*) from public.crm_oportunidades
      union all select 'ventas', count(*) from public.crm_ventas union all select 'cobros', count(*) from public.crm_cobros
      union all select 'pagos', count(*) from public.crm_comision_pagos union all select 'actividades', count(*) from public.crm_actividades
      union all select 'auditoria', count(*) from public.crm_auditoria union all select 'operaciones', count(*) from public.crm_operaciones
      union all select 'jornadas', count(*) from public.crm_jornadas union all select 'versiones', sum(version) from public.crm_oportunidades) x`);

  try {
    // ── 1) Permisos ──────────────────────────────────────────────────────
    for (const [cookies, esperado, quien] of [[{}, 401, "sin sesión"], [{ [ADMIN_COOKIE]: staff }, 403, "staff"], [UA.cookies, 401, "comercial"]] as const) {
      assert.equal((await metricas("preset=todo", cookies)).status, esperado, `tablero: ${quien}`);
      assert.equal((await metricas("preset=todo&detalle=importe_acordado", cookies)).status, esperado, `detalle: ${quien}`);
    }
    assert.equal((await metricas("detalle=inventado")).status, 400);

    // ── 2) Escenario ─────────────────────────────────────────────────────
    // N1: dos visitas el mismo día (la primera con contacto útil y decisor), venta con anticipo y saldo.
    const N1 = await negocio("Gimnasio");
    const v1 = await visita({ empresa_id: N1, hablo_con_responsable: true, contacto_obtenido: true, hablo_con_contacto: true,
      contacto_nuevo: { nombre: "Dueña", telefono: tel(), es_decisor: "si" }, interes: "tibio", necesidades: ["fidelizacion", "sorteos"] });
    const O1 = String(o(v1.oportunidad).id);
    await visita({ empresa_id: N1, hablo_con_empleado: true, necesidades: ["regalos"] });
    // N2: el empleado dio el teléfono del dueño (contacto útil, sin hablar con el decisor).
    const N2 = await negocio("Kiosco");
    const v2 = await visita({ empresa_id: N2, hablo_con_empleado: true, responsable_ausente: true, contacto_obtenido: true,
      contacto_nuevo: { nombre: "Dueño", telefono: tel(), es_decisor: "si" } });
    const O2 = String(o(v2.oportunidad).id);
    // N3: cerrado, sin contacto: visita sin lead.
    const N3 = await negocio("Cerrado");
    await visita({ empresa_id: N3, cerrado: true });
    // Jornada cargada por Administración para el mismo comercial, sin visitas ni km.
    const jv = await http(A.jornadas.POST, "POST", "/api/admin/crm/jornadas", { cookies: comoAdmin, body: { datos: { usuario_id: UA.id, fecha: dia(-1), nombre: `${MARCA} vacía` } } });
    assert.equal(jv.status, 201, jv.texto);
    sql(`update public.crm_jornadas set km_inicial = 100, km_final = 130, combustible_importe = 1500.50, estacionamiento_importe = 0, peajes_importe = 0, otros_importe = 0 where id = ${lit(JA)}`);
    // Venta de N1 (Pack 10), anticipo y saldo, comisión generada y pagada.
    const vr = await http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${O1}/venta`, { cookies: comoAdmin, id: O1, body: { clave: randomUUID(), version: version("crm_oportunidades", O1),
      datos: { producto: "pack_10", comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "40000.00", beneficiario_id: UA.id } } } });
    assert.equal(vr.status, 201, vr.texto);
    const V1 = String(o(vr.json.venta).id);
    const accion = (venta: string, ac: string, datos: J) => http(A.ventaId.POST, "POST", `/api/admin/crm/ventas/${venta}`,
      { cookies: comoAdmin, id: venta, body: { clave: randomUUID(), version: version("crm_ventas", venta), accion: ac, datos } });
    assert.equal((await accion(V1, "cobro", { fecha_efectiva: hoy, importe: "75000.00", medio: "efectivo", concepto: "anticipo" })).status, 201);
    assert.equal((await accion(V1, "cobro", { fecha_efectiva: hoy, importe: "75000.01", medio: "efectivo", concepto: "otro" })).json.codigo, "cobro_excede_saldo");
    assert.equal((await accion(V1, "cobro", { fecha_efectiva: hoy, importe: "74999.99", medio: "efectivo", concepto: "saldo" })).status, 201);
    assert.equal((await accion(V1, "cobro", { fecha_efectiva: hoy, importe: "0.01", medio: "efectivo", concepto: "saldo" })).status, 201);
    assert.equal((await accion(V1, "pago_comision", { fecha: hoy, importe: "40000.00" })).status, 201);
    // Recompra espontánea de Administración: venta sin jornada.
    const rc = await http(A.recompra.POST, "POST", `/api/admin/crm/negocios/${N1}/recompra`, { cookies: comoAdmin, id: N1, body: { clave: randomUUID(), datos: { contacto_id: String(v1.contacto_id) } } });
    assert.equal(rc.status, 201, rc.texto);
    const O1b = String(o(rc.json.oportunidad).id);
    const vr2 = await http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${O1b}/venta`, { cookies: comoAdmin, id: O1b, body: { clave: randomUUID(), version: version("crm_oportunidades", O1b),
      datos: { producto: "pack_10", comision: { tipo: "no_corresponde", fundamento: "recompra_espontanea" } } } });
    assert.equal(vr2.status, 201, vr2.texto);
    const V2 = String(o(vr2.json.venta).id);
    // N2: venta registrada y anulada (no cuenta).
    const vr3 = await http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${O2}/venta`, { cookies: comoAdmin, id: O2, body: { clave: randomUUID(), version: version("crm_oportunidades", O2),
      datos: { producto: "pack_10", comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "40000.00", beneficiario_id: UA.id } } } });
    const V3 = String(o(vr3.json.venta).id);
    assert.equal((await accion(V3, "anular", { motivo: "Cargada por error" })).status, 201);
    // N4: lead de hace 40 días (cohorte vieja) vendido hoy.
    const N4 = await negocio("Vieja");
    const v4 = await visita({ empresa_id: N4, hablo_con_responsable: true, contacto_obtenido: true, hablo_con_contacto: true,
      contacto_nuevo: { nombre: "Socio", telefono: tel(), es_decisor: "si" } });
    const O4 = String(o(v4.oportunidad).id);
    sql(`update public.crm_oportunidades set lead_en = lead_en - interval '40 days', ciclo_inicio_en = ciclo_inicio_en - interval '40 days' where id = ${lit(O4)};
         update public.crm_visitas set fecha = fecha - 40, ocurrida_en = ocurrida_en - interval '40 days' where id = ${lit(String(o(v4.visita).id))};`);
    const vr4 = await http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${O4}/venta`, { cookies: comoAdmin, id: O4, body: { clave: randomUUID(), version: version("crm_oportunidades", O4),
      datos: { producto: "pack_10", comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "40000.00", beneficiario_id: UA.id } } } });
    assert.equal(vr4.status, 201, vr4.texto);

    // ── 3) Cifras del escenario (filtro: el comercial de la prueba) ──────
    const deUA = `comercial=${UA.id}`;
    const hoyQ = `preset=personalizado&desde=${dia(-1)}&hasta=${hoy}&${deUA}`;
    const antes = huellaTablas();
    const t = await metricas(hoyQ);
    assert.equal(t.status, 200, t.texto);
    const m = o(t.json.metricas);
    const val = (id: string) => o(o(m[id]).valor);
    assert.equal(val("visitas").n, 4, "4 visitas (la del lead viejo quedó 40 días atrás)");
    assert.equal(val("negocios_visitados").n, 3, "dos visitas a N1 = un negocio");
    assert.equal(val("decisores").n, 1, "el teléfono por un empleado no es hablar con el decisor");
    assert.equal(val("leads").n, 2, "N1 y N2 (la de N3 no generó lead; la vieja es de otro período)");
    assert.equal(val("interesados").n, 1);
    assert.deepEqual([val("visitas_con_lead").num, val("visitas_con_lead").den], [2, 4]);
    assert.equal(val("ventas").n, 2, "V1 y la del lead viejo (atribuidas a este comercial); la anulada no; la recompra de Administración no tiene jornada ni comercial");
    assert.equal(val("cobrado").c, 15_000_000, "75.000 + 74.999,99 + 0,01: centavos exactos");
    assert.equal(val("comision_generada").c, 4_000_000);
    assert.equal(val("comision_pagada").c, 4_000_000);
    assert.equal(val("jornadas").n, 2, "incluye la jornada sin visitas");
    const js = arr(t.json.jornadas);
    const jVacia = js.find((j) => j.id === String(jv.json.id))!;
    assert.deepEqual([jVacia.visitas, jVacia.km, jVacia.movilidad], [0, null, null]);
    assert.ok((jVacia.pendientes as string[]).includes("km sin cargar"));
    const jLlena = js.find((j) => j.id === JA)!;
    assert.deepEqual([jLlena.km, jLlena.movilidad, jLlena.ventas], [30, 150_050, 2], "las ventas se atribuyen a la jornada de la visita de origen");
    // La eficiencia cuenta las visitas DE CADA JORNADA: también la del lead viejo, que la siembra corrió 40 días
    // por SQL pero sigue en esta jornada (en la realidad una visita es del día de su jornada o del siguiente).
    assert.deepEqual([val("km_por_visita").num, val("km_por_visita").den], [30, 5], "solo la jornada con km");
    assert.equal(o(o(m.km_por_visita).extra).pendientes, 1);
    // Cohorte vieja: el lead de hace 40 días es de su período, no de hoy.
    const viejo = await metricas(`preset=personalizado&desde=${dia(-41)}&hasta=${dia(-39)}&${deUA}`);
    assert.deepEqual([o(o(o(viejo.json.metricas).leads).valor).n, o(o(o(viejo.json.metricas).cohorte_ventas).valor).num, o(o(o(viejo.json.metricas).cohorte_ventas).valor).den], [1, 1, 1],
      "la venta de hoy cuenta para la cohorte de su lead");
    assert.equal(o(o(o(viejo.json.metricas).ventas).valor).n, 0, "y no como venta de ese período");
    // Sin jornada: la recompra de Administración (sin filtro de comercial, se busca por su id).
    const sinFiltro = await metricas(`preset=personalizado&desde=${dia(-1)}&hasta=${hoy}&detalle=ventas`);
    const fila = arr(sinFiltro.json.filas).find((x) => x.id === V2)!;
    assert.equal((fila.celdas as unknown[])[3], "Sin jornada");
    assert.ok(!arr(sinFiltro.json.filas).some((x) => x.id === V3), "la venta anulada no está");

    // ── 4) Conciliación por la API: cada cifra = su detalle ──────────────
    const columnaDe: Record<string, string> = {
      importe_acordado: "Importe acordado", experiencias: "Experiencias", saldo_actual: "Saldo hoy", cobrado: "Importe", comision_pagada: "Importe",
      cobros_menos_comisiones: "Importe", comision_generada: "Comisión pactada", comision_prevista: "Comisión pactada", comision_a_pagar: "A pagar hoy",
    };
    const porFilas = new Set(["leads", "ventas", "ventas_jornadas", "negocios_visitados", "responsables", "decisores", "visitas", "jornadas", "perdidas", "interesados", "recompras_admin"]);
    let chequeos = 0;
    for (const qs of [hoyQ, "preset=todo", `preset=todo&${deUA}`, `preset=90d&necesidad=sorteos`]) {
      const tb = await metricas(qs);
      assert.equal(tb.status, 200);
      for (const id of Object.keys(DEFINICIONES)) {
        const v = o(o(o(tb.json.metricas)[id]).valor);
        const d = await metricas(`${qs}&detalle=${id}`);
        assert.equal(d.status, 200, `${id}: ${d.texto.slice(0, 120)}`);
        const cols = arr(d.json.columnas);
        const tot = d.json.totales as unknown as Array<number | null>;
        if (columnaDe[id] && (v.tipo === "dinero" || v.tipo === "conteo")) {
          assert.equal(v.tipo === "dinero" ? v.c : v.n, tot[cols.findIndex((x) => x.titulo === columnaDe[id])], `${id} (${qs})`);
          chequeos++;
        } else if (v.tipo === "conteo" && porFilas.has(id)) {
          assert.equal(v.n, arr(d.json.filas).length, `${id} (${qs})`);
          chequeos++;
        }
      }
    }
    assert.equal(huellaTablas(), antes, "consultar el tablero y sus detalles no escribe nada");
    assert.ok(!/observacion|password|contrasena/i.test(t.texto), "sin notas ni secretos en la respuesta");
    console.log(`OK — crmB4 integración: permisos, escenario por RPCs reales, cohorte separada de la actividad, sin jornada, anulada fuera, ${chequeos} conciliaciones por la API y solo lectura.`);
  } finally {
    limpiar();
  }
}

main().catch((e) => {
  console.error(e);
  try { limpiar(); } catch { /* ya se informó el error principal */ }
  process.exit(1);
});
