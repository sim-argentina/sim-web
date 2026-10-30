// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// Integración del CRM B3 (ventas, cobros, comisiones y recompras) contra la
// instancia LOCAL aislada del CRM, con db/crm-b0..b3 aplicados. Por las rutas reales:
//   · permisos (sin sesión, staff, comercial) en todas las rutas de B3;
//   · Pack 10: Ramiro cierra un lead de Tobías (con otro responsable), anticipo,
//     duplicado avisado, saldo, comisión generada, pagos parcial y total, topes;
//   · Pack 25 con un cobro único; personalizado con comisión manual;
//   · recompra espontánea (Administración, sin comisión) y trabajada (visita de
//     otro comercial, comisión completa), sin reabrir la ganada;
//   · cambio de catálogo sin tocar ventas anteriores;
//   · doble venta, reintentos (secuenciales, en paralelo y tras respuesta incierta);
//   · cobros y pagos de comisión concurrentes con ventana real y control negativo;
//   · correcciones y anulaciones (cobros, pagos y la venta, con el conflicto de dos
//     abiertas); Ganado frente a B1/B2; ids cruzados;
//   · entrega y campaña de Empresas ficticia (solo lectura, sin modificarla);
//   · nada de ventas en respuestas comerciales; auditoría y errores sin detalles.
//
// Ejecutar: node scripts/pruebas/crm-local.mjs suite lib/crmB3.integration.ts

