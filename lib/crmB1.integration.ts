// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Integración del CRM B1 (prospección y visitas) contra la instancia LOCAL aislada
// del CRM (scripts/pruebas/crm-local.mjs), con db/crm-b0 y db/crm-b1 aplicados.
// Recorre las rutas reales de /comercial/api y /api/admin/crm:
//   · privilegios reales (service_role solo lee; anon nada) y actores de cada ruta;
//   · alcance del comercial: solo negocios asignados o creados por él, IDs cruzados
//     de negocio, contacto, jornada, visita y revisita → 404, nada ajeno en respuestas;
//   · negocios sin visita ni lead, rubro no listado, duplicados que avisan sin fusionar
//     y sin datos privados de otro comercial; teléfono compartido; contactos incompletos;
//   · jornadas: una abierta, varias por día, km y gastos pendientes (NULL ≠ 0), sin
//     negativos, km finales ≥ iniciales, la de ayer se resuelve sin inventar km;
//   · visitas: hechos que conviven, interés no evaluado ≠ sin interés, el empleado da
//     el teléfono del dueño, contacto útil → oportunidad, estados solo hacia adelante,
//     revisitas, atomicidad, reintento idempotente, misma clave con otro contenido,
//     medianoche, visita cargada por admin con autor ≠ quien la cargó;
//   · concurrencia real (Promise.all por la ruta): una sola oportunidad abierta, y una
//     corrida de control SIN las protecciones para mostrar que la prueba las detecta;
//   · atribución que se conserva al reasignar; corrección y anulación administrativas
//     con motivo, resolución explícita del origen y auditoría; notas sin ventana;
//     archivo que conserva historia; errores sin detalles de Postgres.
//
// Ejecutar: node scripts/pruebas/crm-local.mjs suite lib/crmB1.integration.ts

const MARCA = `zzcrmb1${Date.now().toString(36)}`;
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
  // Datos de esta suite (usuarios zzcrmb1…, negocios, rubros y zonas con la marca);
  // replica desactiva las FK cruzadas visita ↔ oportunidad solo en esta sesión de psql.
  sql(`set session_replication_role = replica;
    create temp table zz_u as select id from public.crm_usuarios where usuario like 'zzcrmb1%';
    create temp table zz_e as select id from public.crm_empresas where nombre_comercial like 'zzcrmb1%' or responsable_id in (select id from zz_u);
    create temp table zz_v as select id from public.crm_visitas where empresa_id in (select id from zz_e) or realizada_por_usuario in (select id from zz_u);
    create temp table zz_j as select id from public.crm_jornadas where usuario_id in (select id from zz_u);
    create temp table zz_c as select id from public.crm_contactos where empresa_id in (select id from zz_e);
    create temp table zz_o as select id from public.crm_oportunidades where empresa_id in (select id from zz_e);
    create temp table zz_t as select id from public.crm_tareas where empresa_id in (select id from zz_e);
    create temp table zz_n as select id from public.crm_visita_notas where visita_id in (select id from zz_v);
    create temp table zz_k as select id from public.crm_rubros where nombre like 'zzcrmb1%' union all select id from public.crm_zonas where nombre like 'zzcrmb1%';
    delete from public.crm_auditoria where entidad_id in (select id from zz_u union all select id from zz_e union all select id from zz_v union all select id from zz_j
      union all select id from zz_c union all select id from zz_o union all select id from zz_t union all select id from zz_n union all select id from zz_k)
      or actor_usuario_id in (select id from zz_u);
    delete from public.crm_visita_notas where id in (select id from zz_n);
    delete from public.crm_tareas where id in (select id from zz_t);
    delete from public.crm_oportunidades where id in (select id from zz_o);
    delete from public.crm_visitas where id in (select id from zz_v);
    delete from public.crm_contactos where id in (select id from zz_c);
    delete from public.crm_jornadas where id in (select id from zz_j);
    delete from public.crm_empresas where id in (select id from zz_e);
    delete from public.crm_rubros where nombre like 'zzcrmb1%';
    delete from public.crm_zonas where nombre like 'zzcrmb1%';
    delete from public.crm_usuarios where id in (select id from zz_u);`);
}

const logs: string[] = [];
for (const m of ["log", "info", "warn", "error"] as const) {
  const original = console[m].bind(console);
  console[m] = (...a: unknown[]) => {
    logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    original(...a);
  };
}
const respuestas: string[] = [];
const respuestasDe = new Map<string, string[]>();
const secretos = new Set<string>();
let ipN = 0;
const ip = () => `10.88.${Math.floor(++ipN / 250)}.${ipN % 250}`;

type J = Record<string, unknown>;
const o = (v: unknown) => v as J;
const arr = (v: unknown) => v as J[];

