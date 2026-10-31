// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// Integración del CRM B2 (seguimiento de Administración) contra la instancia LOCAL
// aislada del CRM, con db/crm-b0, b1 y b2 aplicados. Por las rutas reales:
//   · lead de una visita de B1 en la bandeja; consultar no lo marca gestionado;
//   · gestiones con y sin próxima acción, reprogramación, nota y propuesta sin
//     efectos de más; pausa, llegada de la fecha y reanudación; pérdida con
//     historia; reapertura con y sin otra abierta;
//   · visitas sobre oportunidades avanzadas, pausadas y perdidas; corrección y
//     anulación de visitas con seguimiento;
//   · reintentos (secuenciales y en paralelo) y concurrencia real sobre la
//     próxima acción, con control negativo;
//   · permisos (sin sesión, staff, comercial, admin) y ausencia de lo privado de
//     Administración en las respuestas comerciales; reasignación sin acceso;
//   · fecha de SIM, contadores = grupos = filas; advertencias que no esconden.
//
// Ejecutar: node scripts/pruebas/crm-local.mjs suite lib/crmB2.integration.ts

const MARCA = `zzcrmb2${Date.now().toString(36)}`;
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
    create temp table zz_u as select id from public.crm_usuarios where usuario like 'zzcrmb2%';
    create temp table zz_e as select id from public.crm_empresas where nombre_comercial like 'zzcrmb2%' or responsable_id in (select id from zz_u);
    create temp table zz_o as select id from public.crm_oportunidades where empresa_id in (select id from zz_e);
    create temp table zz_v as select id from public.crm_visitas where empresa_id in (select id from zz_e);
    create temp table zz_x as select id from public.crm_actividades where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_seguimientos where oportunidad_id in (select id from zz_o)
      union all select id from public.crm_contactos where empresa_id in (select id from zz_e)
      union all select id from public.crm_jornadas where usuario_id in (select id from zz_u)
      union all select id from public.crm_tareas where empresa_id in (select id from zz_e)
      union all select id from public.crm_visita_notas where visita_id in (select id from zz_v);
    delete from public.crm_auditoria where entidad_id in (select id from zz_u union all select id from zz_e union all select id from zz_o
      union all select id from zz_v union all select id from zz_x) or actor_usuario_id in (select id from zz_u);
    delete from public.crm_operaciones where oportunidad_id in (select id from zz_o);
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