const MARCA = `zzcrmb3${Date.now().toString(36)}`;
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
    create temp table zz_u as select id from public.crm_usuarios where usuario like 'zzcrmb3%';
    create temp table zz_e as select id from public.crm_empresas where nombre_comercial like 'zzcrmb3%' or responsable_id in (select id from zz_u);
    create temp table zz_o as select id from public.crm_oportunidades where empresa_id in (select id from zz_e);
    create temp table zz_s as select id from public.crm_ventas where empresa_id in (select id from zz_e);
    create temp table zz_v as select id from public.crm_visitas where empresa_id in (select id from zz_e);
    create temp table zz_x as select id from public.crm_actividades where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_seguimientos where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_contactos where empresa_id in (select id from zz_e)
      union all select id from public.crm_jornadas where usuario_id in (select id from zz_u)
      union all select id from public.crm_tareas where empresa_id in (select id from zz_e)
      union all select id from public.crm_visita_notas where visita_id in (select id from zz_v)
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
    delete from public.crm_usuarios where id in (select id from zz_u);
    delete from public.empresa_codigos where campania_id in (select id from public.empresa_campanias where empresa like 'zzcrmb3%');
    delete from public.empresa_campanias where empresa like 'zzcrmb3%';`);
}

const respuestas: string[] = [];
const deComercial: string[] = [];
const secretos = new Set<string>();
let ipN = 0;
const ip = () => `10.98.${Math.floor(++ipN / 250)}.${ipN % 250}`;
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
  const S3 = await import("@/lib/crmB3Server");
  const USUARIOS = await import("@/app/api/admin/crm/usuarios/route");
  const INGRESAR = await import("@/app/comercial/api/ingresar/route");
  const C = {
    inicio: await import("@/app/comercial/api/inicio/route"),
    negocio: await import("@/app/comercial/api/negocios/[id]/route"),
    negocios: await import("@/app/comercial/api/negocios/route"),
    jornadas: await import("@/app/comercial/api/jornadas/route"),
    visitas: await import("@/app/comercial/api/visitas/route"),
  };
  const A = {
    seguimiento: await import("@/app/api/admin/crm/seguimiento/route"),
    oportunidad: await import("@/app/api/admin/crm/oportunidades/[id]/route"),
    negocios: await import("@/app/api/admin/crm/negocios/route"),
    negocio: await import("@/app/api/admin/crm/negocios/[id]/route"),
    visita: await import("@/app/api/admin/crm/visitas/[id]/route"),
    venta: await import("@/app/api/admin/crm/oportunidades/[id]/venta/route"),
    ventas: await import("@/app/api/admin/crm/ventas/route"),
    ventaId: await import("@/app/api/admin/crm/ventas/[id]/route"),
    compras: await import("@/app/api/admin/crm/negocios/[id]/compras/route"),
    recompra: await import("@/app/api/admin/crm/negocios/[id]/recompra/route"),
    productos: await import("@/app/api/admin/crm/productos/route"),
    campanias: await import("@/app/api/admin/crm/campanias/route"),
  };
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");

  type Resp = { status: number; json: J; texto: string; setCookies: string[] };
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  async function http(h: unknown, metodo: string, url: string, op: { cookies?: Record<string, string>; body?: unknown; id?: string; comercial?: boolean } = {}): Promise<Resp> {
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers: { "content-type": "application/json", "x-real-ip": ip(), origin: ORIGEN },
      body: op.body === undefined ? undefined : JSON.stringify(op.body) });
    const res = await almacen.run(new Map(Object.entries(op.cookies ?? {})), () => (h as Handler)(req, { params: Promise.resolve({ id: op.id ?? "" }) }));
    const texto = await res.text();
    respuestas.push(texto);
    if (op.comercial) deComercial.push(texto);
    let json: J = {};
    try { json = JSON.parse(texto); } catch { /* sin cuerpo JSON */ }
    return { status: res.status, json, texto, setCookies: res.headers.getSetCookie() };
  }
  const comoAdmin = { [ADMIN_COOKIE]: admin };
  const crearUsuario = async (sufijo: string, nombre: string) => {
    const usuario = `${MARCA}.${sufijo}`;
    const contrasena = `Clave-${randomBytes(9).toString("base64url")}`;
    secretos.add(contrasena);
    const r = await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoAdmin, body: { usuario, nombre, contrasena } });
    assert.equal(r.status, 201, r.texto);
    const ing = await http(INGRESAR.POST, "POST", "/comercial/api/ingresar", { body: { usuario, contrasena } });
    const c = ing.setCookies.find((x) => x.startsWith(`${CRM_COOKIE}=`))!;
    const token = /^[^=]+=([^;]*)/.exec(c)![1];
    secretos.add(token);
    return { id: String(o(r.json.usuario).id), nombre, cookies: { [CRM_COOKIE]: token } };
  };
  const UA = await crearUsuario("tobias", `Tobías ${MARCA}`);
  const UB = await crearUsuario("bruno", `Bruno ${MARCA}`);
  const hoy = sql("select public.crm_fecha_sim(now())");
  const dia = (d: number) => sql(`select (${lit(hoy)}::date + ${d})::text`);
  const catalogoOriginal = sql("select string_agg(codigo || '=' || coalesce(precio::text, 'null') || '/' || coalesce(comision_estandar::text, 'null') || '/' || activo, ',' order by codigo) from public.crm_productos");

  const negocioA = async (nombre: string, responsable = UA.id) => {
    const r = await http(A.negocios.POST, "POST", "/api/admin/crm/negocios", { cookies: comoAdmin, body: { datos: { nombre_comercial: `${MARCA} ${nombre}`, responsable_id: responsable } } });
    assert.equal(r.status, 201, r.texto);
    return String(r.json.id);
  };
  const jornada = async (u: typeof UA) => {
    const r = await http(C.jornadas.POST, "POST", "/comercial/api/jornadas", { cookies: u.cookies, body: { datos: {} }, comercial: true });
    assert.equal(r.status, 201, r.texto);
    return String(r.json.id);
  };
  const JA = await jornada(UA);
  const JB = await jornada(UB);
  const telefono = () => `+54 9 351 ${String(Math.floor(Math.random() * 9e6) + 1e6)}`;
  const visita = (u: typeof UA, datos: J) => http(C.visitas.POST, "POST", "/comercial/api/visitas",
    { cookies: u.cookies, body: { clave: randomUUID(), datos: { jornada_id: u === UA ? JA : JB, ...datos } }, comercial: true });
  /** Lead de una visita de Tobías, corrido 3 días atrás para poder fechar acuerdos y cobros en el pasado. */
  const lead = async (empresa: string) => {
    const r = await visita(UA, { empresa_id: empresa, hablo_con_responsable: true, contacto_obtenido: true, hablo_con_contacto: true,
      contacto_nuevo: { nombre: "Dueño", cargo: "Dueño", telefono: telefono(), es_decisor: "si" }, interes: "caliente", pack_potencial: "10" });
    assert.equal(r.status, 201, r.texto);
    const op = String(o(r.json.oportunidad).id);
    sql(`update public.crm_oportunidades set lead_en = lead_en - interval '3 days', ciclo_inicio_en = ciclo_inicio_en - interval '3 days' where id = ${lit(op)}`);
    return { op, visita: String(o(r.json.visita).id), contacto: String(r.json.contacto_id) };
  };
  const version = (id: string) => Number(sql(`select version from public.crm_oportunidades where id = ${lit(id)}`));
  const versionVenta = (id: string) => Number(sql(`select version from public.crm_ventas where id = ${lit(id)}`));
  const contar = (t: string, w: string) => Number(sql(`select count(*) from public.${t} where ${w}`));
  const estado = (id: string) => sql(`select estado from public.crm_oportunidades where id = ${lit(id)}`);
  type Extra = { clave?: string; version?: number; cookies?: Record<string, string> };
  const registrar = (op: string, datos: J, extra: Extra = {}) => http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${op}/venta`, {
    cookies: extra.cookies ?? comoAdmin, id: op, body: { clave: extra.clave ?? randomUUID(), version: extra.version ?? version(op), datos },
  });
  const accion = (venta: string, ac: string, datos: J = {}, extra: Extra = {}) => http(A.ventaId.POST, "POST", `/api/admin/crm/ventas/${venta}`, {
    cookies: extra.cookies ?? comoAdmin, id: venta, body: { clave: extra.clave ?? randomUUID(), version: extra.version ?? versionVenta(venta), accion: ac, datos },
  });
  const detalle = async (venta: string) => {
    const r = await http(A.ventaId.GET, "GET", `/api/admin/crm/ventas/${venta}`, { cookies: comoAdmin, id: venta });
    assert.equal(r.status, 200, r.texto);
    return r.json;
  };
  const ventaDe = async (venta: string) => o((await detalle(venta)).venta);
  const gestion = (id: string, ac: string, datos: J = {}) => http(A.oportunidad.POST, "POST", `/api/admin/crm/oportunidades/${id}`,
    { cookies: comoAdmin, id, body: { clave: randomUUID(), version: version(id), accion: ac, datos } });
  const pack10 = (beneficiario: string, extra: J = {}) => ({
    producto: "pack_10", fecha_acuerdo: dia(-2), comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "40000.00", beneficiario_id: beneficiario }, ...extra,
  });
  const cobro = (venta: string, importe: string, extra: J = {}, op: Extra = {}) =>
    accion(venta, "cobro", { fecha_efectiva: dia(-1), importe, medio: "transferencia", concepto: "otro", ...extra }, op);

  try {
    // ── 1) Permisos ──────────────────────────────────────────────────────
    const N1 = await negocioA("Gimnasio Central");
    const L1 = await lead(N1);
    {
      const id = L1.op;
      const casos: Array<[unknown, string, string, J | undefined]> = [
        [A.ventas.GET, "GET", "/api/admin/crm/ventas", undefined],
        [A.venta.GET, "GET", `/api/admin/crm/oportunidades/${id}/venta`, undefined],
        [A.venta.POST, "POST", `/api/admin/crm/oportunidades/${id}/venta`, { clave: randomUUID(), version: version(id), datos: pack10(UA.id) }],
        [A.ventaId.GET, "GET", `/api/admin/crm/ventas/${id}`, undefined],
        [A.ventaId.POST, "POST", `/api/admin/crm/ventas/${id}`, { clave: randomUUID(), version: 1, accion: "cobro", datos: {} }],
        [A.compras.GET, "GET", `/api/admin/crm/negocios/${N1}/compras`, undefined],
        [A.recompra.POST, "POST", `/api/admin/crm/negocios/${N1}/recompra`, { clave: randomUUID(), datos: { contacto_id: L1.contacto } }],
        [A.productos.GET, "GET", "/api/admin/crm/productos", undefined],
        [A.productos.PATCH, "PATCH", "/api/admin/crm/productos", { codigo: "pack_10", version: 1, cambios: { precio: "1.00" } }],
        [A.campanias.GET, "GET", "/api/admin/crm/campanias?q=x", undefined],
      ];
      for (const [cookies, esperado, quien] of [[{}, 401, "sin sesión"], [{ [ADMIN_COOKIE]: staff }, 403, "staff"], [UA.cookies, 401, "comercial"]] as const) {
        for (const [h, m, url, body] of casos) {
          const r = await http(h, m, url, { cookies, body, id: url.includes("/negocios/") ? N1 : id, comercial: quien === "comercial" });
          assert.equal(r.status, esperado, `${m} ${url}: ${quien} → ${r.status}`);
        }
      }
      assert.equal(contar("crm_ventas", `empresa_id = ${lit(N1)}`), 0, "nada se escribió sin permiso");
      assert.equal(sql("select precio::text from public.crm_productos where codigo = 'pack_10'"), catalogoOriginal.match(/pack_10=([^/]+)/)![1], "ni el catálogo");
      assert.equal((await http(A.ventaId.GET, "GET", `/api/admin/crm/ventas/${randomUUID()}`, { cookies: comoAdmin, id: randomUUID() })).status, 404);
      assert.equal((await registrar(randomUUID(), pack10(UA.id), { version: 1 })).status, 404, "oportunidad inexistente");
      assert.equal((await http(A.venta.POST, "POST", `/api/admin/crm/oportunidades/${id}/venta`, { cookies: comoAdmin, id, body: { version: version(id), datos: pack10(UA.id) } })).status, 400, "sin clave");
      assert.equal((await accion(randomUUID(), "inventada", {}, { version: 1 })).status, 400, "acción desconocida");
    }

    // ── 2) Pack 10: Ramiro cierra el lead de Tobías ──────────────────────
    let V1 = "";
    {
      // El negocio pasa a otro responsable: la comisión sigue siendo de quien originó el lead.
      const vEmp = Number(sql(`select version from public.crm_empresas where id = ${lit(N1)}`));
      assert.equal((await http(A.negocio.PATCH, "PATCH", `/api/admin/crm/negocios/${N1}`, { cookies: comoAdmin, id: N1, body: { version: vEmp, cambios: { responsable_id: UB.id } } })).status, 200);
      assert.equal((await gestion(L1.op, "programar", { vence_el: dia(2), descripcion: "Llamar para cerrar" })).status, 201);
      const f = await http(A.venta.GET, "GET", `/api/admin/crm/oportunidades/${L1.op}/venta`, { cookies: comoAdmin, id: L1.op });
      assert.equal(f.status, 200, f.texto);
      assert.equal(f.json.es_recompra, false);
      assert.deepEqual(o(o(f.json.propuestas).pack_10), { tipo: "pactada", fundamento: "origen_comercial", beneficiario_id: UA.id, importe: 4_000_000 });
      assert.equal(o(o(f.json.empresa).responsable).id, UB.id);
      const v0 = version(L1.op);
      assert.equal((await http(A.venta.GET, "GET", `/api/admin/crm/oportunidades/${L1.op}/venta`, { cookies: comoAdmin, id: L1.op })).status, 200);
      assert.equal(version(L1.op), v0, "consultar el formulario no escribe");

      const malResponsable = await registrar(L1.op, pack10(UB.id));
      assert.deepEqual([malResponsable.status, malResponsable.json.codigo], [409, "comision_origen"], "no al responsable actual");
      assert.equal((await registrar(L1.op, pack10(UA.id, { importe: "140000.00" }))).json.codigo, "confirmar_importe");
      assert.equal((await registrar(L1.op, pack10(UA.id, { importe: "140000.00", importe_confirmado: true }))).json.codigo, "confirmar_comision", "descuento → confirmar comisión");
      const centavos = await registrar(L1.op, pack10(UA.id, { importe: "150000.123" }));
      assert.deepEqual([centavos.status, centavos.json.campo], [400, "importe"]);
      assert.equal((await registrar(L1.op, pack10(UA.id, { importe: 150000.5 * 1.001 }))).json.campo, "importe", "un número con más de 2 decimales tampoco");
      assert.equal((await registrar(L1.op, pack10(UA.id, { experiencias: 12 }))).json.campo, "experiencias", "un pack no cambia su cantidad");
      assert.equal((await registrar(L1.op, pack10(UA.id, { fecha_acuerdo: dia(1) }))).json.campo, "fecha_acuerdo", "acuerdo futuro");
      assert.equal(contar("crm_ventas", `oportunidad_id = ${lit(L1.op)}`), 0, "los rechazos no dejan nada");

      const K = randomUUID();
      const vOp = version(L1.op);
      const r = await registrar(L1.op, pack10(UA.id, { observacion: `CIERRE-PRIVADO-${MARCA}` }), { clave: K, version: vOp });
      assert.equal(r.status, 201, r.texto);
      V1 = String(o(r.json.venta).id);
      assert.equal(estado(L1.op), "ganada");
      assert.equal(contar("crm_seguimientos", `oportunidad_id = ${lit(L1.op)} and estado = 'pendiente'`), 0, "el seguimiento de B2 se cierra");
      assert.equal(contar("crm_seguimientos", `oportunidad_id = ${lit(L1.op)} and cancelada_motivo = 'ganada'`), 1);
      assert.equal(contar("crm_visitas", `oportunidad_id = ${lit(L1.op)}`), 1, "las visitas quedan");
      assert.equal(sql(`select origen_usuario_id::text || '|' || public.crm_fecha_sim(lead_en)::text from public.crm_oportunidades where id = ${lit(L1.op)}`), `${UA.id}|${dia(-3)}`, "atribución y fechas quedan");
      const rep = await registrar(L1.op, pack10(UA.id, { observacion: `CIERRE-PRIVADO-${MARCA}` }), { clave: K, version: vOp });
      assert.deepEqual([rep.status, rep.json.repetida, o(rep.json.venta).id], [200, true, V1], "reintento: misma venta");
      assert.equal((await registrar(L1.op, pack10(UA.id), { clave: K, version: vOp })).json.codigo, "clave_reutilizada");
      assert.equal((await registrar(L1.op, pack10(UA.id), { version: vOp })).json.codigo, "version_desactualizada", "doble venta con la versión vieja");
      assert.equal((await registrar(L1.op, pack10(UA.id))).json.codigo, "oportunidad_ganada", "doble venta con la versión nueva");
      assert.equal(contar("crm_ventas", `oportunidad_id = ${lit(L1.op)}`), 1, "una sola venta");

      let v = await ventaDe(V1);
      assert.deepEqual([v.importe, v.anticipo_esperado, v.cobrado, v.estado_cobro], [15_000_000, 7_500_000, 0, "sin_cobros"]);
      assert.deepEqual([o(v.comision).estado, o(o(v.comision).beneficiario).id, o(v.comision).pactada], ["prevista", UA.id, 4_000_000]);
      assert.equal((await accion(V1, "pago_comision", { fecha: hoy, importe: "40000.00" })).json.codigo, "comision_no_generada");

      assert.equal((await cobro(V1, "75000.00", { concepto: "anticipo" })).status, 201);
      v = await ventaDe(V1);
      assert.deepEqual([v.cobrado, v.saldo, v.estado_cobro, o(v.comision).estado], [7_500_000, 7_500_000, "anticipo", "prevista"]);
      const dup = await cobro(V1, "75000.00", { concepto: "saldo" });
      assert.deepEqual([dup.status, dup.json.resultado], [200, "posible_duplicado"], "mismo importe y fecha: avisa");
      assert.equal(contar("crm_cobros", `venta_id = ${lit(V1)}`), 1, "el aviso no registra");
      assert.equal((await cobro(V1, "75000.01", { concepto: "saldo" })).json.codigo, "cobro_excede_saldo");
      assert.equal((await cobro(V1, "10.00", { fecha_efectiva: dia(-3) })).json.campo, "fecha_efectiva", "antes del acuerdo");
      assert.equal((await cobro(V1, "10.00", { fecha_efectiva: dia(1) })).json.campo, "fecha_efectiva", "en el futuro");
      assert.equal((await cobro(V1, "75000.00", { concepto: "saldo", confirmar_duplicado: true })).status, 201, "pago legítimo igual: se confirma");
      v = await ventaDe(V1);
      assert.deepEqual([v.cobrado, v.saldo, v.estado_cobro], [15_000_000, 0, "cobrada"]);
      assert.deepEqual([o(v.comision).estado, o(v.comision).pendiente], ["generada", 4_000_000], "cobrada por completo → comisión generada");
      assert.equal(sql(`select bool_and(registrado_en::date >= fecha_efectiva)::text from public.crm_cobros where venta_id = ${lit(V1)}`), "true", "fecha efectiva ≠ fecha de carga");
      assert.equal((await cobro(V1, "0.01")).json.codigo, "cobro_excede_saldo", "cobrada: nada más");

      assert.equal((await accion(V1, "pago_comision", { fecha: hoy, importe: "15000.00", referencia: "Transf. 1" })).status, 201);
      assert.equal(o((await ventaDe(V1)).comision).estado, "pagada_parcial");
      assert.equal((await accion(V1, "pago_comision", { fecha: hoy, importe: "25000.01" })).json.codigo, "pago_excede_comision");
      assert.equal((await accion(V1, "pago_comision", { fecha: hoy, importe: "25000.00" })).status, 201);
      v = await ventaDe(V1);
      assert.deepEqual([o(v.comision).estado, o(v.comision).pagado, o(v.comision).pendiente], ["pagada", 4_000_000, 0]);
      assert.equal(sql(`select string_agg(distinct beneficiario_id::text, ',') from public.crm_comision_pagos where venta_id = ${lit(V1)}`), UA.id, "pagos a quien originó");
      assert.equal((await accion(V1, "pago_comision", { fecha: hoy, importe: "0.01" })).json.codigo, "pago_excede_comision");
    }

    // ── 3) Pack 25 con un cobro único ────────────────────────────────────
    const N2 = await negocioA("Concesionaria Sur");
    const L2 = await lead(N2);
    let V2 = "";
    {
      const r = await registrar(L2.op, { producto: "pack_25", comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "90000.00", beneficiario_id: UA.id } });
      assert.equal(r.status, 201, r.texto);
      V2 = String(o(r.json.venta).id);
      assert.equal(sql(`select fecha_acuerdo::text from public.crm_ventas where id = ${lit(V2)}`), hoy, "sin fecha: hoy (Córdoba)");
      assert.equal((await accion(V2, "cobro", { fecha_efectiva: hoy, importe: "360000", medio: "efectivo", concepto: "otro" })).status, 201);
      const v = await ventaDe(V2);
      assert.deepEqual([v.experiencias, v.importe, v.cobrado, v.estado_cobro, o(v.comision).estado, o(v.comision).pendiente], [25, 36_000_000, 36_000_000, "cobrada", "generada", 9_000_000]);
    }

    // ── 4) Recompras ──────────────────────────────────────────────────────
    let R1 = "";
    let V3 = "";
    let R2 = "";
    let V4 = "";
    let visitaB = "";
    {
      // Espontánea: Administración crea la oportunidad con un contacto existente.
      assert.equal((await http(A.recompra.POST, "POST", `/api/admin/crm/negocios/${N1}/recompra`, { cookies: comoAdmin, id: N1, body: { clave: randomUUID(), datos: { contacto_id: L2.contacto } } })).json.codigo,
        "contacto_no_encontrado", "contacto de otro negocio");
      const N9 = await negocioA("Sin compras");
      assert.equal((await http(A.recompra.POST, "POST", `/api/admin/crm/negocios/${N9}/recompra`, { cookies: comoAdmin, id: N9, body: { clave: randomUUID(), datos: { contacto_id: L1.contacto } } })).json.codigo,
        "sin_compras_previas");
      const rc = await http(A.recompra.POST, "POST", `/api/admin/crm/negocios/${N1}/recompra`, { cookies: comoAdmin, id: N1,
        body: { clave: randomUUID(), datos: { contacto_id: L1.contacto, observacion: "Llamó para repetir", proxima: { vence_el: dia(1) } } } });
      assert.equal(rc.status, 201, rc.texto);
      R1 = String(o(rc.json.oportunidad).id);
      assert.notEqual(R1, L1.op);
      assert.equal(estado(L1.op), "ganada", "la ganada no se reabre");
      assert.equal(sql(`select origen_tipo || '|' || coalesce(origen_usuario_id::text, 'null') || '|' || contacto_id::text from public.crm_oportunidades where id = ${lit(R1)}`),
        `recompra_admin|null|${L1.contacto}`);
      assert.equal(contar("crm_contactos", `empresa_id = ${lit(N1)}`), 1, "usa el contacto existente");
      assert.equal((await http(A.recompra.POST, "POST", `/api/admin/crm/negocios/${N1}/recompra`, { cookies: comoAdmin, id: N1, body: { clave: randomUUID(), datos: { contacto_id: L1.contacto } } })).json.codigo,
        "otra_oportunidad_abierta");
      const b = await http(A.seguimiento.GET, "GET", `/api/admin/crm/seguimiento?q=${encodeURIComponent(MARCA)}&origen=admin`, { cookies: comoAdmin });
      assert.deepEqual(arr(b.json.filas).map((x) => x.id), [R1], "filtro «Administración (recompra)»");
      assert.equal(o(arr(b.json.filas)[0].origen).nombre, "Administración (recompra)");
      const f = await http(A.venta.GET, "GET", `/api/admin/crm/oportunidades/${R1}/venta`, { cookies: comoAdmin, id: R1 });
      assert.equal(f.json.es_recompra, true);
      assert.deepEqual(o(o(f.json.propuestas).pack_10), { tipo: "no_corresponde", fundamento: "recompra_espontanea", beneficiario_id: null, importe: null });
      assert.equal((await registrar(R1, pack10(UA.id, { fecha_acuerdo: dia(-1) }))).json.campo, "fecha_acuerdo", "no antes de que empiece la oportunidad");
      assert.equal((await registrar(R1, pack10(UA.id, { fecha_acuerdo: hoy }))).json.codigo, "comision_recompra", "en recompra no hay comisión de origen");
      const r = await registrar(R1, { producto: "pack_10", comision: { tipo: "no_corresponde", fundamento: "recompra_espontanea" } });
      assert.equal(r.status, 201, r.texto);
      V3 = String(o(r.json.venta).id);
      assert.equal(sql(`select es_recompra::text || '|' || comision_tipo || '|' || coalesce(comision_importe::text, 'null') from public.crm_ventas where id = ${lit(V3)}`), "true|no_corresponde|null");
      assert.equal((await accion(V3, "pago_comision", { fecha: hoy, importe: "1.00" })).json.codigo, "comision_no_corresponde");

      // Trabajada: Bruno (hoy responsable) visita al cliente; la visita abre una oportunidad nueva.
      const vb = await visita(UB, { empresa_id: N1, hablo_con_responsable: true, contacto_id: L1.contacto, contacto_obtenido: true, interes: "tibio" });
      assert.equal(vb.status, 201, vb.texto);
      R2 = String(o(vb.json.oportunidad).id);
      visitaB = String(o(vb.json.visita).id);
      assert.ok(R2 && R2 !== L1.op && R2 !== R1, "una visita a un cliente abre una oportunidad nueva");
      assert.equal(sql(`select origen_tipo || '|' || origen_usuario_id::text from public.crm_oportunidades where id = ${lit(R2)}`), `visita|${UB.id}`);
      const trabajada = (extra: J) => ({ producto: "pack_10", comision: { tipo: "pactada", fundamento: "recompra_trabajada", importe: "40000.00", beneficiario_id: UB.id, ...extra } });
      assert.equal((await registrar(R2, trabajada({}))).json.campo, "comision_intervencion", "sin intervención vinculada");
      assert.equal((await registrar(R2, trabajada({ intervencion_visita_id: L1.visita }))).json.campo, "comision_intervencion", "visita de otra oportunidad (id cruzado)");
      assert.equal((await registrar(R2, trabajada({ beneficiario_id: UA.id, intervencion_visita_id: visitaB }))).json.campo, "comision_intervencion", "visita de otra persona");
      const r2 = await registrar(R2, trabajada({ intervencion_visita_id: visitaB }));
      assert.equal(r2.status, 201, r2.texto);
      V4 = String(o(r2.json.venta).id);
      const d4 = await detalle(V4);
      assert.deepEqual([o(d4.venta).es_recompra, o(o(o(d4.venta).comision).beneficiario).id, o(o(d4.venta).comision).pactada, o(d4.intervencion).id], [true, UB.id, 4_000_000, visitaB]);
      const anu = await http(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${visitaB}`, { cookies: comoAdmin, id: visitaB,
        body: { accion: "anular", version: Number(sql(`select version from public.crm_visitas where id = ${lit(visitaB)}`)), motivo: "Prueba" } });
      assert.equal(anu.json.codigo, "visita_con_venta", "la visita que sostiene la comisión no se anula");
      const anuOrigen = await http(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${L1.visita}`, { cookies: comoAdmin, id: L1.visita,
        body: { accion: "anular", version: Number(sql(`select version from public.crm_visitas where id = ${lit(L1.visita)}`)), motivo: "Prueba" } });
      assert.equal(anuOrigen.json.codigo, "visita_con_venta", "ni la que originó una venta vigente");
    }

    // ── 5) Personalizado ──────────────────────────────────────────────────
    const N3 = await negocioA("Personalizado");
    const L3 = await lead(N3);
    {
      const pers = (extra: J, com: J = {}) => ({ producto: "personalizado", experiencias: 40, duracion_minutos: 20, importe: "520000.00", ...extra,
        comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "120000.00", beneficiario_id: UA.id, ...com } });
      assert.equal((await registrar(L3.op, pers({ experiencias: 25 }, { confirmada: true }))).json.campo, "experiencias", "más de 25");
      assert.equal((await registrar(L3.op, pers({}, { importe: "0" }))).json.campo, "comision_importe", "0 no es «sin definir»");
      assert.equal((await registrar(L3.op, pers({}, { importe: null }))).json.campo, "comision_importe", "pactada sin importe");
      assert.equal((await registrar(L3.op, pers({}))).json.codigo, "confirmar_comision", "comisión manual: confirmar");
      assert.equal((await registrar(L3.op, pers({}, { importe: "520000.01", confirmada: true }))).json.campo, "comision_importe", "no supera la venta");
      const r = await registrar(L3.op, pers({}, { confirmada: true }));
      assert.equal(r.status, 201, r.texto);
      const v = await ventaDe(String(o(r.json.venta).id));
      assert.deepEqual([v.experiencias, v.importe, o(v.comision).pactada, o(v.producto).codigo], [40, 52_000_000, 12_000_000, "personalizado"]);
    }

    // ── 6) Catálogo ───────────────────────────────────────────────────────
    {
      const p = arr((await http(A.productos.GET, "GET", "/api/admin/crm/productos", { cookies: comoAdmin })).json.productos);
      const p10 = p.find((x) => x.codigo === "pack_10")!;
      const cambio = await http(A.productos.PATCH, "PATCH", "/api/admin/crm/productos", { cookies: comoAdmin, body: { codigo: "pack_10", version: p10.version, cambios: { precio: "165000.00", comision_estandar: "45000.00" } } });
      assert.equal(cambio.status, 200, cambio.texto);
      assert.equal((await http(A.productos.PATCH, "PATCH", "/api/admin/crm/productos", { cookies: comoAdmin, body: { codigo: "pack_10", version: p10.version, cambios: { precio: "1.00" } } })).json.codigo,
        "version_desactualizada");
      const v1 = await detalle(V1);
      assert.deepEqual([o(v1.venta).importe, o(v1.venta).precio_catalogo, o(v1.venta).comision_catalogo, o(o(v1.venta).comision).pactada], [15_000_000, 15_000_000, 4_000_000, 4_000_000],
        "la venta anterior conserva sus condiciones");
      const N4 = await negocioA("Catálogo nuevo");
      const L4 = await lead(N4);
      const f = await http(A.venta.GET, "GET", `/api/admin/crm/oportunidades/${L4.op}/venta`, { cookies: comoAdmin, id: L4.op });
      assert.deepEqual(o(o(f.json.propuestas).pack_10).importe, 4_500_000, "la nueva propone la comisión nueva");
      assert.equal((await registrar(L4.op, pack10(UA.id))).json.codigo, "confirmar_comision", "la comisión vieja ya no es la de lista");
      const r = await registrar(L4.op, pack10(UA.id, { comision: { tipo: "pactada", fundamento: "origen_comercial", importe: "45000.00", beneficiario_id: UA.id } }));
      assert.equal(r.status, 201, r.texto);
      assert.equal(sql(`select importe::text || '|' || precio_catalogo::text from public.crm_ventas where id = ${lit(String(o(r.json.venta).id))}`), "165000.00|165000.00");
      sql(`update public.crm_productos set precio = 150000.00, comision_estandar = 40000.00 where codigo = 'pack_10'`);
    }

    // ── 7) Reintentos, respuesta incierta y concurrencia ─────────────────
    {
      // Reintentos simultáneos con la misma clave: una sola venta.
      const N5 = await negocioA("Reintentos");
      const L5 = await lead(N5);
      const K = randomUUID();
      const vv = version(L5.op);
      const par = await Promise.all(Array.from({ length: 6 }, () => registrar(L5.op, pack10(UA.id), { clave: K, version: vv })));
      assert.deepEqual(par.map((x) => x.status).sort(), [200, 200, 200, 200, 200, 201], "reintentos simultáneos: uno se registra");
      assert.equal(new Set(par.map((x) => o(x.json.venta).id)).size, 1);
      assert.equal(contar("crm_ventas", `oportunidad_id = ${lit(L5.op)}`), 1);
      // Dos pestañas con claves distintas a la vez: una gana.
      const N6 = await negocioA("Dos pestañas");
      const L6 = await lead(N6);
      const v6 = version(L6.op);
      const dos = await Promise.all([registrar(L6.op, pack10(UA.id), { version: v6 }), registrar(L6.op, pack10(UA.id), { version: v6 })]);
      assert.deepEqual(dos.map((x) => x.status).sort(), [201, 409]);
      assert.equal(contar("crm_ventas", `oportunidad_id = ${lit(L6.op)}`), 1);
      // Respuesta incierta: la venta llegó a la base pero la respuesta se perdió; la pantalla reintenta con la misma clave.
      const N7 = await negocioA("Incierta");
      const L7 = await lead(N7);
      const K7 = randomUUID();
      const v7 = version(L7.op);
      const perdida = await S3.registrarVenta(K7, L7.op, v7, pack10(UA.id));
      assert.ok(perdida.ok);
      const reintento = await registrar(L7.op, pack10(UA.id), { clave: K7, version: v7 });
      assert.deepEqual([reintento.status, reintento.json.repetida, o(reintento.json.venta).id], [200, true, perdida.ok ? perdida.valor.venta.id : null]);
      assert.equal(contar("crm_ventas", `oportunidad_id = ${lit(L7.op)}`), 1);
      // Cobro repetido por la misma clave (secuencial): una fila.
      const V5 = String(o(par.find((x) => x.status === 201)!.json.venta).id);
      const KC = randomUUID();
      assert.equal((await cobro(V5, "10000.00", {}, { clave: KC })).status, 201);
      const rc = await cobro(V5, "10000.00", {}, { clave: KC });
      assert.deepEqual([rc.status, rc.json.repetida], [200, true]);
      assert.equal(contar("crm_cobros", `operacion_clave = ${lit(KC)}`), 1);

      // Carrera real de cobros y de pagos de comisión: la auditoría espera 1 s ANTES del commit.
      const cadena = readFileSync("db/orden.txt", "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^crm-[a-z0-9-]+\.sql$/.test(l));
      const vigente = (nombre: string) => {
        for (const archivo of [...cadena].reverse()) {
          const t = readFileSync(`db/${archivo}`, "utf8").replace(/\r\n/g, "\n");
          const ini = t.indexOf(`create or replace function public.${nombre}(`);
          if (ini >= 0) return t.slice(ini, t.indexOf("\n$fn$;", ini) + 6);
        }
        throw new Error(`sin definición de ${nombre}`);
      };
      const b3 = readFileSync("db/crm-b3-ventas.sql", "utf8").replace(/\r\n/g, "\n");
      const triggerCobro = b3.slice(b3.indexOf("drop trigger if exists crm_ventas_verificar_cobro"), b3.indexOf("execute function public.crm_ventas_verificar();", b3.indexOf("create constraint trigger crm_ventas_verificar_cobro")) + 47);
      assert.match(triggerCobro, /^drop trigger if exists crm_ventas_verificar_cobro[\s\S]*crm_ventas_verificar\(\);$/);
      const ventana = () => sql(`create or replace function public.crm_auditar_entidad(p_rol text, p_usuario uuid, p_entidad text, p_id uuid, p_accion text, p_datos jsonb)
        returns void language plpgsql volatile set search_path = public as $fn$
        begin
          insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
          values (p_rol, p_usuario, p_entidad, p_id, p_accion, coalesce(p_datos, '{}'::jsonb));
          if p_accion in ('cobro', 'pago_comision') then perform pg_sleep(1); end if;
        end $fn$;`);
      const carreraCobros = async (venta: string) => {
        const t0 = Date.now();
        const r = await Promise.all(Array.from({ length: 6 }, () => cobro(venta, "30000.00", { confirmar_duplicado: true })));
        return { status: r.map((x) => x.status).sort(), cobrado: sql(`select public.crm_venta_cobrado(${lit(venta)})::text`), ms: Date.now() - t0 };
      };
      const carreraPagos = async (venta: string) => {
        const r = await Promise.all(Array.from({ length: 6 }, () => accion(venta, "pago_comision", { fecha: hoy, importe: "10000.00" })));
        return { status: r.map((x) => x.status).sort(), pagado: sql(`select public.crm_venta_comision_pagada(${lit(venta)})::text`) };
      };
      const N8 = await negocioA("Carrera");
      const VP = String(o((await registrar((await lead(N8)).op, pack10(UA.id))).json.venta).id);
      const NC = await negocioA("Control carrera");
      const VC = String(o((await registrar((await lead(NC)).op, pack10(UA.id))).json.venta).id);
      let pc: Awaited<ReturnType<typeof carreraCobros>>;
      let pp: Awaited<ReturnType<typeof carreraPagos>>;
      let cc: Awaited<ReturnType<typeof carreraCobros>>;
      let cp: Awaited<ReturnType<typeof carreraPagos>>;
      const auditarB1 = vigente("crm_auditar_entidad");
      try {
        ventana();
        pc = await carreraCobros(VP);
        pp = await carreraPagos(VP);
        // Control negativo: la misma función sin el FOR UPDATE de la venta y sin el
        // trigger diferido de cobros.
        const fn = vigente("crm_venta_gestionar");
        const sinBloqueo = fn.replace("select * into s from public.crm_ventas where id = p_venta for update;", "select * into s from public.crm_ventas where id = p_venta;");
        assert.notEqual(sinBloqueo, fn, "el control quita el bloqueo");
        sql(`drop trigger crm_ventas_verificar_cobro on public.crm_cobros;\n${sinBloqueo}`);
        cc = await carreraCobros(VC);
        // Se deja el control en $150.000 para que la comisión quede generada y correr la carrera de pagos.
        sql(`update public.crm_cobros set anulado_en = now(), anulado_motivo = 'control de carrera'
              where id = (select id from public.crm_cobros where venta_id = ${lit(VC)} and anulado_en is null order by registrado_en desc limit 1)`);
        cp = await carreraPagos(VC);
      } finally {
        sql(`update public.crm_comision_pagos set anulado_en = now(), anulado_motivo = 'control de carrera'
              where venta_id = ${lit(VC)} and anulado_en is null
                and id not in (select id from public.crm_comision_pagos where venta_id = ${lit(VC)} and anulado_en is null order by registrado_en limit 4);
              ${auditarB1}\n${vigente("crm_venta_gestionar")}\n${triggerCobro}`);
      }
      console.log(`  carrera de 6 cobros de $30.000 sobre $150.000: protegida → ${pc!.cobrado} (${pc!.status.join(",")}, ${pc!.ms} ms); control sin bloqueo ni trigger → ${cc!.cobrado}`);
      console.log(`  carrera de 6 pagos de $10.000 sobre $40.000 de comisión: protegida → ${pp!.pagado} (${pp!.status.join(",")}); control sin bloqueo → ${cp!.pagado}`);
      assert.equal(pc!.cobrado, "150000.00", "lo cobrado no supera el importe");
      assert.deepEqual(pc!.status, [201, 201, 201, 201, 201, 409]);
      assert.equal(pp!.pagado, "40000.00", "lo pagado no supera la comisión");
      assert.deepEqual(pp!.status, [201, 201, 201, 201, 409, 409]);
      assert.ok(Number(cc!.cobrado) > 150000, "el control sin protecciones cobra de más: la carrera es real");
      assert.ok(Number(cp!.pagado) > 40000, "el control sin bloqueo paga de más: la carrera es real");
      assert.match(sql("select pg_get_functiondef('public.crm_venta_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)'::regprocedure)"), /where id = p_venta for update/, "bloqueo restaurado");
      assert.equal(sql("select count(*) from pg_trigger where tgname = 'crm_ventas_verificar_cobro'"), "1", "trigger restaurado");
      assert.doesNotMatch(sql("select pg_get_functiondef('public.crm_auditar_entidad(text,uuid,text,uuid,text,jsonb)'::regprocedure)"), /pg_sleep/, "auditoría restaurada");
      assert.equal(o((await ventaDe(VC)).comision).estado, "pagada", "el control queda consistente tras anular los pagos de más");
    }

    // ── 8) Correcciones y anulaciones ────────────────────────────────────
    {
      // V4 (recompra trabajada de Bruno): cobro parcial, corrección y anulación.
      assert.equal((await cobro(V4, "50000.00", { fecha_efectiva: hoy })).status, 201);
      assert.equal((await accion(V4, "corregir", { motivo: "x", cambios: { importe: "40000.00", importe_confirmado: true,
        comision: { tipo: "pactada", fundamento: "recompra_trabajada", importe: "10000.00", beneficiario_id: UB.id, intervencion_visita_id: visitaB, confirmada: true } } })).json.codigo,
        "importe_menor_que_cobrado");
      assert.equal((await accion(V4, "corregir", { motivo: "Descuento acordado", cambios: { importe: "140000.00", importe_confirmado: true } })).json.codigo, "confirmar_comision",
        "cambiar el importe pide revisar la comisión");
      assert.equal((await accion(V4, "corregir", { cambios: { observacion: "x" } })).json.campo, "motivo");
      const corr = await accion(V4, "corregir", { motivo: "Descuento acordado", cambios: { importe: "140000.00", importe_confirmado: true,
        comision: { tipo: "pactada", fundamento: "recompra_trabajada", importe: "35000.00", beneficiario_id: UB.id, intervencion_visita_id: visitaB, confirmada: true } } });
      assert.equal(corr.status, 201, corr.texto);
      const d = await detalle(V4);
      assert.deepEqual([o(d.venta).importe, o(o(d.venta).comision).pactada, o(d.venta).precio_catalogo], [14_000_000, 3_500_000, 15_000_000], "la foto original queda");
      const h = arr(d.historial).find((x) => x.accion === "correccion")!;
      assert.equal(o(h.datos).motivo, "Descuento acordado");
      assert.equal(Number(o(o(h.datos).antes).importe), 150000);
      assert.equal(Number(o(o(h.datos).despues).importe), 140000);
      assert.equal((await accion(V4, "anular", { motivo: "Error" })).json.codigo, "venta_con_cobros");
      const cobroV1 = sql(`select id from public.crm_cobros where venta_id = ${lit(V1)} limit 1`);
      assert.equal((await accion(V4, "anular_cobro", { cobro_id: cobroV1, motivo: "x" })).json.codigo, "cobro_no_encontrado", "cobro de otra venta (id cruzado)");
      const pagoV1 = sql(`select id from public.crm_comision_pagos where venta_id = ${lit(V1)} limit 1`);
      assert.equal((await accion(V4, "anular_pago_comision", { pago_id: pagoV1, motivo: "x" })).json.codigo, "pago_no_encontrado", "pago de otra venta (id cruzado)");
      const c4 = sql(`select id from public.crm_cobros where venta_id = ${lit(V4)} and anulado_en is null`);
      assert.equal((await accion(V4, "anular_cobro", { cobro_id: c4 })).json.campo, "motivo");
      assert.equal((await accion(V4, "anular_cobro", { cobro_id: c4, motivo: "Se cargó en la venta equivocada" })).status, 201);
      assert.equal(contar("crm_cobros", `id = ${lit(c4)} and anulado_en is not null`), 1, "anulado, no borrado");
      const alGanar = sql(`select estado_al_ganar from public.crm_oportunidades where id = ${lit(R2)}`);
      assert.ok(["contacto", "conversacion", "interesado", "negociacion"].includes(alGanar), alGanar);
      const an = await accion(V4, "anular", { motivo: "Venta cargada por error" });
      assert.equal(an.status, 201, an.texto);
      assert.equal(estado(R2), alGanar, "la oportunidad vuelve a su etapa al ganar, abierta");
      assert.equal(sql(`select (cerrada_en is null)::text from public.crm_oportunidades where id = ${lit(R2)}`), "true");
      assert.equal((await cobro(V4, "1.00")).json.codigo, "venta_anulada");
      assert.equal(contar("crm_ventas", `id = ${lit(V4)}`), 1, "la venta anulada queda");
      // Con R2 abierta de nuevo, anular la venta de R1 dejaría dos abiertas.
      assert.equal((await accion(V3, "anular", { motivo: "Prueba" })).json.codigo, "otra_oportunidad_abierta");
      // V1 tiene cobros y pagos: hay que anularlos antes.
      assert.equal((await accion(V1, "anular", { motivo: "Prueba" })).json.codigo, "venta_con_cobros");
      const p1 = sql(`select id from public.crm_comision_pagos where venta_id = ${lit(V1)} and importe = 15000.00`);
      assert.equal((await accion(V1, "anular_pago_comision", { pago_id: p1 })).json.campo, "motivo");
      assert.equal((await accion(V1, "anular_pago_comision", { pago_id: p1, motivo: "Se pagó por otra vía" })).status, 201);
      assert.deepEqual([o((await ventaDe(V1)).comision).estado, o((await ventaDe(V1)).comision).pendiente], ["pagada_parcial", 1_500_000], "anular un pago vuelve a dejar pendiente");
      assert.equal((await accion(V1, "anular_pago_comision", { pago_id: p1, motivo: "otra vez" })).json.codigo, "sin_cambio");
      const lista = await http(A.ventas.GET, "GET", `/api/admin/crm/ventas?q=${encodeURIComponent(MARCA)}`, { cookies: comoAdmin });
      assert.ok(!arr(lista.json.filas).some((x) => x.id === V4), "la anulada no aparece por defecto");
      const conAnuladas = await http(A.ventas.GET, "GET", `/api/admin/crm/ventas?q=${encodeURIComponent(MARCA)}&anuladas=1`, { cookies: comoAdmin });
      assert.ok(arr(conAnuladas.json.filas).some((x) => x.id === V4 && x.anulada));
      assert.deepEqual(conAnuladas.json.totales, lista.json.totales, "las anuladas no suman");
      // Se vuelve a vender R2 (la venta anulada no bloquea).
      assert.equal((await registrar(R2, { producto: "pack_10", comision: { tipo: "no_corresponde", fundamento: "recompra_espontanea" } })).status, 201);
    }

    // ── 9) Ganado frente a B1/B2 ─────────────────────────────────────────
    {
      const abiertas = await http(A.seguimiento.GET, "GET", `/api/admin/crm/seguimiento?q=${encodeURIComponent(MARCA)}`, { cookies: comoAdmin });
      assert.ok(!arr(abiertas.json.filas).some((x) => x.estado === "ganada"), "las ganadas salen de los seguimientos abiertos");
      const suma = Object.values(o(abiertas.json.conteos)).reduce((a: number, b) => a + Number(b), 0);
      assert.equal(suma, abiertas.json.total, "contadores = total");
      const ganadas = await http(A.seguimiento.GET, "GET", `/api/admin/crm/seguimiento?q=${encodeURIComponent(MARCA)}&vista=ganadas`, { cookies: comoAdmin });
      assert.ok(arr(ganadas.json.filas).some((x) => x.id === L1.op), "pero siguen a mano en «Ganadas»");
      const d = await http(A.oportunidad.GET, "GET", `/api/admin/crm/oportunidades/${L1.op}`, { cookies: comoAdmin, id: L1.op });
      assert.equal(o(d.json.venta).id, V1, "el detalle enlaza la venta");
      assert.equal((await gestion(L1.op, "pausar", { retomar_el: dia(5) })).json.codigo, "oportunidad_ganada");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "llamada" })).json.codigo, "oportunidad_ganada");
      assert.equal((await gestion(L1.op, "perder", { motivo: "precio" })).json.codigo, "oportunidad_ganada");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "nota", observacion: "Mandó fotos del evento" })).status, 201, "una nota sí");
      assert.equal(estado(L1.op), "ganada");
    }

    // ── 10) Entrega y campaña de Empresas (ficticia, local) ──────────────
    {
      const camp = sql(`insert into public.empresa_campanias (empresa, nombre_campania, cantidad_contratada, duracion_minutos, usos_por_codigo, estado, estado_pago, fecha_inicio, created_by)
        values (${lit(`${MARCA} Concesionaria`)}, 'Clientes VIP', 10, 20, 1, 'activa', 'pagado', ${lit(hoy)}, 'prueba-crm') returning id`);
      sql(`insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales) values
        (${lit(camp)}, ${lit(`ZZ${MARCA}A`)}, 'disponible', 1, 0), (${lit(camp)}, ${lit(`ZZ${MARCA}B`)}, 'utilizado', 1, 1), (${lit(camp)}, ${lit(`ZZ${MARCA}C`)}, 'disponible', 1, 0)`);
      const antes = sql(`select updated_at::text || estado || estado_pago from public.empresa_campanias where id = ${lit(camp)}`);
      const busca = await http(A.campanias.GET, "GET", `/api/admin/crm/campanias?q=${encodeURIComponent(MARCA)}`, { cookies: comoAdmin });
      assert.ok(arr(busca.json.campanias).some((x) => x.id === camp && x.vinculada_a === null));
      assert.equal((await accion(V2, "vincular_campania", { campania_id: randomUUID() })).json.codigo, "campania_no_encontrada");
      assert.equal((await accion(V2, "vincular_campania", { campania_id: camp })).status, 201);
      const d = await detalle(V2);
      const k = o(d.campania);
      assert.deepEqual([o(k.codigos).generados, o(k.codigos).utilizados, k.usos, k.fecha_vencimiento, k.estado], [3, 1, 0, null, "activa"]);
      assert.ok(arr(k.avisos).some((x) => String(x).includes("10 turnos") && String(x).includes("25 experiencias")), "avisa la diferencia de cantidad");
      assert.ok(!JSON.stringify(k).includes(`ZZ${MARCA}`), "no se leen los códigos en sí");
      assert.equal((await accion(V1, "vincular_campania", { campania_id: camp })).json.codigo, "campania_vinculada", "una campaña, una venta vigente");
      const busca2 = await http(A.campanias.GET, "GET", `/api/admin/crm/campanias?q=${encodeURIComponent(MARCA)}`, { cookies: comoAdmin });
      assert.equal(o(arr(busca2.json.campanias).find((x) => x.id === camp)!.vinculada_a).venta_id, V2);
      assert.equal(sql(`select updated_at::text || estado || estado_pago from public.empresa_campanias where id = ${lit(camp)}`), antes, "la campaña no se modifica");
      assert.equal((await accion(V2, "entrega", { estado: "entregada" })).json.campo, "fecha");
      assert.equal((await accion(V2, "entrega", { estado: "entregada", fecha: dia(1) })).json.campo, "fecha", "entrega futura");
      assert.equal((await accion(V2, "entrega", { estado: "entregada", fecha: hoy, detalle: "A la encargada" })).status, 201);
      const v2 = await ventaDe(V2);
      assert.deepEqual(o(v2.entrega), { estado: "entregada", fecha: hoy });
      assert.deepEqual(v2.pendientes, ["comision"], "entregada y cobrada: solo falta pagar la comisión");
      const sinCamp = await detalle(V1);
      assert.equal(sinCamp.campania, null, "sin campaña: vencimiento sin definir");
    }

    // ── 11) Ficha: compras ────────────────────────────────────────────────
    {
      const c = await http(A.compras.GET, "GET", `/api/admin/crm/negocios/${N1}/compras`, { cookies: comoAdmin, id: N1 });
      assert.equal(c.status, 200, c.texto);
      const r = o(c.json.resumen);
      assert.equal(r.compras, 3, "V1, V3 y la nueva de R2 (la anulada no cuenta)");
      assert.equal(r.cobradas, 1, "solo V1 está cobrada por completo");
      assert.equal(r.acordado, 45_000_000);
      assert.equal(r.cobrado, 15_000_000);
      assert.equal(c.json.cliente_previo, false);
      assert.equal(o(c.json.recompra).posible, true, "sin abiertas: se puede crear otra recompra");
      assert.equal(arr(c.json.ventas).length, 4, "la anulada se lista, marcada");
    }

    // ── 12) Comercial: nada de ventas ─────────────────────────────────────
    {
      const fUB = await http(C.negocio.GET, "GET", `/comercial/api/negocios/${N1}`, { cookies: UB.cookies, id: N1, comercial: true });
      assert.equal(fUB.status, 200);
      assert.ok(arr(fUB.json.oportunidades).every((x) => x.estado !== "ganada"), "el comercial no ve las ganadas");
      await http(C.inicio.GET, "GET", "/comercial/api/inicio", { cookies: UA.cookies, comercial: true });
      await http(C.negocios.GET, "GET", "/comercial/api/negocios", { cookies: UB.cookies, comercial: true });
      await http(C.negocio.GET, "GET", `/comercial/api/negocios/${N2}`, { cookies: UA.cookies, id: N2, comercial: true });
      const todo = deComercial.join("\n");
      // (Las jornadas tienen gastos con «_importe»: se buscan claves exactas.)
      for (const prohibido of [`CIERRE-PRIVADO-${MARCA}`, '"ganada"', '"importe"', "comision", '"cobrado"', "estado_cobro", "crm_ventas", "Clientes VIP", "Venta registrada"]) {
        assert.ok(!todo.includes(prohibido), `una respuesta comercial incluye «${prohibido}»`);
      }
    }

    // ── 13) Auditoría y errores ───────────────────────────────────────────
    {
      const acc = (entidad: string) => sql(`select coalesce(string_agg(distinct accion, ',' order by accion), '') from public.crm_auditoria a
        where entidad = ${lit(entidad)} and entidad_id in (select id from public.crm_ventas where empresa_id in (select id from public.crm_empresas where nombre_comercial like ${lit(`${MARCA}%`)})
          union all select id from public.crm_cobros where venta_id in (select id from public.crm_ventas where empresa_id in (select id from public.crm_empresas where nombre_comercial like ${lit(`${MARCA}%`)}))
          union all select id from public.crm_comision_pagos where venta_id in (select id from public.crm_ventas where empresa_id in (select id from public.crm_empresas where nombre_comercial like ${lit(`${MARCA}%`)})))`);
      assert.deepEqual(acc("crm_ventas").split(","), ["anulacion", "correccion", "creacion", "entrega", "vinculo_campania"]);
      assert.deepEqual(acc("crm_cobros").split(","), ["anulacion", "cobro"]);
      assert.deepEqual(acc("crm_comision_pagos").split(","), ["anulacion", "pago_comision"]);
      assert.equal(contar("crm_auditoria", `entidad = 'crm_oportunidades' and accion = 'ganada' and entidad_id = ${lit(L1.op)} and actor_rol = 'admin'`), 1);
      assert.equal(contar("crm_auditoria", `entidad in ('crm_ventas', 'crm_cobros', 'crm_comision_pagos') and actor_rol <> 'admin' and en > now() - interval '1 hour'`), 0, "solo Administración");
      assert.equal(contar("crm_auditoria", `entidad in ('crm_ventas', 'crm_cobros', 'crm_comision_pagos') and datos::text ~ '\\+54 9 351'`), 0, "sin teléfonos");
      for (const t of respuestas) assert.ok(!/violates|constraint|relation "|PGRST|syntax error|plpgsql|duplicate key|integridad_ventas/i.test(t), `detalle interno: ${t.slice(0, 160)}`);
      for (const s of secretos) assert.ok(!respuestas.some((t) => t.includes(s)), "ningún secreto en respuestas");
    }

    console.log("OK — crmB3 integración: permisos, Pack 10 (Ramiro cierra un lead de Tobías) con anticipo/saldo/comisión y pagos, Pack 25, personalizado, recompras espontánea y trabajada, catálogo, reintentos e incierta, carreras reales de cobros y pagos con control, correcciones y anulaciones, Ganado en B1/B2, entrega y campaña, ficha y aislamiento comercial, auditoría.");
  } finally {
    const [p10, p25] = ["pack_10", "pack_25"].map((c) => catalogoOriginal.match(new RegExp(`${c}=([^/]+)/([^/]+)/(true|false)`))!);
    sql(`update public.crm_productos set precio = ${p10[1]}, comision_estandar = ${p10[2]}, activo = ${p10[3]} where codigo = 'pack_10';
         update public.crm_productos set precio = ${p25[1]}, comision_estandar = ${p25[2]}, activo = ${p25[3]} where codigo = 'pack_25';`);
    limpiar();
  }
}

main().catch((e) => {
  console.error(e);
  try { limpiar(); } catch { /* ya se informó el error principal */ }
  process.exit(1);
});