async function main() {
  limpiar();
  const SECRETO_PANEL = randomBytes(32).toString("hex");
  const SECRETO_CRM = randomBytes(32).toString("hex");
  process.env.ADMIN_SESSION_SECRET = SECRETO_PANEL;
  process.env.CRM_SESSION_SECRET = SECRETO_CRM;
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
  // Cookies por llamada (AsyncLocalStorage): las llamadas concurrentes de distintos
  // actores no se pisan la sesión.
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
  const S = await import("@/lib/crmB1Server");
  const B = await import("@/lib/crmB1");
  const USUARIOS = await import("@/app/api/admin/crm/usuarios/route");
  const INGRESAR = await import("@/app/comercial/api/ingresar/route");
  const C = {
    catalogo: await import("@/app/comercial/api/catalogo/route"),
    inicio: await import("@/app/comercial/api/inicio/route"),
    negocios: await import("@/app/comercial/api/negocios/route"),
    negocio: await import("@/app/comercial/api/negocios/[id]/route"),
    contactos: await import("@/app/comercial/api/negocios/[id]/contactos/route"),
    contacto: await import("@/app/comercial/api/contactos/[id]/route"),
    jornadas: await import("@/app/comercial/api/jornadas/route"),
    jornada: await import("@/app/comercial/api/jornadas/[id]/route"),
    visitas: await import("@/app/comercial/api/visitas/route"),
    notas: await import("@/app/comercial/api/visitas/[id]/notas/route"),
    tarea: await import("@/app/comercial/api/tareas/[id]/route"),
  };
  const A = {
    catalogo: await import("@/app/api/admin/crm/catalogo/route"),
    catalogoId: await import("@/app/api/admin/crm/catalogo/[id]/route"),
    negocios: await import("@/app/api/admin/crm/negocios/route"),
    negocio: await import("@/app/api/admin/crm/negocios/[id]/route"),
    contactos: await import("@/app/api/admin/crm/negocios/[id]/contactos/route"),
    contacto: await import("@/app/api/admin/crm/contactos/[id]/route"),
    jornadas: await import("@/app/api/admin/crm/jornadas/route"),
    jornada: await import("@/app/api/admin/crm/jornadas/[id]/route"),
    visitas: await import("@/app/api/admin/crm/visitas/route"),
    visita: await import("@/app/api/admin/crm/visitas/[id]/route"),
    notas: await import("@/app/api/admin/crm/visitas/[id]/notas/route"),
    tarea: await import("@/app/api/admin/crm/tareas/[id]/route"),
  };
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");

  type Resp = { status: number; json: J; texto: string; setCookies: string[] };
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  async function http(h: unknown, metodo: string, url: string, op: { cookies?: Record<string, string>; body?: unknown; id?: string; quien?: string; origin?: string } = {}): Promise<Resp> {
    const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": ip(), origin: op.origin ?? ORIGEN };
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers, body: op.body === undefined ? undefined : JSON.stringify(op.body) });
    const res = await almacen.run(new Map(Object.entries(op.cookies ?? {})), () => (h as Handler)(req, { params: Promise.resolve({ id: op.id ?? "" }) }));
    const texto = await res.text();
    respuestas.push(texto);
    if (op.quien) respuestasDe.set(op.quien, [...(respuestasDe.get(op.quien) ?? []), texto]);
    let json: J = {};
    try { json = JSON.parse(texto); } catch { /* sin cuerpo JSON */ }
    return { status: res.status, json, texto, setCookies: res.headers.getSetCookie() };
  }
  const comoAdmin = { [ADMIN_COOKIE]: admin };
  const comoStaff = { [ADMIN_COOKIE]: staff };

  // Usuarios comerciales de prueba (contraseñas aleatorias, nunca impresas).
  const crearUsuario = async (sufijo: string, nombre: string) => {
    const usuario = `${MARCA}.${sufijo}`;
    const contrasena = `Clave-${randomBytes(9).toString("base64url")}`;
    secretos.add(contrasena);
    const r = await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoAdmin, body: { usuario, nombre, contrasena } });
    assert.equal(r.status, 201, `alta ${sufijo}: ${r.texto}`);
    const ing = await http(INGRESAR.POST, "POST", "/comercial/api/ingresar", { body: { usuario, contrasena } });
    assert.equal(ing.status, 200, `ingreso ${sufijo}`);
    const c = ing.setCookies.find((x) => x.startsWith(`${CRM_COOKIE}=`))!;
    const token = /^[^=]+=([^;]*)/.exec(c)![1];
    secretos.add(token);
    return { id: String(o(r.json.usuario).id), nombre, cookies: { [CRM_COOKIE]: token } };
  };
  const UA = await crearUsuario("tobias", `Tobías ${MARCA}`);
  const UB = await crearUsuario("otro", `Bruno ${MARCA}`);

  const hoy = sql("select public.crm_fecha_sim(now())");
  const dia = (d: number) => sql(`select (${lit(hoy)}::date + ${d})::text`);
  assert.match(hoy, /^\d{4}-\d{2}-\d{2}$/);

  // Atajos
  const cGet = (h: unknown, url: string, u: { cookies: Record<string, string> }, id?: string) => http(h, "GET", url, { cookies: u.cookies, id, quien: u === UA ? "A" : "B" });
  const cSend = (h: unknown, metodo: string, url: string, u: { cookies: Record<string, string> }, body: unknown, id?: string) =>
    http(h, metodo, url, { cookies: u.cookies, body, id, quien: u === UA ? "A" : "B" });
  const aSend = (h: unknown, metodo: string, url: string, body: unknown, id?: string) => http(h, metodo, url, { cookies: comoAdmin, body, id });
  const aGet = (h: unknown, url: string, id?: string) => http(h, "GET", url, { cookies: comoAdmin, id });
  const visitaC = (u: typeof UA, datos: J, clave = randomUUID()) => cSend(C.visitas.POST, "POST", "/comercial/api/visitas", u, { clave, datos });
  const visitaA = (datos: J, clave = randomUUID()) => aSend(A.visitas.POST, "POST", "/api/admin/crm/visitas", { clave, datos });
  const crearNegocioA = async (datos: J, confirmar = false) => {
    const r = await aSend(A.negocios.POST, "POST", "/api/admin/crm/negocios", { datos, confirmar_duplicado: confirmar });
    assert.equal(r.status, 201, `alta admin ${String(datos.nombre_comercial)}: ${r.texto}`);
    return String(r.json.id);
  };
  const contar = (tabla: string, cond: string) => Number(sql(`select count(*) from public.${tabla} where ${cond}`));
  const fichaA = async (id: string) => (await aGet(A.negocio.GET, `/api/admin/crm/negocios/${id}`, id)).json;
  const versionEmpresa = (id: string) => Number(sql(`select version from public.crm_empresas where id = ${lit(id)}`));
  const versionVisita = (id: string) => Number(sql(`select version from public.crm_visitas where id = ${lit(id)}`));
  const oppAbiertas = (empresa: string) => contar("crm_oportunidades", `empresa_id = ${lit(empresa)} and cerrada_en is null`);

  try {
    // ── 1) Privilegios reales ──────────────────────────────────────────────
    {
      for (const t of ["crm_empresas", "crm_contactos", "crm_jornadas", "crm_visitas", "crm_oportunidades", "crm_tareas", "crm_visita_notas", "crm_rubros", "crm_zonas"]) {
        const ins = await supabaseAdmin.from(t).insert({});
        assert.equal(ins.error?.code, "42501", `service_role no inserta en ${t}`);
        const del = await supabaseAdmin.from(t).delete().neq("id", randomUUID());
        assert.equal(del.error?.code, "42501", `service_role no borra en ${t}`);
      }
      const upd = await supabaseAdmin.from("crm_empresas").update({ nombre_comercial: "x" }).neq("id", randomUUID());
      assert.equal(upd.error?.code, "42501", "service_role no actualiza directo");
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      assert.ok((await anon.from("crm_empresas").select("id").limit(1)).error, "anon no lee negocios");
      const rpcAnon = await anon.rpc("crm_empresa_crear", { p_datos: { nombre_comercial: "x" }, p_confirmar_duplicado: true, p_actor_rol: "admin", p_actor_usuario: null });
      assert.ok(rpcAnon.error, "anon no ejecuta las RPCs aunque diga ser admin");
      const interna = await supabaseAdmin.rpc("crm_empresa_insertar", { p_datos: { nombre_comercial: "x" }, p_confirmar: true, p_rol: "admin", p_usuario: null,
        p_responsable: null, p_origen: "manual", p_cliente_previo: false });
      assert.ok(interna.error, "service_role no ejecuta los helpers internos");
    }

    // ── 2) Actores de las rutas ────────────────────────────────────────────
    {
      for (const [h, url] of [[C.negocios.GET, "/comercial/api/negocios"], [C.inicio.GET, "/comercial/api/inicio"], [C.jornadas.GET, "/comercial/api/jornadas"]] as const) {
        assert.equal((await http(h, "GET", url)).status, 401, `${url} sin sesión`);
        assert.equal((await http(h, "GET", url, { cookies: comoStaff })).status, 403, `${url} staff`);
        assert.equal((await http(h, "GET", url, { cookies: comoAdmin })).status, 403, `${url} admin en la interfaz comercial`);
      }
      for (const [h, url] of [[A.negocios.GET, "/api/admin/crm/negocios"], [A.jornadas.GET, "/api/admin/crm/jornadas"], [A.catalogo.GET, "/api/admin/crm/catalogo"]] as const) {
        assert.equal((await http(h, "GET", url)).status, 401, `${url} sin sesión`);
        assert.equal((await http(h, "GET", url, { cookies: comoStaff })).status, 403, `${url} staff`);
        assert.equal((await http(h, "GET", url, { cookies: UA.cookies })).status, 401, `${url} con cookie comercial`);
      }
      const ajeno = await http(C.visitas.POST, "POST", "/comercial/api/visitas", { cookies: UA.cookies, body: { clave: randomUUID(), datos: {} } });
      assert.notEqual(ajeno.status, 201);
      const otroOrigen = await http(C.jornadas.POST, "POST", "/comercial/api/jornadas", { cookies: UA.cookies, body: { datos: {} }, origin: "https://otro.example" });
      assert.equal(otroOrigen.status, 403, "origen ajeno");
    }

    // ── 3) Catálogo: rubros y zonas (solo admin) ──────────────────────────
    let ZONA = "", RUBRO_X = "", PELU = "";
    {
      const z = await aSend(A.catalogo.POST, "POST", "/api/admin/crm/catalogo", { tipo: "zona", datos: { nombre: `${MARCA} Centro` } });
      assert.equal(z.status, 201, z.texto);
      ZONA = String(z.json.id);
      const r = await aSend(A.catalogo.POST, "POST", "/api/admin/crm/catalogo", { tipo: "rubro", datos: { nombre: `${MARCA} Ópticas` } });
      assert.equal(r.status, 201, r.texto);
      RUBRO_X = String(r.json.id);
      const dup = await aSend(A.catalogo.POST, "POST", "/api/admin/crm/catalogo", { tipo: "rubro", datos: { nombre: `${MARCA.toUpperCase()} OPTICAS` } });
      assert.equal(dup.status, 409, "rubro repetido (normalizado)");
      const cat = await cGet(C.catalogo.GET, "/comercial/api/catalogo", UA);
      assert.equal(cat.status, 200);
      PELU = String(arr(o(cat.json).rubros).find((x) => x.nombre === "Peluquerías")!.id);
      assert.ok(PELU, "Peluquerías viene sembrado");
      assert.equal(cat.json.usuarios, undefined, "el comercial no recibe la lista de usuarios");
      const rpcCom = await S.guardarCatalogo({ rol: "comercial", usuarioId: UA.id }, "rubro", null, null, { nombre: `${MARCA} trucho` });
      assert.ok(!rpcCom.ok && rpcCom.e?.status === 403, "un comercial no edita el catálogo");
      const v = Number(sql(`select version from public.crm_rubros where id = ${lit(RUBRO_X)}`));
      const des = await aSend(A.catalogoId.PATCH, "PATCH", `/api/admin/crm/catalogo/${RUBRO_X}`, { tipo: "rubro", version: v, datos: { activo: false } }, RUBRO_X);
      assert.equal(des.status, 200, des.texto);
      const cat2 = await cGet(C.catalogo.GET, "/comercial/api/catalogo", UA);
      assert.ok(!arr(o(cat2.json).rubros).some((x) => x.id === RUBRO_X), "un rubro inactivo no se ofrece");
      const conInactivo = await aSend(A.negocios.POST, "POST", "/api/admin/crm/negocios", { datos: { nombre_comercial: `${MARCA} Optica Inactiva`, rubro_id: RUBRO_X } });
      assert.equal(conInactivo.status, 400, "no se asigna un rubro inactivo");
      await aSend(A.catalogoId.PATCH, "PATCH", `/api/admin/crm/catalogo/${RUBRO_X}`, { tipo: "rubro", version: v + 1, datos: { activo: true } }, RUBRO_X);
    }

    // ── 4) Negocios cargados por admin: sin visita, jornada, lead ni interés ─
    const NA1 = await crearNegocioA({ nombre_comercial: `${MARCA} Peluquería Ñandú`, rubro_id: PELU, zona_id: ZONA, direccion: "Av. Colón 1234", prioridad: "A", responsable_id: UA.id, cliente_previo: true });
    const NA2 = await crearNegocioA({ nombre_comercial: `${MARCA} Lubricentro Sur`, rubro_detalle: "Lavadero de motos", zona_id: ZONA, responsable_id: UA.id });
    const NB1 = await crearNegocioA({ nombre_comercial: `${MARCA} Gimnasio Fuerza`, direccion: "Bv. San Juan 900", responsable_id: UB.id });
    const NSIN = await crearNegocioA({ nombre_comercial: `${MARCA} Ferretería Sin Asignar` });
    const NCONC = await crearNegocioA({ nombre_comercial: `${MARCA} Concurrencia`, responsable_id: UA.id });
    {
      for (const id of [NA1, NA2, NB1, NSIN]) {
        for (const t of ["crm_visitas", "crm_oportunidades", "crm_tareas"]) assert.equal(contar(t, `empresa_id = ${lit(id)}`), 0, `alta sin ${t}`);
      }
      assert.equal(contar("crm_jornadas", `usuario_id in (${lit(UA.id)}, ${lit(UB.id)})`), 0, "cargar negocios no crea jornadas");
      const f = await fichaA(NA2);
      assert.equal(o(f.empresa).rubro_detalle, "Lavadero de motos", "rubro no listado con descripción libre");
      assert.equal(o(f.empresa).estado, "por_visitar");
      const sinClas = await aGet(A.negocios.GET, `/api/admin/crm/negocios?rubro=sin_clasificar&q=${encodeURIComponent(MARCA)}`);
      assert.ok(arr(sinClas.json.negocios).some((e) => e.id === NA2) && !arr(sinClas.json.negocios).some((e) => e.id === NA1), "filtro sin rubro de la lista");
      const ambos = await aSend(A.negocios.POST, "POST", "/api/admin/crm/negocios", { datos: { nombre_comercial: `${MARCA} Ambos`, rubro_id: PELU, rubro_detalle: "x" } });
      assert.equal(ambos.status, 400, "rubro de la lista y descripción libre a la vez");
      const sinNombre = await aSend(A.negocios.POST, "POST", "/api/admin/crm/negocios", { datos: { nombre_comercial: "  ", zona_id: ZONA } });
      assert.equal(sinNombre.status, 400, "nombre comercial obligatorio");
      const claveRara = await aSend(A.negocios.POST, "POST", "/api/admin/crm/negocios", { datos: { nombre_comercial: `${MARCA} Raro`, telefono_dueno: "1" } });
      assert.equal(claveRara.status, 400, "claves desconocidas rechazadas");
      assert.equal(sql(`select origen from public.crm_empresas where id = ${lit(NA1)}`), "manual");
    }

    // ── 5) Alcance del comercial ───────────────────────────────────────────
    {
      const lista = await cGet(C.negocios.GET, "/comercial/api/negocios", UA);
      const ids = arr(lista.json.negocios).map((e) => e.id);
      assert.ok(ids.includes(NA1) && ids.includes(NA2) && ids.includes(NCONC), "ve sus asignados");
      assert.ok(!ids.includes(NB1) && !ids.includes(NSIN), "no ve ajenos ni sin asignar");
      assert.ok(arr(lista.json.negocios).every((e) => e.responsable === undefined && e.origen === undefined), "el DTO comercial no trae responsable ni origen");
      for (const id of [NB1, NSIN, randomUUID(), "no-es-uuid"]) {
        assert.equal((await cGet(C.negocio.GET, `/comercial/api/negocios/${id}`, UA, id)).status, 404, `ficha ajena ${id}`);
        assert.equal((await cSend(C.negocio.PATCH, "PATCH", `/comercial/api/negocios/${id}`, UA, { version: 1, cambios: { web: "x" } }, id)).status, 404, `editar ajeno ${id}`);
        assert.equal((await cSend(C.contactos.POST, "POST", `/comercial/api/negocios/${id}/contactos`, UA, { datos: { nombre: "X" } }, id)).status, 404, `contacto en ajeno ${id}`);
      }
      const asig = await cSend(C.negocio.PATCH, "PATCH", `/comercial/api/negocios/${NA1}`, UA, { version: versionEmpresa(NA1), cambios: { responsable_id: UB.id } }, NA1);
      assert.equal(asig.status, 403, "el comercial no reasigna");
      const prev = await cSend(C.negocio.PATCH, "PATCH", `/comercial/api/negocios/${NA1}`, UA, { version: versionEmpresa(NA1), cambios: { cliente_previo: false } }, NA1);
      assert.equal(prev.status, 403, "el comercial no toca cliente previo");
      const arch = await cSend(C.negocio.PATCH, "PATCH", `/comercial/api/negocios/${NA1}`, UA, { accion: "archivar", version: versionEmpresa(NA1), motivo: "x" }, NA1);
      assert.equal(arch.status, 403, "el comercial no archiva");
      const ed = await cSend(C.negocio.PATCH, "PATCH", `/comercial/api/negocios/${NA1}`, UA, { version: versionEmpresa(NA1), cambios: { instagram: "@nandu" } }, NA1);
      assert.equal(ed.status, 200, `edita lo suyo: ${ed.texto}`);
      const vieja = await cSend(C.negocio.PATCH, "PATCH", `/comercial/api/negocios/${NA1}`, UA, { version: 1, cambios: { instagram: "@otro" } }, NA1);
      assert.equal(vieja.status, 409, "versión desactualizada");
      const conResp = await cSend(C.negocios.POST, "POST", "/comercial/api/negocios", UA, { datos: { nombre_comercial: `${MARCA} Mío`, responsable_id: UB.id } });
      assert.equal(conResp.status, 403, "el comercial no elige responsable al crear");
    }

    // ── 6) Duplicados: avisan sin fusionar y sin datos privados ajenos ─────
    let NA3 = "";
    {
      // Contacto del negocio de B (para buscar fugas después).
      const cb = await aSend(A.contactos.POST, "POST", `/api/admin/crm/negocios/${NB1}/contactos`, { datos: { nombre: "Dueño de Bruno", telefono: "351 777-0001", es_decisor: "si" } }, NB1);
      assert.equal(cb.status, 201, cb.texto);
      const r = await cSend(C.negocios.POST, "POST", "/comercial/api/negocios", UA, { datos: { nombre_comercial: `${MARCA} GIMNASIO FUERZA`, direccion: "Otra 1" } });
      assert.equal(r.status, 409, "posible duplicado");
      const cand = arr(r.json.candidatos);
      const ajeno = cand.find((x) => x.nombre_comercial === `${MARCA} Gimnasio Fuerza`)!;
      assert.ok(ajeno, "el candidato ajeno aparece por nombre");
      assert.equal(ajeno.asignacion, "otra_persona");
      assert.deepEqual(Object.keys(ajeno).sort(), ["asignacion", "nombre_comercial", "rubro", "zona"], "del ajeno: sin id, dirección, contactos ni responsable");
      assert.equal(contar("crm_empresas", `nombre_normalizado = ${lit(B.normalizarTexto(`${MARCA} GIMNASIO FUERZA`))}`), 1, "el aviso no escribe nada");
      const porDir = await cSend(C.negocios.POST, "POST", "/comercial/api/negocios", UA, { datos: { nombre_comercial: `${MARCA} Kiosco`, direccion: "av colon 1234" } });
      assert.equal(porDir.status, 409, "misma dirección normalizada");
      const propio = arr(porDir.json.candidatos).find((x) => x.asignacion === "vos")!;
      assert.equal(propio.id, NA1, "el candidato propio sí trae id para abrirlo");
      const conf = await cSend(C.negocios.POST, "POST", "/comercial/api/negocios", UA, { datos: { nombre_comercial: `${MARCA} GIMNASIO FUERZA`, direccion: "Otra 1" }, confirmar_duplicado: true });
      assert.equal(conf.status, 201, "confirmado: se crea igual, sin fusionar");
      NA3 = String(conf.json.id);
      assert.equal(sql(`select responsable_id from public.crm_empresas where id = ${lit(NA3)}`), UA.id, "creado por el comercial → asignado a él");
      assert.equal(sql(`select array_length(similar_a, 1) from public.crm_empresas where id = ${lit(NA3)}`), "1", "queda marcado para revisión");
      assert.equal(contar("crm_empresas", `id = ${lit(NB1)} and responsable_id = ${lit(UB.id)}`), 1, "el original sigue intacto");
      const dups = await aGet(A.negocios.GET, `/api/admin/crm/negocios?duplicados=1&q=${encodeURIComponent(MARCA)}`);
      assert.ok(arr(dups.json.negocios).some((e) => e.id === NA3 && e.posible_duplicado === true), "admin lo ve en posibles duplicados");
      assert.ok(arr(o(await fichaA(NA3)).similares).some((x) => x.id === NB1), "admin ve con cuál se parece");
      const fichaPropia = await cGet(C.negocio.GET, `/comercial/api/negocios/${NA3}`, UA, NA3);
      assert.equal(fichaPropia.json.similares, undefined, "el comercial no recibe los similares");
    }

    // ── 7) Contactos: varios, incompletos, teléfono original + normalizado, sin unicidad ─
    let CA1 = "";
    {
      const c1 = await cSend(C.contactos.POST, "POST", `/comercial/api/negocios/${NA1}/contactos`, UA, { datos: { nombre: "Marta", cargo: "Dueña", telefono: "0351 15-555-1234", tiene_whatsapp: true, es_decisor: "si" } }, NA1);
      assert.equal(c1.status, 201, c1.texto);
      CA1 = String(c1.json.id ?? c1.json);
      const fila = sql(`select telefono || '|' || telefono_normalizado from public.crm_contactos where id = ${lit(CA1)}`);
      assert.equal(fila, "0351 15-555-1234|54351155551234", "teléfono original y normalizado");
      const solo = await cSend(C.contactos.POST, "POST", `/comercial/api/negocios/${NA1}/contactos`, UA, { datos: { nombre: "Recepcionista" } }, NA1);
      assert.equal(solo.status, 201, "contacto solo con nombre");
      const mismo = await cSend(C.contactos.POST, "POST", `/comercial/api/negocios/${NA2}/contactos`, UA, { datos: { telefono: "+54 351 155-551234" } }, NA2);
      assert.equal(mismo.status, 201, "el mismo teléfono en otro negocio, sin unicidad");
      assert.equal(contar("crm_contactos", "telefono_normalizado = '54351155551234'"), 2);
      const vacio = await cSend(C.contactos.POST, "POST", `/comercial/api/negocios/${NA1}/contactos`, UA, { datos: { cargo: "Encargado" } }, NA1);
      assert.equal(vacio.status, 400, "sin nombre ni teléfono");
      const malo = await cSend(C.contactos.POST, "POST", `/comercial/api/negocios/${NA1}/contactos`, UA, { datos: { nombre: "X", telefono: "12" } }, NA1);
      assert.equal(malo.status, 400, "teléfono imposible");
      const cbId = sql(`select id from public.crm_contactos where empresa_id = ${lit(NB1)} limit 1`);
      assert.equal((await cSend(C.contacto.PATCH, "PATCH", `/comercial/api/contactos/${cbId}`, UA, { version: 1, cambios: { nombre: "robado" } }, cbId)).status, 404, "contacto ajeno");
    }

    // ── 8) Jornadas ────────────────────────────────────────────────────────
    let JA = "";
    {
      const sinKm = await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UA, { datos: { km_final: 10 } });
      assert.equal(sinKm.status, 400, "al abrir no se cargan km finales");
      const fecha = await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UA, { datos: { fecha: dia(-3) } });
      assert.equal(fecha.status, 400, "el comercial no elige la fecha");
      const ab = await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UA, { datos: { nombre: "Centro mañana", zona_id: ZONA, km_inicial: 1000 } });
      assert.equal(ab.status, 201, ab.texto);
      JA = String(ab.json.id);
      assert.equal(sql(`select fecha::text from public.crm_jornadas where id = ${lit(JA)}`), hoy, "fecha de negocio en Córdoba");
      assert.equal((await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UA, { datos: {} })).status, 409, "una sola abierta por comercial");
      const jb = await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UB, { datos: {} });
      assert.equal(jb.status, 201, "otro comercial abre la suya");
      const JB = String(jb.json.id);
      assert.equal((await cGet(C.jornada.GET, `/comercial/api/jornadas/${JB}`, UA, JB)).status, 404, "jornada ajena");
      assert.equal((await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JB}`, UA, { version: 1, cerrar: true }, JB)).status, 404, "no cierra la ajena");
      const v = () => Number(sql(`select version from public.crm_jornadas where id = ${lit(JA)}`));
      for (const [cambios, motivo] of [
        [{ km_final: 999 }, "km finales menores que los iniciales"], [{ peajes_importe: -1 }, "gasto negativo"], [{ combustible_cantidad: 10 }, "combustible sin unidad"],
        [{ combustible_cantidad: 10, combustible_unidad: "galones" }, "unidad inexistente"], [{ km_inicial: "mil" }, "km no numérico"],
      ] as const) assert.equal((await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JA}`, UA, { version: v(), cambios }, JA)).status, 400, motivo);
      const ok = await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JA}`, UA, { version: v(), cambios: { peajes_importe: 0, combustible_cantidad: 12.5, combustible_unidad: "litros" } }, JA);
      assert.equal(ok.status, 200, ok.texto);
      const det = await cGet(C.jornada.GET, `/comercial/api/jornadas/${JA}`, UA, JA);
      const pend = o(det.json.jornada).pendientes as string[];
      assert.ok(!pend.includes("peajes") && pend.includes("km finales") && pend.includes("combustible") && pend.includes("estacionamiento"), `NULL ≠ 0: ${pend.join(", ")}`);
      assert.equal(o(det.json.jornada).km_recorridos, null, "sin km finales no hay recorrido");
      // B cierra con todo pendiente y abre otra el mismo día (varias por día).
      const cierre = await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JB}`, UB, { version: 1, cerrar: true }, JB);
      assert.equal(cierre.status, 200, "se cierra con km y gastos pendientes");
      assert.equal((await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JB}`, UB, { version: 2, cerrar: true }, JB)).status, 409, "ya cerrada");
      const otra = await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UB, { datos: { km_inicial: 50 } });
      assert.equal(otra.status, 201, "segunda jornada del mismo día");
      assert.equal(contar("crm_jornadas", `usuario_id = ${lit(UB.id)} and fecha = ${lit(hoy)}`), 2);
      const tarde = await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JB}`, UB, { version: 2, cambios: { km_inicial: 40, km_final: 95.5, estacionamiento_importe: 1500 } }, JB);
      assert.equal(tarde.status, 200, "los pendientes se completan con la jornada cerrada");
      assert.equal(sql(`select km_recorridos from public.crm_jornadas where id = ${lit(JB)}`), "55.5", "km recorridos calculados");
      const listaB = await cGet(C.jornadas.GET, "/comercial/api/jornadas", UB);
      assert.ok(arr(listaB.json.jornadas).every((j) => o(j.usuario).tipo === "vos"), "solo sus jornadas");
    }

    // ── 9) Visitas ─────────────────────────────────────────────────────────
    let V_CERRADO = "", V_EMPLEADO = "", V_TIBIO = "";
    let OPP_NA1 = "";
    {
      // Cerrado: un hecho que excluye contacto, interés y necesidades.
      const cerr = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, cerrado: true });
      assert.equal(cerr.status, 201, cerr.texto);
      V_CERRADO = String(o(cerr.json.visita).id);
      assert.equal(cerr.json.oportunidad, null, "cerrado: sin oportunidad");
      const cerrMal = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, cerrado: true, interes: "frio" });
      assert.equal(cerrMal.status, 400, "cerrado no admite interés");
      assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NA2 })).status, 400, "sin resultado");
      assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_responsable: true, responsable_ausente: true })).status, 400, "responsable presente y ausente");

      // Habló con un empleado, el responsable no estaba; interés NO evaluado; el
      // empleado dio el teléfono del dueño → contacto útil obtenido sin hablar con él.
      const emp = await visitaC(UA, {
        jornada_id: JA, empresa_id: NA1, hablo_con_empleado: true, responsable_ausente: true, contacto_obtenido: true,
        contacto_nuevo: { nombre: "Dueño", cargo: "Dueño", telefono: "3515550000", es_decisor: "si" }, volver_otro_dia: true, revisita_para: dia(3),
        necesidades: ["fidelizacion", "otra"], necesidad_otra: "Premios para clientas frecuentes",
      });
      assert.equal(emp.status, 201, emp.texto);
      V_EMPLEADO = String(o(emp.json.visita).id);
      const fila = sql(`select concat_ws('|', interes is null, contacto_util, decisor_contactado, hablo_con_contacto, responsable_ausente, hablo_con_empleado) from public.crm_visitas where id = ${lit(V_EMPLEADO)}`);
      assert.equal(fila, "t|t|f|f|t|t", "interés no evaluado (NULL), contacto útil del decisor sin haber hablado con él; hechos que conviven");
      const opp = o(emp.json.oportunidad);
      assert.equal(opp.estado, "contacto", "contacto útil sin interés evaluado → estado contacto");
      assert.equal(opp.creada, true);
      OPP_NA1 = String(opp.id);
      assert.equal(sql(`select origen_usuario_id || '|' || origen_visita_id from public.crm_oportunidades where id = ${lit(OPP_NA1)}`), `${UA.id}|${V_EMPLEADO}`, "atribución del origen");
      assert.ok(emp.json.tarea, "revisita creada");
      assert.equal(o(emp.json.tarea).vence_el, dia(3));

      // Contacto obtenido sin canal → no hay oportunidad (y no se guarda nada).
      const antes = contar("crm_visitas", `empresa_id = ${lit(NA2)}`);
      const sinCanal = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_responsable: true, contacto_obtenido: true, contacto_nuevo: { nombre: "Sin teléfono" } });
      assert.equal(sinCanal.status, 400, "contacto útil exige un teléfono");
      assert.equal(sinCanal.json.codigo, "contacto_sin_canal");
      assert.equal(contar("crm_visitas", `empresa_id = ${lit(NA2)}`), antes, "nada guardado");
      assert.equal(contar("crm_contactos", `empresa_id = ${lit(NA2)} and nombre = 'Sin teléfono'`), 0, "ni el contacto (atómico)");

      // Sin interés (evaluado) en NA2 con contacto útil: oportunidad en "contacto".
      const sinInt = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_responsable: true, contacto_obtenido: true, hablo_con_contacto: true,
        contacto_nuevo: { nombre: "Encargado", telefono: "351 444 5566", tiene_whatsapp: false }, interes: "sin_interes" });
      assert.equal(sinInt.status, 201, sinInt.texto);
      assert.equal(sql(`select interes from public.crm_visitas where id = ${lit(String(o(sinInt.json.visita).id))}`), "sin_interes", "sin interés ≠ no evaluado");
      assert.equal(o(sinInt.json.oportunidad).estado, "contacto");
      assert.equal(sql(`select coalesce(tiene_whatsapp::text, 'null') from public.crm_contactos where id = ${lit(String(sinInt.json.contacto_id))}`), "false", "«no tiene WhatsApp» se guarda");

      // Segunda visita a NA1, tibio: resuelve la revisita, avanza la oportunidad, no crea otra.
      const tib = await visitaC(UA, { jornada_id: JA, empresa_id: NA1, hablo_con_responsable: true, contacto_id: CA1, contacto_obtenido: true, hablo_con_contacto: true,
        interes: "tibio", necesidades: ["sorteos", "redes"], pack_potencial: "25" });
      assert.equal(tib.status, 201, tib.texto);
      V_TIBIO = String(o(tib.json.visita).id);
      assert.equal(o(tib.json.oportunidad).id, OPP_NA1, "una sola oportunidad abierta por negocio");
      assert.equal(o(tib.json.oportunidad).estado, "interesado");
      assert.equal(o(tib.json.oportunidad).origen_es_esta_visita, false, "el origen sigue siendo la primera");
      assert.equal(contar("crm_tareas", `empresa_id = ${lit(NA1)} and estado = 'hecha'`), 1, "la revisita quedó resuelta");
      assert.equal(sql(`select resuelta_visita_id from public.crm_tareas where empresa_id = ${lit(NA1)} and estado = 'hecha'`), V_TIBIO);
      // Tercera, sin interés: el estado no retrocede.
      const baja = await visitaC(UA, { jornada_id: JA, empresa_id: NA1, hablo_con_responsable: true, interes: "sin_interes" });
      assert.equal(baja.status, 201);
      assert.equal(sql(`select estado from public.crm_oportunidades where id = ${lit(OPP_NA1)}`), "interesado", "estados solo hacia adelante");
      assert.equal(oppAbiertas(NA1), 1);

      // Validaciones de contenido
      for (const [datos, motivo] of [
        [{ hablo_con_responsable: true, necesidades: ["otra"] }, "«Otra» sin texto"],
        [{ hablo_con_responsable: true, necesidades: ["inventada"] }, "necesidad inexistente"],
        [{ hablo_con_responsable: true, pack_potencial: "50" }, "pack inexistente"],
        [{ hablo_con_responsable: true, interes: "muy" }, "interés inexistente"],
        [{ hablo_con_responsable: true, revisita_para: dia(2) }, "fecha de revisita sin «volver otro día»"],
        [{ hablo_con_responsable: true, volver_otro_dia: true, revisita_para: dia(-1) }, "revisita en el pasado"],
        [{ hablo_con_contacto: true, hablo_con_responsable: true }, "habló con un contacto sin contacto"],
      ] as const) assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NA2, ...datos })).status, 400, motivo);
      for (const p of ["10", "personalizado", "no_determinado"]) {
        assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_responsable: true, pack_potencial: p })).status, 201, `pack ${p}`);
      }

      // IDs cruzados en la visita
      const JB2 = sql(`select id from public.crm_jornadas where usuario_id = ${lit(UB.id)} and cerrada_en is null`);
      assert.equal((await visitaC(UA, { jornada_id: JB2, empresa_id: NA1, hablo_con_responsable: true })).status, 404, "jornada de otro");
      assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NB1, hablo_con_responsable: true })).status, 404, "negocio de otro");
      assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NSIN, hablo_con_responsable: true })).status, 404, "negocio sin asignar");
      const cbId = sql(`select id from public.crm_contactos where empresa_id = ${lit(NB1)} limit 1`);
      assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NA1, hablo_con_responsable: true, contacto_id: cbId, contacto_obtenido: true })).status, 404, "contacto de otro negocio");
      // El autor y la hora del formulario se ignoran para el comercial.
      const suplanta = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_responsable: true, realizada_por: UB.id, ocurrida_en: "2020-01-01T10:00:00Z" });
      assert.equal(suplanta.status, 201);
      assert.equal(sql(`select realizada_por_usuario || '|' || registrada_por_rol || '|' || fecha from public.crm_visitas where id = ${lit(String(o(suplanta.json.visita).id))}`),
        `${UA.id}|comercial|${hoy}`, "quien la hizo y cuándo los pone el servidor");
      // Negocio y contacto nuevos en la visita, atómico.
      const nombreNuevo = `${MARCA} Detailing Norte`;
      const malo = await visitaC(UA, { jornada_id: JA, empresa_nueva: { nombre_comercial: nombreNuevo }, hablo_con_responsable: true, contacto_nuevo: { nombre: "X", telefono: "1" } });
      assert.equal(malo.status, 400);
      assert.equal(contar("crm_empresas", `nombre_comercial = ${lit(nombreNuevo)}`), 0, "si falla el contacto no queda el negocio");
      const nuevo = await visitaC(UA, { jornada_id: JA, empresa_nueva: { nombre_comercial: nombreNuevo, rubro_id: PELU }, hablo_con_responsable: true, contacto_obtenido: true,
        hablo_con_contacto: true, contacto_nuevo: { nombre: "Lucas", telefono: "351-600-1111", tiene_whatsapp: true, es_decisor: "si" }, interes: "caliente", necesidades: ["regalos", "beneficios_empleados"], pack_potencial: "personalizado" });
      assert.equal(nuevo.status, 201, nuevo.texto);
      assert.equal(nuevo.json.empresa_creada, true);
      assert.equal(nuevo.json.contacto_creado, true);
      assert.equal(o(nuevo.json.oportunidad).estado, "interesado");
      const NNUEVO = String(o(nuevo.json.visita).empresa_id);
      assert.equal(sql(`select origen || '|' || responsable_id from public.crm_empresas where id = ${lit(NNUEVO)}`), `visita|${UA.id}`);
      assert.equal(o(nuevo.json.visita).decisor_contactado, true, "habló con el decisor");
    }

    // ── 10) Idempotencia y reintentos ──────────────────────────────────────
    {
      const clave = randomUUID();
      const datos = { jornada_id: JA, empresa_id: NA2, hablo_con_empleado: true, observacion: "Reintento" };
      const r1 = await visitaC(UA, datos, clave);
      assert.equal(r1.status, 201);
      const r2 = await visitaC(UA, { observacion: "Reintento", hablo_con_empleado: true, empresa_id: NA2, jornada_id: JA }, clave);
      assert.equal(r2.status, 200, "mismo contenido (otro orden) → reintento");
      assert.equal(r2.json.repetida, true);
      assert.equal(o(r2.json.visita).id, o(r1.json.visita).id, "misma visita");
      assert.equal(contar("crm_visitas", `clave = ${lit(clave)}`), 1, "una sola fila");
      const r3 = await visitaC(UA, { ...datos, observacion: "Otra cosa" }, clave);
      assert.equal(r3.status, 409);
      assert.equal(r3.json.codigo, "clave_reutilizada", "misma clave, otro contenido");
      const r4 = await cSend(C.visitas.POST, "POST", "/comercial/api/visitas", UB, { clave, datos });
      assert.equal(r4.status, 409, "misma clave desde otro usuario");
      assert.equal(contar("crm_visitas", `clave = ${lit(clave)}`), 1);
      // Reintentos simultáneos (el primer envío quedó incierto y se reintenta en paralelo).
      const c2 = randomUUID();
      const par = await Promise.all(Array.from({ length: 6 }, () => visitaC(UA, { jornada_id: JA, empresa_id: NA2, cerrado: true }, c2)));
      assert.deepEqual(par.map((x) => x.status).sort(), [200, 200, 200, 200, 200, 201], "un alta y cinco repeticiones");
      assert.equal(new Set(par.map((x) => o(x.json.visita).id)).size, 1);
      assert.equal(contar("crm_visitas", `clave = ${lit(c2)}`), 1);
      // El aviso de duplicado no consume la clave: confirmar con la misma clave crea.
      const c3 = randomUUID();
      const dup = await visitaC(UA, { jornada_id: JA, empresa_nueva: { nombre_comercial: `${MARCA} Peluqueria Nandu` }, hablo_con_empleado: true }, c3);
      assert.equal(dup.status, 409);
      assert.equal(dup.json.codigo, "posible_duplicado");
      assert.equal(contar("crm_visitas", `clave = ${lit(c3)}`), 0);
      const conf = await visitaC(UA, { jornada_id: JA, empresa_nueva: { nombre_comercial: `${MARCA} Peluqueria Nandu` }, hablo_con_empleado: true, confirmar_duplicado: true }, c3);
      assert.equal(conf.status, 201, conf.texto);
      // Clave inválida
      assert.equal((await cSend(C.visitas.POST, "POST", "/comercial/api/visitas", UA, { clave: "123", datos })).status, 400);
    }

    // ── 11) Concurrencia real: una sola oportunidad abierta ───────────────
    // Ventana de carrera: la auditoría de la oportunidad recién creada espera 1 s
    // ANTES del commit. Sin ella, la primera transacción confirma en milisegundos y
    // las demás (que llegan con unos ms de desfase) ya la ven: la prueba pasaría
    // aunque no hubiera protección. Con la ventana, todas compiten de verdad.
    const reaplicarB1 = () => execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { input: readFileSync("db/crm-b1-prospeccion.sql", "utf8"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const abrirVentana = () => sql(`create or replace function public.crm_auditar_entidad(p_rol text, p_usuario uuid, p_entidad text, p_id uuid, p_accion text, p_datos jsonb)
      returns void language plpgsql volatile set search_path = public as $fn$
      begin
        insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
        values (p_rol, p_usuario, p_entidad, p_id, p_accion, coalesce(p_datos, '{}'::jsonb));
        if p_entidad = 'crm_oportunidades' and p_accion = 'creacion' then perform pg_sleep(1); end if;
      end $fn$;`);
    async function carrera(empresa: string, n: number): Promise<{ status: number[]; abiertas: number; creadoras: number; ms: number }> {
      // n jornadas cerradas cargadas por admin para el mismo comercial (cada visita
      // bloquea SU jornada, así que solo el negocio las serializa) + la abierta.
      const jornadas: string[] = [];
      for (let i = 0; i < n; i++) {
        const j = await aSend(A.jornadas.POST, "POST", "/api/admin/crm/jornadas", { datos: { usuario_id: UA.id, fecha: hoy, nombre: `carrera ${i}` } });
        assert.equal(j.status, 201, j.texto);
        jornadas.push(String(j.json.id));
      }
      const contacto = (i: number) => ({ nombre: `Carrera ${i}`, telefono: `35170000${String(i).padStart(2, "0")}` });
      const t0 = Date.now();
      const r = await Promise.all([
        visitaC(UA, { jornada_id: JA, empresa_id: empresa, hablo_con_responsable: true, contacto_obtenido: true, contacto_nuevo: contacto(99) }),
        ...jornadas.map((j, i) => visitaA({ jornada_id: j, realizada_por: UA.id, empresa_id: empresa, hablo_con_responsable: true, contacto_obtenido: true, contacto_nuevo: contacto(i) })),
      ]);
      return {
        status: r.map((x) => x.status), ms: Date.now() - t0,
        abiertas: oppAbiertas(empresa),
        creadoras: contar("crm_visitas", `empresa_id = ${lit(empresa)} and creo_oportunidad`),
      };
    }
    {
      const NCTRL = await crearNegocioA({ nombre_comercial: `${MARCA} Control`, responsable_id: UA.id });
      let protegido: Awaited<ReturnType<typeof carrera>>;
      let control: Awaited<ReturnType<typeof carrera>>;
      try {
        abrirVentana();
        protegido = await carrera(NCONC, 7);
        // Control: sin el bloqueo del negocio ni el índice único, la misma carrera
        // tiene que duplicar (si no, la prueba no estaría probando nada).
        sql(`drop index public.crm_oportunidades_una_abierta_uidx;
          create or replace function public.crm_empresa_para_actor(p_id uuid, p_rol text, p_usuario uuid)
          returns public.crm_empresas language plpgsql volatile set search_path = public as $fn$
          declare v public.crm_empresas%rowtype;
          begin
            select * into v from public.crm_empresas where id = p_id;
            if not found or (p_rol = 'comercial' and (v.responsable_id is distinct from p_usuario or v.archivada_en is not null)) then
              raise exception 'empresa_no_encontrada' using errcode = 'P0002';
            end if;
            return v;
          end $fn$;`);
        control = await carrera(NCTRL, 7);
      } finally {
        // Se cierran las duplicadas del control y se reaplica la migración
        // (idempotente): vuelven el índice, el bloqueo y la auditoría sin espera.
        sql(`update public.crm_oportunidades set cerrada_en = now(), cierre_motivo = 'origen_anulado'
              where empresa_id = ${lit(NCTRL)} and cerrada_en is null
                and id <> (select id from public.crm_oportunidades where empresa_id = ${lit(NCTRL)} and cerrada_en is null order by lead_en limit 1);`);
        reaplicarB1();
      }
      console.log(`  carrera de 8 visitas con contacto útil al mismo negocio: protegida → ${protegido!.abiertas} oportunidad (${protegido!.ms} ms);`
        + ` control sin protecciones → ${control!.abiertas} oportunidades (${control!.ms} ms)`);
      assert.ok(protegido!.status.every((s) => s === 201), `todas se registran: ${protegido!.status.join(",")}`);
      assert.equal(protegido!.abiertas, 1, "una sola oportunidad abierta");
      assert.equal(protegido!.creadoras, 1, "una sola visita la originó");
      assert.equal(contar("crm_visitas", `empresa_id = ${lit(NCONC)} and oportunidad_id is null`), 0, "todas quedan ligadas a esa oportunidad");
      assert.ok(control!.abiertas > 1, "el control sin protecciones duplica: la carrera es real");
      assert.equal(sql("select count(*) from pg_indexes where indexname = 'crm_oportunidades_una_abierta_uidx'"), "1", "índice restaurado");
      assert.match(sql("select pg_get_functiondef('public.crm_empresa_para_actor(uuid,text,uuid)'::regprocedure)"), /for update/i, "bloqueo restaurado");
      assert.doesNotMatch(sql("select pg_get_functiondef('public.crm_auditar_entidad(text,uuid,text,uuid,text,jsonb)'::regprocedure)"), /pg_sleep/, "auditoría restaurada");
      const reintento = await carrera(NCONC, 3);
      assert.equal(reintento.abiertas, 1, "restaurado: sigue una sola");
    }

    // ── 12) Medianoche y la jornada de ayer ────────────────────────────────
    {
      assert.equal(sql("select public.crm_fecha_sim('2026-10-31T02:59:00Z')::text"), "2026-10-30", "23:59 en Córdoba sigue siendo el 30");
      assert.equal(sql("select public.crm_fecha_sim('2026-10-31T03:00:00Z')::text"), "2026-10-31", "00:00 en Córdoba ya es el 31");
      // La jornada abierta queda "de ayer" (el comercial no la cerró).
      sql(`update public.crm_jornadas set fecha = fecha - 1, abierta_en = abierta_en - interval '1 day' where id = ${lit(JA)}`);
      const ini = await cGet(C.inicio.GET, "/comercial/api/inicio", UA);
      assert.equal(o(ini.json.jornada_abierta).id, JA, "sigue abierta (nunca se cierra sola)");
      assert.equal(o(ini.json.jornada_abierta).fecha, dia(-1));
      const pasada = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_empleado: true });
      assert.equal(pasada.status, 201, "después de medianoche se puede seguir en la jornada de ayer");
      assert.equal(o(pasada.json.visita).fecha, hoy, "la visita lleva SU fecha");
      sql(`update public.crm_jornadas set fecha = fecha - 1 where id = ${lit(JA)}`);
      const vieja = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_empleado: true });
      assert.equal(vieja.status, 409, "una jornada de antes de ayer no recibe visitas de hoy");
      assert.equal(vieja.json.codigo, "jornada_de_otra_fecha");
      const nVisitas = contar("crm_visitas", `jornada_id = ${lit(JA)}`);
      const vJ = Number(sql(`select version from public.crm_jornadas where id = ${lit(JA)}`));
      const cierre = await cSend(C.jornada.PATCH, "PATCH", `/comercial/api/jornadas/${JA}`, UA, { version: vJ, cerrar: true }, JA);
      assert.equal(cierre.status, 200, "se cierra la vieja sin inventar km");
      assert.equal(sql(`select coalesce(km_final::text, 'null') || '|' || km_inicial from public.crm_jornadas where id = ${lit(JA)}`), "null|1000.0", "km finales siguen pendientes");
      assert.equal(contar("crm_visitas", `jornada_id = ${lit(JA)}`), nVisitas, "sus visitas no se reasignan");
      const nueva = await cSend(C.jornadas.POST, "POST", "/comercial/api/jornadas", UA, { datos: { km_inicial: 1100 } });
      assert.equal(nueva.status, 201, "y abre la de hoy");
      const cerrada = await visitaC(UA, { jornada_id: JA, empresa_id: NA2, hablo_con_empleado: true });
      assert.equal(cerrada.status, 409, "una jornada cerrada no recibe visitas del comercial");
      assert.equal(cerrada.json.codigo, "jornada_cerrada");
      JA = String(nueva.json.id);

      // Admin carga una jornada ya realizada (ayer) y visitas cerca de medianoche.
      const ja = await aSend(A.jornadas.POST, "POST", "/api/admin/crm/jornadas", { datos: { usuario_id: UA.id, fecha: dia(-1), km_inicial: 500, km_final: 520 } });
      assert.equal(ja.status, 201, ja.texto);
      const JAYER = String(ja.json.id);
      assert.notEqual(sql(`select cerrada_en from public.crm_jornadas where id = ${lit(JAYER)}`), "", "la que carga admin queda cerrada");
      const futura = await aSend(A.jornadas.POST, "POST", "/api/admin/crm/jornadas", { datos: { usuario_id: UA.id, fecha: dia(1) } });
      assert.equal(futura.status, 400, "no se cargan jornadas futuras");
      const v2350 = await visitaA({ jornada_id: JAYER, realizada_por: UA.id, empresa_id: NA2, hablo_con_empleado: true, ocurrida_en: `${dia(-1)}T23:50:00-03:00` });
      assert.equal(v2350.status, 201, v2350.texto);
      assert.equal(o(v2350.json.visita).fecha, dia(-1));
      const v0010 = await visitaA({ jornada_id: JAYER, realizada_por: UA.id, empresa_id: NA2, hablo_con_empleado: true, ocurrida_en: `${hoy}T00:10:00-03:00` });
      assert.equal(v0010.status, 201, "00:10 de hoy entra en la jornada de ayer");
      assert.equal(o(v0010.json.visita).fecha, hoy);
      const antes = await visitaA({ jornada_id: JAYER, realizada_por: UA.id, empresa_id: NA2, hablo_con_empleado: true, ocurrida_en: `${dia(-2)}T23:00:00-03:00` });
      assert.equal(antes.status, 409, "antes del día de la jornada");
      const fut = await visitaA({ jornada_id: JAYER, realizada_por: UA.id, empresa_id: NA2, hablo_con_empleado: true, ocurrida_en: new Date(Date.now() + 3_600_000).toISOString() });
      assert.equal(fut.status, 400, "hora futura");
      const autor = await visitaA({ jornada_id: JAYER, realizada_por: UB.id, empresa_id: NA2, hablo_con_empleado: true, ocurrida_en: `${dia(-1)}T12:00:00-03:00` });
      assert.equal(autor.status, 404, "la jornada tiene que ser de quien hizo la visita");
      const id = String(o(v2350.json.visita).id);
      assert.equal(sql(`select realizada_por_usuario || '|' || registrada_por_rol || '|' || coalesce(registrada_por_usuario::text, 'null') from public.crm_visitas where id = ${lit(id)}`),
        `${UA.id}|admin|null`, "quién la hizo ≠ quién la cargó");
      const fichaCom = await cGet(C.negocio.GET, `/comercial/api/negocios/${NA2}`, UA, NA2);
      const vv = arr(fichaCom.json.visitas).find((x) => x.id === id)!;
      assert.equal(o(vv.realizada_por).tipo, "vos");
      assert.equal(o(vv.registrada_por).tipo, "admin");
    }

    // ── 13) Notas, revisitas y archivo ─────────────────────────────────────
    {
      // Nota sobre una visita vieja (sin ventana de 48 h).
      sql(`update public.crm_visitas set ocurrida_en = ocurrida_en - interval '5 days' where id = ${lit(V_CERRADO)}`);
      const n1 = await cSend(C.notas.POST, "POST", `/comercial/api/visitas/${V_CERRADO}/notas`, UA, { texto: "Volví a pasar: sigue cerrado." }, V_CERRADO);
      assert.equal(n1.status, 201, n1.texto);
      assert.equal((await cSend(C.notas.POST, "POST", `/comercial/api/visitas/${V_CERRADO}/notas`, UA, { texto: "  " }, V_CERRADO)).status, 400, "nota vacía");
      const vB = sql(`select id from public.crm_visitas where realizada_por_usuario = ${lit(UA.id)} limit 1`);
      assert.equal((await cSend(C.notas.POST, "POST", `/comercial/api/visitas/${vB}/notas`, UB, { texto: "ajena" }, vB)).status, 404, "nota en visita ajena");
      // Revisita: el comercial reprograma la suya; la ajena es 404.
      const t = await visitaC(UA, { jornada_id: JA, empresa_id: NA3, hablo_con_responsable: true, volver_otro_dia: true });
      assert.equal(t.status, 201);
      const T = String(o(t.json.tarea).id);
      assert.equal(o(t.json.tarea).vence_el, null, "revisita sin fecha");
      assert.equal((await cSend(C.tarea.PATCH, "PATCH", `/comercial/api/tareas/${T}`, UB, { version: 1, accion: "cancelar", motivo: "x" }, T)).status, 404, "revisita ajena");
      const rep = await cSend(C.tarea.PATCH, "PATCH", `/comercial/api/tareas/${T}`, UA, { version: 1, accion: "reprogramar", vence_el: dia(5) }, T);
      assert.equal(rep.status, 200, rep.texto);
      assert.equal((await cSend(C.tarea.PATCH, "PATCH", `/comercial/api/tareas/${T}`, UA, { version: 2, accion: "cancelar" }, T)).status, 400, "cancelar exige motivo");
      const ini = await cGet(C.inicio.GET, "/comercial/api/inicio", UA);
      assert.ok(arr(ini.json.revisitas).some((x) => x.id === T && x.vence_el === dia(5)), "aparece en el inicio");
      assert.ok(arr(ini.json.visitas_hoy).every((x) => o(x.realizada_por).tipo === "vos"), "el inicio solo trae sus visitas");
      // Archivo: conserva la historia; el comercial deja de verlo.
      const vNA3 = versionEmpresa(NA3);
      assert.equal((await aSend(A.negocio.PATCH, "PATCH", `/api/admin/crm/negocios/${NA3}`, { accion: "archivar", version: vNA3 }, NA3)).status, 400, "archivar exige motivo");
      const ar = await aSend(A.negocio.PATCH, "PATCH", `/api/admin/crm/negocios/${NA3}`, { accion: "archivar", version: vNA3, motivo: "Duplicado confirmado" }, NA3);
      assert.equal(ar.status, 200, ar.texto);
      assert.equal((await cGet(C.negocio.GET, `/comercial/api/negocios/${NA3}`, UA, NA3)).status, 404, "archivado: el comercial no lo ve");
      assert.equal((await visitaC(UA, { jornada_id: JA, empresa_id: NA3, hablo_con_empleado: true })).status, 404);
      const fa = await fichaA(NA3);
      assert.equal(o(fa.empresa).estado, "archivado");
      assert.ok(arr(fa.visitas).length >= 1, "la historia sigue");
      assert.equal((await visitaA({ jornada_id: JA, realizada_por: UA.id, empresa_id: NA3, hablo_con_empleado: true })).json.codigo, "empresa_archivada");
    }

    // ── 14) Reasignación: la atribución del origen se conserva ─────────────
    {
      const ra = await aSend(A.negocio.PATCH, "PATCH", `/api/admin/crm/negocios/${NA1}`, { version: versionEmpresa(NA1), cambios: { responsable_id: UB.id } }, NA1);
      assert.equal(ra.status, 200, ra.texto);
      assert.equal((await cGet(C.negocio.GET, `/comercial/api/negocios/${NA1}`, UA, NA1)).status, 404, "A ya no lo ve");
      const fB = await cGet(C.negocio.GET, `/comercial/api/negocios/${NA1}`, UB, NA1);
      assert.equal(fB.status, 200);
      assert.equal(o(arr(fB.json.oportunidades)[0].origen).tipo, "otro", "para B, el origen es «Otro comercial» (sin nombre)");
      assert.ok(!fB.texto.includes(UA.nombre) && !fB.texto.includes(UA.id), "B no recibe nombre ni id de A");
      const jB = sql(`select id from public.crm_jornadas where usuario_id = ${lit(UB.id)} and cerrada_en is null`);
      const vb = await visitaC(UB, { jornada_id: jB, empresa_id: NA1, hablo_con_responsable: true, contacto_id: CA1, contacto_obtenido: true, interes: "caliente" });
      assert.equal(vb.status, 201, vb.texto);
      assert.equal(sql(`select origen_usuario_id || '|' || origen_visita_id from public.crm_oportunidades where id = ${lit(OPP_NA1)}`), `${UA.id}|${V_EMPLEADO}`, "el origen sigue siendo de A");
      const aud = sql(`select count(*) from public.crm_auditoria where entidad = 'crm_empresas' and entidad_id = ${lit(NA1)} and accion = 'asignacion'`);
      assert.equal(aud, "1", "la reasignación se audita");
    }

    // ── 15) Corrección y anulación administrativas ─────────────────────────
    {
      const corr = (id: string, body: J) => aSend(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${id}`, { accion: "corregir", ...body }, id);
      const anul = (id: string, body: J) => aSend(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${id}`, { accion: "anular", ...body }, id);
      assert.equal((await corr(V_TIBIO, { version: versionVisita(V_TIBIO), cambios: { interes: "frio" } })).status, 400, "corregir exige motivo");
      const sCom = await S.corregirVisita({ rol: "comercial", usuarioId: UA.id }, V_TIBIO, versionVisita(V_TIBIO), { interes: "frio" }, "quiero");
      assert.ok(!sCom.ok && sCom.e?.status === 403, "el comercial no corrige (ni llamando al servidor directo)");
      const sAn = await S.anularVisita({ rol: "comercial", usuarioId: UA.id }, V_TIBIO, versionVisita(V_TIBIO), "quiero", null, null);
      assert.ok(!sAn.ok && sAn.e?.status === 403, "el comercial no anula");
      // NA1: visitas que suben a interesado = V_TIBIO (tibio) y la de B (caliente).
      const c1 = await corr(V_TIBIO, { version: versionVisita(V_TIBIO), cambios: { interes: "frio", necesidades: ["sorteos"] }, motivo: "Lo cargó mal" });
      assert.equal(c1.status, 200, c1.texto);
      assert.equal(sql(`select estado from public.crm_oportunidades where id = ${lit(OPP_NA1)}`), "interesado", "sigue interesado por la visita de B");
      const aud = sql(`select datos::text from public.crm_auditoria where entidad = 'crm_visitas' and entidad_id = ${lit(V_TIBIO)} and accion = 'correccion'`);
      assert.match(aud, /"motivo": "Lo cargó mal"/);
      assert.match(aud, /"antes": \{[^}]*"interes": "tibio"/, "auditoría con antes y después");
      assert.equal((await corr(V_TIBIO, { version: versionVisita(V_TIBIO), cambios: { contacto_obtenido: false }, motivo: "x" })).status, 400, "el resultado no se corrige: se anula");
      // Anular el origen exige resolver la oportunidad.
      const sinRes = await anul(V_EMPLEADO, { version: versionVisita(V_EMPLEADO), motivo: "Visita cargada en el negocio equivocado" });
      assert.equal(sinRes.status, 409);
      assert.equal(sinRes.json.codigo, "resolucion_requerida");
      assert.equal(sql(`select anulada_en is null from public.crm_visitas where id = ${lit(V_EMPLEADO)}`), "t", "sin resolución no se anula nada");
      const malOrigen = await anul(V_EMPLEADO, { version: versionVisita(V_EMPLEADO), motivo: "x", resolucion: "reasignar_origen", nuevo_origen: V_CERRADO });
      assert.equal(malOrigen.status, 400, "el nuevo origen tiene que ser una visita con contacto útil de esa oportunidad");
      const reas = await anul(V_EMPLEADO, { version: versionVisita(V_EMPLEADO), motivo: "Negocio equivocado", resolucion: "reasignar_origen", nuevo_origen: V_TIBIO });
      assert.equal(reas.status, 200, reas.texto);
      assert.equal(sql(`select origen_visita_id || '|' || origen_usuario_id || '|' || (cerrada_en is null) from public.crm_oportunidades where id = ${lit(OPP_NA1)}`),
        `${V_TIBIO}|${UA.id}|true`, "origen reasignado explícitamente");
      assert.equal(sql(`select string_agg(accion, ',' order by en) from public.crm_auditoria where entidad = 'crm_oportunidades' and entidad_id = ${lit(OPP_NA1)}`),
        "creacion,reasignacion_origen");
      const otraVez = await anul(V_EMPLEADO, { version: versionVisita(V_EMPLEADO), motivo: "x" });
      assert.equal(otraVez.status, 409, "ya anulada");
      const fB = await cGet(C.negocio.GET, `/comercial/api/negocios/${NA1}`, UB, NA1);
      assert.ok(!arr(fB.json.visitas).some((x) => x.id === V_EMPLEADO), "la anulada no se muestra al comercial");
      assert.ok(arr(o(await fichaA(NA1)).visitas).some((x) => x.id === V_EMPLEADO && x.anulada === true), "admin la ve anulada");
      // Anular el (nuevo) origen cerrando la oportunidad.
      const cierre = await anul(V_TIBIO, { version: versionVisita(V_TIBIO), motivo: "Prueba de cierre", resolucion: "cerrar_oportunidad" });
      assert.equal(cierre.status, 200, cierre.texto);
      assert.equal(sql(`select cierre_motivo from public.crm_oportunidades where id = ${lit(OPP_NA1)}`), "origen_anulado", "cerrada (no borrada)");
      assert.equal(oppAbiertas(NA1), 0);
      // Una visita que no es origen no admite resolución.
      const noOrigen = sql(`select id from public.crm_visitas where empresa_id = ${lit(NA2)} and cerrado and anulada_en is null limit 1`);
      assert.equal((await anul(noOrigen, { version: versionVisita(noOrigen), motivo: "x", resolucion: "cerrar_oportunidad" })).status, 400);
      // Anular la que creó una revisita la cancela.
      const conTarea = await visitaC(UB, { jornada_id: sql(`select id from public.crm_jornadas where usuario_id = ${lit(UB.id)} and cerrada_en is null`), empresa_id: NA1,
        hablo_con_empleado: true, volver_otro_dia: true, revisita_para: dia(2) });
      assert.equal(conTarea.status, 201);
      const vt = String(o(conTarea.json.visita).id);
      assert.equal((await anul(vt, { version: versionVisita(vt), motivo: "Cargada dos veces" })).status, 200);
      assert.equal(sql(`select estado from public.crm_tareas where origen_visita_id = ${lit(vt)}`), "cancelada");
    }

    // ── 16) Lo que ve cada uno, auditoría y errores ────────────────────────
    {
      const deA = (respuestasDe.get("A") ?? []).join("\n");
      for (const prohibido of [UB.nombre, UB.id, "Bv. San Juan 900", "3517770001", "351 777-0001", "Dueño de Bruno", NB1, NSIN]) {
        assert.ok(!deA.includes(prohibido), `una respuesta a A filtró «${prohibido}»`);
      }
      const telefonos = sql(`select count(*) from public.crm_auditoria a where a.actor_usuario_id in (${lit(UA.id)}, ${lit(UB.id)})
        and a.datos::text ~* '5550000|5551234|7770001|6001111|4445566|70000[0-9]{2}|telefono'`);
      assert.equal(telefonos, "0", "la auditoría no copia teléfonos");
      const sinActor = sql(`select count(*) from public.crm_auditoria where entidad like 'crm_%' and entidad <> 'crm_usuarios'
        and ((actor_rol = 'comercial' and actor_usuario_id is null) or actor_rol not in ('admin', 'comercial'))`);
      assert.equal(sinActor, "0");
      const regs = sql(`select count(*) from public.crm_auditoria where entidad = 'crm_visitas' and accion = 'registro' and actor_usuario_id = ${lit(UA.id)}`);
      assert.ok(Number(regs) >= 10, "cada visita registrada se audita");
      for (const t of respuestas) {
        assert.ok(!/violates|constraint|relation "|PGRST|syntax error|plpgsql|duplicate key/i.test(t), `respuesta con detalle interno: ${t.slice(0, 200)}`);
      }
      for (const s of secretos) {
        assert.ok(!respuestas.some((t) => t.includes(s)), "ningún secreto en respuestas");
        assert.ok(!logs.some((l) => l.includes(s)), "ningún secreto en logs");
      }
      // Normalización del navegador = la de la base.
      const casos = ["Peluquería  Ñandú", "  LUBRICENTRO El Güero!! ", "Av. Colón 1.234", "Façade", "Óptica—Señal"];
      for (const c of casos) {
        assert.equal(B.normalizarTexto(c), sql(`select coalesce(public.crm_normalizar_texto(${lit(c)}), '')`), `normalización igual a la base: ${c}`);
      }
    }

    console.log("OK — crmB1 integración: permisos y alcance, IDs cruzados, negocios y duplicados, contactos, jornadas, visitas, idempotencia, concurrencia real con control, medianoche, reasignación, corrección, anulación, archivo y auditoría.");
  } finally {
    limpiar();
  }
}

main().catch((e) => {
  console.error(e);
  try { limpiar(); } catch { /* ya se informó el error principal */ }
  process.exit(1);
});