const respuestas: string[] = [];
const deComercial: string[] = [];
const secretos = new Set<string>();
let ipN = 0;
const ip = () => `10.99.${Math.floor(++ipN / 250)}.${ipN % 250}`;
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
  const B2 = await import("@/lib/crmB2");
  const USUARIOS = await import("@/app/api/admin/crm/usuarios/route");
  const INGRESAR = await import("@/app/comercial/api/ingresar/route");
  const C = {
    inicio: await import("@/app/comercial/api/inicio/route"),
    negocio: await import("@/app/comercial/api/negocios/[id]/route"),
    negocios: await import("@/app/comercial/api/negocios/route"),
    jornadas: await import("@/app/comercial/api/jornadas/route"),
    visitas: await import("@/app/comercial/api/visitas/route"),
    contactos: await import("@/app/comercial/api/negocios/[id]/contactos/route"),
  };
  const A = {
    seguimiento: await import("@/app/api/admin/crm/seguimiento/route"),
    oportunidad: await import("@/app/api/admin/crm/oportunidades/[id]/route"),
    negocios: await import("@/app/api/admin/crm/negocios/route"),
    negocio: await import("@/app/api/admin/crm/negocios/[id]/route"),
    contacto: await import("@/app/api/admin/crm/contactos/[id]/route"),
    visita: await import("@/app/api/admin/crm/visitas/[id]/route"),
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
  const UB = await crearUsuario("otro", `Bruno ${MARCA}`);
  const hoyDb = sql("select public.crm_fecha_sim(now())");
  const dia = (d: number) => sql(`select (${lit(hoyDb)}::date + ${d})::text`);

  const negocioA = async (nombre: string, responsable = UA.id) => {
    const r = await http(A.negocios.POST, "POST", "/api/admin/crm/negocios", { cookies: comoAdmin, body: { datos: { nombre_comercial: `${MARCA} ${nombre}`, responsable_id: responsable } } });
    assert.equal(r.status, 201, r.texto);
    return String(r.json.id);
  };
  const jA = await http(C.jornadas.POST, "POST", "/comercial/api/jornadas", { cookies: UA.cookies, body: { datos: {} }, comercial: true });
  assert.equal(jA.status, 201);
  const JA = String(jA.json.id);
  const jB = await http(C.jornadas.POST, "POST", "/comercial/api/jornadas", { cookies: UB.cookies, body: { datos: {} }, comercial: true });
  const JB = String(jB.json.id);
  const visita = (u: typeof UA, datos: J) => http(C.visitas.POST, "POST", "/comercial/api/visitas",
    { cookies: u.cookies, body: { clave: randomUUID(), datos: { jornada_id: u === UA ? JA : JB, ...datos } }, comercial: true });
  const telefono = () => `+54 9 351 ${String(Math.floor(Math.random() * 9e6) + 1e6)}`;
  const lead = async (empresa: string, extra: J = {}) => {
    const r = await visita(UA, { empresa_id: empresa, hablo_con_responsable: true, contacto_obtenido: true, hablo_con_contacto: true,
      contacto_nuevo: { nombre: "Dueño", cargo: "Dueño", telefono: telefono(), es_decisor: "si" }, necesidades: ["fidelizacion", "sorteos"], pack_potencial: "25",
      observacion: "Le interesa para el día del cliente", ...extra });
    assert.equal(r.status, 201, r.texto);
    return { op: String(o(r.json.oportunidad).id), visita: String(o(r.json.visita).id), contacto: String(r.json.contacto_id) };
  };
  const bandeja = async (qs = "") => {
    const r = await http(A.seguimiento.GET, "GET", `/api/admin/crm/seguimiento?q=${encodeURIComponent(MARCA)}${qs}`, { cookies: comoAdmin });
    assert.equal(r.status, 200, r.texto);
    return r.json as unknown as { hoy: string; conteos: Record<string, number>; total: number; filas: B2_Fila[] };
  };
  type B2_Fila = J & { id: string; grupo: string; estado: string; gestionada: boolean; advertencias: string[]; pendiente: J | null; version: number };
  const fila = async (id: string, qs = "") => (await bandeja(qs)).filas.find((x) => x.id === id);
  const detalle = (id: string) => http(A.oportunidad.GET, "GET", `/api/admin/crm/oportunidades/${id}`, { cookies: comoAdmin, id });
  const version = (id: string) => Number(sql(`select version from public.crm_oportunidades where id = ${lit(id)}`));
  const gestion = (id: string, accion: string, datos: J = {}, extra: { clave?: string; version?: number; cookies?: Record<string, string> } = {}) =>
    http(A.oportunidad.POST, "POST", `/api/admin/crm/oportunidades/${id}`, {
      cookies: extra.cookies ?? comoAdmin, id, body: { clave: extra.clave ?? randomUUID(), version: extra.version ?? version(id), accion, datos },
    });
  const contar = (t: string, w: string) => Number(sql(`select count(*) from public.${t} where ${w}`));
  const estado = (id: string) => sql(`select estado from public.crm_oportunidades where id = ${lit(id)}`);
  const pendientes = (id: string) => contar("crm_seguimientos", `oportunidad_id = ${lit(id)} and estado = 'pendiente'`);

  try {
    // ── 1) Permisos ──────────────────────────────────────────────────────
    const N1 = await negocioA("Barbería Uno");
    const L1 = await lead(N1);
    // El lead se corre un día atrás para poder registrar gestiones con un momento anterior al registro.
    sql(`update public.crm_oportunidades set lead_en = lead_en - interval '1 day', ciclo_inicio_en = ciclo_inicio_en - interval '1 day' where id = ${lit(L1.op)}`);
    {
      for (const [cookies, esperado, quien] of [[{}, 401, "sin sesión"], [{ [ADMIN_COOKIE]: staff }, 403, "staff"], [UA.cookies, 401, "comercial"]] as const) {
        assert.equal((await http(A.seguimiento.GET, "GET", "/api/admin/crm/seguimiento", { cookies })).status, esperado, `bandeja: ${quien}`);
        assert.equal((await http(A.oportunidad.GET, "GET", `/api/admin/crm/oportunidades/${L1.op}`, { cookies, id: L1.op })).status, esperado, `detalle: ${quien}`);
        assert.equal((await gestion(L1.op, "gestion", { tipo: "llamada" }, { cookies })).status, esperado, `gestión: ${quien}`);
      }
      assert.equal(contar("crm_actividades", `oportunidad_id = ${lit(L1.op)}`), 0, "nada se escribió sin permiso");
      assert.equal((await detalle(randomUUID())).status, 404);
      assert.equal((await gestion(L1.op, "inventada", {})).status, 400, "acción desconocida");
      const sinClave = await http(A.oportunidad.POST, "POST", `/api/admin/crm/oportunidades/${L1.op}`, { cookies: comoAdmin, id: L1.op, body: { version: 1, accion: "gestion", datos: { tipo: "llamada" } } });
      assert.equal(sinClave.status, 400, "sin clave de idempotencia");
    }

    // ── 2) Lead de B1 en la bandeja; consultar no gestiona ───────────────
    {
      const f = await fila(L1.op);
      assert.ok(f, "el lead de la visita aparece");
      assert.equal(f!.grupo, "nuevos");
      assert.equal(f!.gestionada, false);
      assert.equal(o(f!.contacto).nombre, "Dueño");
      assert.deepEqual(f!.necesidades, ["fidelizacion", "sorteos"]);
      assert.equal(f!.pack, "25");
      assert.equal(o(f!.nota_comercial).texto, "Le interesa para el día del cliente");
      assert.equal(o(f!.origen).nombre, UA.nombre);
      const v0 = version(L1.op);
      const d1 = await detalle(L1.op);
      assert.equal(d1.status, 200);
      await detalle(L1.op);
      assert.equal(version(L1.op), v0, "consultar no cambia la versión");
      assert.equal(sql(`select coalesce(gestionada_en::text, 'null') from public.crm_oportunidades where id = ${lit(L1.op)}`), "null", "abrir no la marca gestionada");
      assert.equal(contar("crm_actividades", `oportunidad_id = ${lit(L1.op)}`), 0, "abrir (y WhatsApp, que es solo un enlace) no registra nada");
      assert.equal((await fila(L1.op))!.grupo, "nuevos");
    }

    // ── 3) Gestiones, próximas acciones, nota y propuesta ────────────────
    {
      const wa = await gestion(L1.op, "gestion", { tipo: "whatsapp_enviado", contacto_id: L1.contacto, observacion: "Le pasé la info", proxima: { vence_el: dia(1), descripcion: "Ver si respondió" } });
      assert.equal(wa.status, 201, wa.texto);
      assert.equal(estado(L1.op), "contacto", "WhatsApp enviado no cambia el estado");
      let f = await fila(L1.op);
      assert.equal(f!.grupo, "proximas");
      assert.equal(o(f!.ultima_gestion).tipo, "whatsapp_enviado");
      const s1 = String(o(f!.pendiente).id);
      const nota = await gestion(L1.op, "gestion", { tipo: "nota", observacion: `NOTA-PRIVADA-${MARCA}` });
      assert.equal(nota.status, 201);
      assert.equal(sql(`select estado from public.crm_seguimientos where id = ${lit(s1)}`), "pendiente", "la nota no completa la acción");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "nota", observacion: "x", resolver: s1 })).status, 400, "una nota no puede resolver");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "llamada", proxima: { vence_el: dia(2) } })).json.codigo, "seguimiento_pendiente", "no dos próximas acciones");
      const rep = await gestion(L1.op, "reprogramar", { vence_el: dia(2), descripcion: `TAREA-PRIVADA-${MARCA}`, motivo: "Pidió el jueves" });
      assert.equal(rep.status, 201, rep.texto);
      assert.equal(sql(`select estado from public.crm_seguimientos where id = ${lit(s1)}`), "reprogramada", "la anterior queda en la historia");
      assert.equal(pendientes(L1.op), 1);
      const s2 = String(o(rep.json.seguimiento).id);
      const resp = await gestion(L1.op, "gestion", { tipo: "respondio", resolver: s2 });
      assert.equal(resp.status, 201);
      assert.equal(estado(L1.op), "conversacion", "respondió: contacto → en conversación");
      assert.equal(sql(`select estado from public.crm_seguimientos where id = ${lit(s2)}`), "hecha");
      f = await fila(L1.op);
      assert.equal(f!.grupo, "sin_proxima", "gestión resuelta sin programar la siguiente → sin próxima acción");
      const prop = await gestion(L1.op, "gestion", { tipo: "propuesta_enviada", ocurrida_en: new Date(Date.now() - 3_600_000).toISOString(), proxima: { vence_el: hoyDb } });
      assert.equal(prop.status, 201);
      assert.equal(estado(L1.op), "conversacion", "propuesta enviada no implica negociación");
      assert.equal(sql(`select (propuesta_en < now() - interval '50 minutes')::text from public.crm_oportunidades where id = ${lit(L1.op)}`), "true", "el hito usa el momento de la actividad");
      assert.equal(sql(`select (registrada_en > ocurrida_en + interval '50 minutes')::text from public.crm_actividades where tipo = 'propuesta_enviada' and oportunidad_id = ${lit(L1.op)}`), "true",
        "momento de la actividad ≠ momento de registro");
      assert.equal((await fila(L1.op))!.grupo, "hoy", "próxima acción de hoy (fecha de SIM)");
      assert.equal((await bandeja()).hoy, hoyDb, "la bandeja usa la misma fecha de negocio que la base");
      sql(`update public.crm_seguimientos set vence_el = vence_el - 1 where oportunidad_id = ${lit(L1.op)} and estado = 'pendiente'`);
      assert.equal((await fila(L1.op))!.grupo, "vencidos", "un día después: vencida");
      const sNeg = String(o((await fila(L1.op))!.pendiente).id);
      assert.equal((await gestion(L1.op, "gestion", { tipo: "inicio_negociacion", resolver: sNeg })).status, 201);
      assert.equal(estado(L1.op), "negociacion");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "respondio" })).status, 201);
      assert.equal(estado(L1.op), "negociacion", "un avance no retrocede una etapa más avanzada");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "cambio_estado", estado: "interesado" })).status, 400, "retroceso sin motivo");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "cambio_estado", estado: "negociacion" })).json.codigo, "sin_cambio");
    }

    // ── 4) Visitas de B1 sobre una oportunidad avanzada; correcciones y anulaciones ──
    {
      const v = await visita(UA, { empresa_id: N1, hablo_con_responsable: true, contacto_id: L1.contacto, contacto_obtenido: true, interes: "sin_interes" });
      assert.equal(v.status, 201);
      assert.equal(o(v.json.oportunidad).id, L1.op, "la visita se liga a la abierta");
      assert.equal(estado(L1.op), "negociacion", "la visita no hace retroceder la negociación");
      assert.equal(contar("crm_oportunidades", `empresa_id = ${lit(N1)}`), 1, "elegir un contacto precargado no crea otra");
      const vid = String(o(v.json.visita).id);
      const vv = () => Number(sql(`select version from public.crm_visitas where id = ${lit(vid)}`));
      const corr = await http(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${vid}`, { cookies: comoAdmin, id: vid, body: { accion: "corregir", version: vv(), cambios: { interes: "tibio" }, motivo: "Prueba" } });
      assert.equal(corr.status, 200);
      assert.equal(estado(L1.op), "negociacion", "corregir una visita no recalcula una oportunidad gestionada");
      const vo = () => Number(sql(`select version from public.crm_visitas where id = ${lit(L1.visita)}`));
      const anul = await http(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${L1.visita}`, { cookies: comoAdmin, id: L1.visita, body: { accion: "anular", version: vo(), motivo: "Prueba", resolucion: "cerrar_oportunidad" } });
      assert.equal(anul.status, 409);
      assert.equal(anul.json.codigo, "oportunidad_gestionada", "no se cierra por anulación una oportunidad con gestión");
      assert.equal(sql(`select (anulada_en is null)::text from public.crm_visitas where id = ${lit(L1.visita)}`), "true", "sin cambios parciales");
      assert.equal(sql(`select (cerrada_en is null)::text from public.crm_oportunidades where id = ${lit(L1.op)}`), "true");
      // Reasignar el origen sí se puede y conserva la gestión.
      const util = await visita(UA, { empresa_id: N1, hablo_con_responsable: true, contacto_id: L1.contacto, contacto_obtenido: true });
      const reas = await http(A.visita.PATCH, "PATCH", `/api/admin/crm/visitas/${L1.visita}`, { cookies: comoAdmin, id: L1.visita,
        body: { accion: "anular", version: vo(), motivo: "Cargada en el negocio equivocado", resolucion: "reasignar_origen", nuevo_origen: String(o(util.json.visita).id) } });
      assert.equal(reas.status, 200, reas.texto);
      assert.equal(estado(L1.op), "negociacion", "la gestión sigue");
      assert.ok(contar("crm_actividades", `oportunidad_id = ${lit(L1.op)}`) >= 6, "las actividades siguen");
    }

    // ── 5) Pausa, llegada de la fecha y reanudación ──────────────────────
    {
      assert.equal((await gestion(L1.op, "pausar", { retomar_el: hoyDb })).status, 400, "la fecha de recontacto tiene que ser futura");
      assert.equal((await gestion(L1.op, "programar", { vence_el: dia(1) })).status, 201);
      const pa = await gestion(L1.op, "pausar", { retomar_el: dia(14), motivo: "Temporada alta" });
      assert.equal(pa.status, 201, pa.texto);
      assert.equal(estado(L1.op), "pausada");
      assert.equal(sql(`select tipo || '|' || vence_el from public.crm_seguimientos where oportunidad_id = ${lit(L1.op)} and estado = 'pendiente'`), `retomar|${dia(14)}`,
        "la pausa reemplaza el seguimiento pendiente");
      assert.equal(contar("crm_seguimientos", `oportunidad_id = ${lit(L1.op)} and cancelada_motivo = 'pausa'`), 1);
      assert.equal((await fila(L1.op))!.grupo, "proximas", "antes de la fecha: pausas futuras");
      const vp = await visita(UA, { empresa_id: N1, hablo_con_responsable: true, interes: "caliente" });
      assert.equal(vp.status, 201);
      assert.equal(estado(L1.op), "pausada", "una visita no saca de la pausa");
      assert.equal((await gestion(L1.op, "gestion", { tipo: "inicio_negociacion" })).json.codigo, "oportunidad_pausada");
      sql(`update public.crm_seguimientos set vence_el = ${lit(hoyDb)} where oportunidad_id = ${lit(L1.op)} and estado = 'pendiente';
           update public.crm_oportunidades set retomar_el = ${lit(hoyDb)} where id = ${lit(L1.op)};`);
      assert.equal((await fila(L1.op))!.grupo, "retomar", "llegó la fecha: aparece para retomar");
      assert.equal(estado(L1.op), "pausada", "llegar la fecha no la reanuda sola");
      const re = await gestion(L1.op, "retomar", { proxima: { vence_el: dia(3) } });
      assert.equal(re.status, 201, re.texto);
      assert.equal(estado(L1.op), "negociacion", "retomar recupera el estado previo");
      assert.equal(sql(`select tipo from public.crm_seguimientos where oportunidad_id = ${lit(L1.op)} and estado = 'pendiente'`), "seguimiento");
    }

    // ── 6) Pérdida, visitas posteriores y reapertura ─────────────────────
    let L2op = "";
    {
      const revisitaB1 = await visita(UA, { empresa_id: N1, hablo_con_empleado: true, volver_otro_dia: true, revisita_para: dia(4) });
      assert.equal(revisitaB1.status, 201);
      assert.equal((await gestion(L1.op, "perder", { motivo: "otro" })).status, 400, "«Otro» exige detalle");
      const pe = await gestion(L1.op, "perder", { motivo: "precio" });
      assert.equal(pe.status, 201, pe.texto);
      assert.equal(estado(L1.op), "perdida");
      assert.equal(pendientes(L1.op), 0, "se cancelan sus seguimientos");
      assert.equal(contar("crm_tareas", `empresa_id = ${lit(N1)} and estado = 'pendiente'`), 1, "la revisita de Tobías (otro contexto) queda");
      assert.equal(await fila(L1.op), undefined, "sale de la vista general");
      const pf = await fila(L1.op, "&vista=perdidas");
      assert.equal(o(pf!.perdida).motivo, "precio", "y se consulta en «Perdidas»");
      const det = await detalle(L1.op);
      assert.ok(arr(det.json.actividades).length >= 8 && arr(det.json.visitas).length >= 4, "la historia se conserva");
      // Visita posterior con contacto precargado: no reabre ni crea otra.
      const vpost = await visita(UA, { empresa_id: N1, hablo_con_responsable: true, contacto_id: L1.contacto, contacto_obtenido: true, interes: "caliente" });
      assert.equal(o(vpost.json.oportunidad).estado, "perdida");
      assert.equal(estado(L1.op), "perdida", "la visita no reabre");
      assert.equal(contar("crm_oportunidades", `empresa_id = ${lit(N1)}`), 1);
      assert.equal(o((await fila(L1.op, "&vista=perdidas"))!.perdida).visitas_posteriores, 1, "la bandeja de perdidas lo muestra");
      // Contacto nuevo en la visita: oportunidad realmente nueva.
      const L2 = await lead(N1);
      L2op = L2.op;
      assert.notEqual(L2op, L1.op);
      const r1 = await gestion(L1.op, "reabrir", { motivo: "Volvió a escribir" });
      assert.equal(r1.status, 409);
      assert.equal(r1.json.codigo, "otra_oportunidad_abierta");
      assert.equal(estado(L1.op), "perdida", "sin cambios parciales");
      assert.equal(contar("crm_oportunidad_ciclos", `oportunidad_id = ${lit(L1.op)}`), 0);
      assert.equal((await gestion(L2op, "perder", { motivo: "dejo_de_responder" })).status, 201);
      const r2 = await gestion(L1.op, "reabrir", { motivo: "Volvió a escribir" });
      assert.equal(r2.status, 201, r2.texto);
      assert.equal(sql(`select estado || '|' || ciclo || '|' || (lead_en < ciclo_inicio_en) || '|' || coalesce(negociacion_en::text, 'null')
        from public.crm_oportunidades where id = ${lit(L1.op)}`), "negociacion|2|true|null", "ciclo 2 en la etapa al perder, hitos nuevos vacíos, lead_en intacto");
      assert.equal(sql(`select perdida_motivo || '|' || (negociacion_en is not null) from public.crm_oportunidad_ciclos where oportunidad_id = ${lit(L1.op)}`), "precio|true",
        "el ciclo perdido queda con sus hitos");
      assert.equal(sql(`select origen_usuario_id from public.crm_oportunidades where id = ${lit(L1.op)}`), UA.id, "la atribución no cambia");
      assert.equal((await fila(L1.op))!.grupo, "sin_proxima");
    }

    // ── 7) Reintentos y concurrencia ─────────────────────────────────────
    {
      const clave = randomUUID();
      const v = version(L1.op);
      const a = await gestion(L1.op, "gestion", { tipo: "llamada", observacion: "Reintento" }, { clave, version: v });
      const b = await gestion(L1.op, "gestion", { observacion: "Reintento", tipo: "llamada" }, { clave, version: v });
      assert.equal(a.status, 201);
      assert.equal(b.status, 200, "mismo envío → repetida");
      assert.equal(b.json.actividad_id, a.json.actividad_id);
      assert.equal(contar("crm_actividades", `operacion_clave = ${lit(clave)}`), 1);
      assert.equal((await gestion(L1.op, "gestion", { tipo: "llamada", observacion: "Otra cosa" }, { clave, version: v })).json.codigo, "clave_reutilizada");
      const c2 = randomUUID();
      const v2 = version(L1.op);
      const par = await Promise.all(Array.from({ length: 6 }, () => gestion(L1.op, "gestion", { tipo: "no_respondio" }, { clave: c2, version: v2 })));
      assert.deepEqual(par.map((x) => x.status).sort(), [200, 200, 200, 200, 200, 201], "reintentos simultáneos: uno solo se registra");
      assert.equal(contar("crm_actividades", `operacion_clave = ${lit(c2)}`), 1);

      // Carrera real: varias pestañas programan a la vez con la misma versión.
      // Ventana: la auditoría de la programación espera 1 s ANTES del commit.
      // Se restaura SOLO lo que tocan la ventana y el control, con la definición
      // VIGENTE: la del último archivo de la cadena (db/orden.txt) que la define. B3
      // redefine la gestión; reaplicar el archivo de B2 entero pisaría eso.
      const cadena = readFileSync("db/orden.txt", "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^crm-[a-z0-9-]+\.sql$/.test(l));
      const vigente = (nombre: string) => {
        for (const archivo of [...cadena].reverse()) {
          const t = readFileSync(`db/${archivo}`, "utf8").replace(/\r\n/g, "\n");
          const ini = t.indexOf(`create or replace function public.${nombre}(`);
          if (ini >= 0) return t.slice(ini, t.indexOf("\n$fn$;", ini) + 6);
        }
        throw new Error(`sin definición de ${nombre}`);
      };
      const indicePendiente = readFileSync("db/crm-b2-seguimiento.sql", "utf8").split(/\r?\n/)
        .find((l) => l.startsWith("create unique index if not exists crm_seguimientos_un_pendiente_uidx"));
      assert.ok(indicePendiente, "índice de una pendiente");
      const b1 = readFileSync("db/crm-b1-prospeccion.sql", "utf8").replace(/\r\n/g, "\n");
      const auditarB1 = b1.slice(b1.indexOf("create or replace function public.crm_auditar_entidad("), b1.indexOf("\n$fn$;", b1.indexOf("create or replace function public.crm_auditar_entidad(")) + 6);
      const ventana = () => sql(`create or replace function public.crm_auditar_entidad(p_rol text, p_usuario uuid, p_entidad text, p_id uuid, p_accion text, p_datos jsonb)
        returns void language plpgsql volatile set search_path = public as $fn$
        begin
          insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
          values (p_rol, p_usuario, p_entidad, p_id, p_accion, coalesce(p_datos, '{}'::jsonb));
          if p_accion = 'seguimiento_programado' then perform pg_sleep(1); end if;
        end $fn$;`);
      const carrera = async (op: string) => {
        const vv = version(op);
        const t0 = Date.now();
        const r = await Promise.all(Array.from({ length: 6 }, (_, i) => gestion(op, "programar", { vence_el: dia(i + 1) }, { version: vv })));
        return { status: r.map((x) => x.status).sort(), pendientes: pendientes(op), ms: Date.now() - t0 };
      };
      const N3 = await negocioA("Control carrera");
      const L3 = await lead(N3);
      let protegido: Awaited<ReturnType<typeof carrera>>;
      let control: Awaited<ReturnType<typeof carrera>>;
      try {
        ventana();
        protegido = await carrera(L1.op);
        // Control negativo: la misma función sin el FOR UPDATE de la oportunidad y sin
        // el índice de una pendiente por oportunidad.
        const fn = vigente("crm_oportunidad_gestionar");
        const sinBloqueo = fn.replace("select * into o from public.crm_oportunidades where id = p_oportunidad for update;", "select * into o from public.crm_oportunidades where id = p_oportunidad;")
          .replace("s.oportunidad_id = o.id and s.estado = 'pendiente'));", "s.oportunidad_id = o.id and s.estado = 'pendiente' limit 1));");
        assert.notEqual(sinBloqueo, fn, "el control quita el bloqueo");
        assert.ok(sinBloqueo.includes("'pendiente' limit 1));"), "el control tolera duplicados al armar el resultado");
        sql(`drop index public.crm_seguimientos_un_pendiente_uidx;\n${sinBloqueo}`);
        control = await carrera(L3.op);
      } finally {
        sql(`update public.crm_seguimientos s set estado = 'cancelada', cancelada_motivo = 'pausa', cerrada_en = now()
              where s.oportunidad_id = ${lit(L3.op)} and s.estado = 'pendiente'
                and s.id <> (select id from public.crm_seguimientos where oportunidad_id = ${lit(L3.op)} and estado = 'pendiente' order by creada_en limit 1);
              ${auditarB1}\n${vigente("crm_oportunidad_gestionar")}\n${indicePendiente}`);
      }
      console.log(`  carrera de 6 programaciones simultáneas: protegida → ${protegido!.pendientes} pendiente (${protegido!.status.join(",")}); `
        + `control sin bloqueo ni índice → ${control!.pendientes} pendientes (${control!.ms} ms)`);
      assert.equal(protegido!.pendientes, 1, "una sola próxima acción pendiente");
      assert.deepEqual(protegido!.status, [201, 409, 409, 409, 409, 409], "una gana; las demás ven la versión vieja");
      assert.ok(control!.pendientes > 1, "el control sin protecciones duplica: la carrera es real");
      assert.equal(sql("select count(*) from pg_indexes where indexname = 'crm_seguimientos_un_pendiente_uidx'"), "1", "índice restaurado");
      assert.match(sql("select pg_get_functiondef('public.crm_oportunidad_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)'::regprocedure)"),
        /where id = p_oportunidad for update/, "bloqueo restaurado");
      assert.doesNotMatch(sql("select pg_get_functiondef('public.crm_auditar_entidad(text,uuid,text,uuid,text,jsonb)'::regprocedure)"), /pg_sleep/, "auditoría restaurada");
    }

    // ── 8) Comercial: resumen permitido, nada privado; reasignación ──────
    {
      const fichaA = await http(C.negocio.GET, "GET", `/comercial/api/negocios/${N1}`, { cookies: UA.cookies, id: N1, comercial: true });
      assert.equal(fichaA.status, 200);
      const opps = arr(fichaA.json.oportunidades);
      assert.ok(opps.some((x) => x.id === L1.op && x.estado === "negociacion"), "Tobías ve el estado de la abierta");
      assert.ok(opps.some((x) => x.id === L2op && x.estado === "perdida"), "y que hay una perdida");
      for (const x of opps) assert.deepEqual(Object.keys(x).sort(), ["abierta", "cierre_motivo", "estado", "id", "interesado_en", "lead_en", "origen", "origen_visita_id"]);
      assert.ok(opps.every((x) => x.interesado_en === null), "sin hitos de Administración");
      await http(C.inicio.GET, "GET", "/comercial/api/inicio", { cookies: UA.cookies, comercial: true });
      await http(C.negocios.GET, "GET", "/comercial/api/negocios", { cookies: UA.cookies, comercial: true });
      const todo = deComercial.join("\n");
      for (const prohibido of [`NOTA-PRIVADA-${MARCA}`, `TAREA-PRIVADA-${MARCA}`, "Temporada alta", "Volvió a escribir", "perdida_motivo", "retomar_el", "gestionada_en", "seguimiento"]) {
        assert.ok(!todo.includes(prohibido), `una respuesta comercial incluye «${prohibido}»`);
      }
      // Creado por Tobías y reasignado: conserva la autoría, pierde el acceso.
      const propio = await http(C.negocios.POST, "POST", "/comercial/api/negocios", { cookies: UA.cookies, body: { datos: { nombre_comercial: `${MARCA} Propio` } }, comercial: true });
      const NP = String(propio.json.id);
      const cont = await http(C.contactos.POST, "POST", `/comercial/api/negocios/${NP}/contactos`, { cookies: UA.cookies, id: NP, body: { datos: { nombre: "Encargada" } }, comercial: true });
      assert.equal(cont.status, 201);
      const vEmp = Number(sql(`select version from public.crm_empresas where id = ${lit(NP)}`));
      assert.equal((await http(A.negocio.PATCH, "PATCH", `/api/admin/crm/negocios/${NP}`, { cookies: comoAdmin, id: NP, body: { version: vEmp, cambios: { responsable_id: UB.id } } })).status, 200);
      assert.equal((await http(C.negocio.GET, "GET", `/comercial/api/negocios/${NP}`, { cookies: UA.cookies, id: NP })).status, 404, "crearlo no da acceso permanente");
      assert.equal((await http(C.contactos.POST, "POST", `/comercial/api/negocios/${NP}/contactos`, { cookies: UA.cookies, id: NP, body: { datos: { nombre: "X" } } })).status, 404);
      assert.equal(sql(`select creada_por_usuario from public.crm_empresas where id = ${lit(NP)}`), UA.id, "la autoría histórica queda");
    }

    // ── 9) Advertencias que no esconden y contadores = grupos = filas ────
    {
      const N4 = await negocioA("Archivado con lead");
      const L4 = await lead(N4);
      const vEmp = Number(sql(`select version from public.crm_empresas where id = ${lit(N4)}`));
      assert.equal((await http(A.negocio.PATCH, "PATCH", `/api/admin/crm/negocios/${N4}`, { cookies: comoAdmin, id: N4, body: { accion: "archivar", version: vEmp, motivo: "Cerró el local" } })).status, 200);
      const vC = Number(sql(`select version from public.crm_contactos where id = ${lit(L4.contacto)}`));
      assert.equal((await http(A.contacto.PATCH, "PATCH", `/api/admin/crm/contactos/${L4.contacto}`, { cookies: comoAdmin, id: L4.contacto, body: { version: vC, cambios: { archivado: true } } })).status, 200);
      const f4 = await fila(L4.op);
      assert.ok(f4, "un negocio archivado no esconde su oportunidad abierta");
      assert.deepEqual([...f4!.advertencias].sort(), ["contacto_archivado", "negocio_archivado"]);
      const cNuevo = await http(A.oportunidad.GET, "GET", `/api/admin/crm/oportunidades/${L4.op}`, { cookies: comoAdmin, id: L4.op });
      assert.equal(cNuevo.status, 200);
      const otro = sql(`insert into public.crm_contactos (empresa_id, nombre, telefono, telefono_normalizado, es_decisor, creado_por_rol)
        values (${lit(N4)}, 'Socia', '+54 9 351 555 9999', '5493515559999', 'si', 'admin') returning id`);
      assert.equal((await gestion(L4.op, "contacto_principal", { contacto_id: otro })).status, 201);
      assert.deepEqual((await fila(L4.op))!.advertencias, ["negocio_archivado"], "resolver el contacto saca esa advertencia");

      const general = await bandeja();
      const suma = Object.values(general.conteos).reduce((a, b) => a + b, 0);
      assert.equal(suma, general.total, "la suma de los grupos = el total");
      assert.equal(general.filas.length, general.total, "sin grupo elegido, todas las filas");
      assert.equal(new Set(general.filas.map((x) => x.id)).size, general.filas.length, "ninguna fila repetida");
      const abiertasDb = Number(sql(`select count(*) from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id
        where o.cerrada_en is null and e.nombre_comercial like ${lit(`${MARCA}%`)}`));
      assert.equal(general.total, abiertasDb, "el total coincide con la base");
      for (const g of B2.GRUPOS) {
        const solo = await bandeja(`&grupo=${g.id}`);
        assert.equal(solo.filas.length, general.conteos[g.id], `grupo ${g.id}: contador = filas`);
        assert.ok(solo.filas.every((x) => x.grupo === g.id));
        assert.deepEqual(solo.conteos, general.conteos, "elegir un grupo no cambia los contadores");
      }
      const filtrada = await bandeja("&estado=negociacion");
      assert.equal(Object.values(filtrada.conteos).reduce((a, b) => a + b, 0), filtrada.filas.length, "con filtros, contadores = filas");
      assert.ok(filtrada.filas.every((x) => x.estado === "negociacion"));
    }

    // ── 10) Auditoría y errores ───────────────────────────────────────────
    {
      const acciones = sql(`select string_agg(distinct accion, ',' order by accion) from public.crm_auditoria a join public.crm_oportunidades o on o.id = a.entidad_id
        where o.id = ${lit(L1.op)}`);
      for (const ac of ["cambio_estado", "creacion", "pausa", "perdida", "reanudacion", "reapertura"]) assert.ok(acciones.split(",").includes(ac), `auditoría: ${ac}`);
      assert.equal(sql(`select count(*) from public.crm_auditoria where entidad in ('crm_actividades', 'crm_seguimientos', 'crm_oportunidades') and datos::text ~ '\\+54 9 351'`), "0", "sin teléfonos");
      for (const t of respuestas) assert.ok(!/violates|constraint|relation "|PGRST|syntax error|plpgsql|duplicate key/i.test(t), `detalle interno: ${t.slice(0, 160)}`);
      for (const s of secretos) assert.ok(!respuestas.some((t) => t.includes(s)), "ningún secreto en respuestas");
    }

    console.log("OK — crmB2 integración: bandeja y consulta sin efectos, gestiones y próximas acciones, pausa/retomar, pérdida y reapertura, visitas sobre oportunidades gestionadas, reintentos, carrera real con control, permisos y privacidad, contadores = filas.");
  } finally {
    limpiar();
  }
}

main().catch((e) => {
  console.error(e);
  try { limpiar(); } catch { /* ya se informó el error principal */ }
  process.exit(1);
});
