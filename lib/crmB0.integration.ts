// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Integración del CRM B0 (identidad comercial) contra el Supabase LOCAL con
// db/crm-b0-identidad.sql aplicado. Recorre las rutas reales:
//   · administración de usuarios (solo admin), DTO sin material de autenticación;
//   · ingreso: válido, inválido, inexistente, desactivado, origen, configuración;
//   · sesión: cookies que conviven, tokens manipulados, vencidos, cruzados y viejos;
//   · revocación por desactivar, restablecer, revocar y cerrar sesión; reactivar
//     no revive sesiones;
//   · carrera entre el ingreso y un restablecimiento / desactivación / revocación,
//     forzada en el medio y en paralelo real;
//   · límites de intentos; endpoints existentes con cookie comercial; privilegios
//     reales de service_role y anon; errores de base (falla cerrada, sin detalles);
//   · auditoría con campos explícitos; ningún hash, contraseña ni token en
//     respuestas, auditoría ni logs.
// La sesión se firma con secretos DESCARTABLES y next/headers se reemplaza por un
// almacén en memoria (mismo patrón que lib/interacciones.integration.ts). Lo que
// service_role no puede hacer —revocar y restaurar privilegios, leer el hash,
// limpiar— se hace con psql DENTRO del contenedor local, nunca en otra base.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/crmB0.integration.ts

const MARCA = `zzcrmb0${Date.now().toString(36)}`;
const CONTENEDOR = "supabase_db_sim-web-pruebas";
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
  sql(`delete from public.crm_auditoria where entidad_id in (select id from public.crm_usuarios where usuario like 'zzcrmb0%');
       delete from public.crm_usuarios where usuario like 'zzcrmb0%';`);
}
function reaplicarEsquema() {
  execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: readFileSync("db/crm-b0-identidad.sql", "utf8"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

// ── Todo lo que sale por consola, para buscar secretos al final ────────────
const logs: string[] = [];
for (const m of ["log", "info", "warn", "error"] as const) {
  const original = console[m].bind(console);
  console[m] = (...a: unknown[]) => {
    logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    original(...a);
  };
}
const respuestas: string[] = [];
const secretos = new Set<string>();

let ipN = 0;
const ip = () => `10.77.${Math.floor(++ipN / 250)}.${ipN % 250}`;

async function main() {
  limpiar();

  // ── Sesiones, cookies y rutas ────────────────────────────────────────────
  const SECRETO_PANEL = randomBytes(32).toString("hex");
  const SECRETO_CRM = randomBytes(32).toString("hex");
  process.env.ADMIN_SESSION_SECRET = SECRETO_PANEL;
  process.env.CRM_SESSION_SECRET = SECRETO_CRM;
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
  const jar = new Map<string, string>();
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) }) },
  } as unknown as NodeJS.Module;

  const { createSessionToken, ADMIN_COOKIE } = await import("@/lib/adminSession");
  const { crearTokenComercial, CRM_COOKIE } = await import("@/lib/crmSesion");
  const { autenticarComercial } = await import("@/lib/crmIngreso");
  const { credencialParaIngreso, confirmarIngreso } = await import("@/lib/crmUsuariosServer");
  const USUARIOS = await import("@/app/api/admin/crm/usuarios/route");
  const USUARIO = await import("@/app/api/admin/crm/usuarios/[id]/route");
  const INGRESAR = await import("@/app/comercial/api/ingresar/route");
  const SALIR = await import("@/app/comercial/api/salir/route");
  const SESION = await import("@/app/comercial/api/sesion/route");
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");

  type Resp = { status: number; json: Record<string, unknown>; texto: string; setCookies: string[]; cache: string | null };
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  async function http(h: unknown, metodo: string, url: string, o: {
    cookies?: Record<string, string>; body?: unknown; origin?: string | null; ip?: string; id?: string;
  } = {}): Promise<Resp> {
    jar.clear();
    for (const [k, v] of Object.entries(o.cookies ?? {})) jar.set(k, v);
    const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": o.ip ?? ip() };
    if (o.origin !== null) headers.origin = o.origin ?? ORIGEN;
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    const res = await (h as Handler)(req, { params: Promise.resolve({ id: o.id ?? "" }) });
    const texto = await res.text();
    respuestas.push(texto);
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(texto); } catch { /* sin cuerpo JSON */ }
    return { status: res.status, json, texto, setCookies: res.headers.getSetCookie(), cache: res.headers.get("cache-control") };
  }
  const comoAdmin = { [ADMIN_COOKIE]: admin };
  const comoStaff = { [ADMIN_COOKIE]: staff };
  const comercial = (t: string) => ({ [CRM_COOKIE]: t });
  const tokenDe = (r: Resp) => {
    const c = r.setCookies.find((x) => x.startsWith(`${CRM_COOKIE}=`));
    const v = c ? /^[^=]+=([^;]*)/.exec(c)![1] : "";
    if (v) secretos.add(v);
    return v;
  };
  const crear = async (sufijo: string, nombre: string) => {
    const usuario = `${MARCA}.${sufijo}`;
    const contrasena = `Clave-${randomBytes(9).toString("base64url")}`;
    secretos.add(contrasena);
    const r = await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoAdmin, body: { usuario, nombre, contrasena } });
    assert.equal(r.status, 201, `alta ${sufijo}: ${r.texto}`);
    return { id: String((r.json.usuario as Record<string, unknown>).id), usuario, contrasena, nombre };
  };
  const ingresar = (usuario: string, contrasena: string, o: { ip?: string; origin?: string | null } = {}) =>
    http(INGRESAR.POST, "POST", "/comercial/api/ingresar", { body: { usuario, contrasena }, ...o });
  const sesion = (cookies: Record<string, string>) => http(SESION.GET, "GET", "/comercial/api/sesion", { cookies });
  const accion = (id: string, accion: string, extra: Record<string, unknown> = {}, cookies: Record<string, string> = comoAdmin) =>
    http(USUARIO.PATCH, "PATCH", `/api/admin/crm/usuarios/${id}`, { cookies, id, body: { accion, ...extra } });
  const versionDe = async (id: string) => {
    const { data } = await supabaseAdmin.from("crm_usuarios").select("sesion_version").eq("id", id).single();
    return Number(data!.sesion_version);
  };

  try {
    // ── 1) Privilegios reales ──────────────────────────────────────────────
    {
      const todo = await supabaseAdmin.from("crm_usuarios").select("*").limit(1);
      assert.equal(todo.error?.code, "42501", "service_role no puede select * (incluiría el hash)");
      const hash = await supabaseAdmin.from("crm_usuarios").select("password_hash").limit(1);
      assert.equal(hash.error?.code, "42501", "service_role no lee password_hash");
      const ok = await supabaseAdmin.from("crm_usuarios").select("id, usuario, nombre, activo, sesion_version").limit(1);
      assert.equal(ok.error, null, "service_role lee las columnas no sensibles");
      const ins = await supabaseAdmin.from("crm_usuarios").insert({ usuario: `${MARCA}.directo`, nombre: "X", password_hash: "x" });
      assert.equal(ins.error?.code, "42501", "service_role no inserta directo");
      const aud = await supabaseAdmin.from("crm_auditoria").delete().eq("entidad", "crm_usuarios");
      assert.equal(aud.error?.code, "42501", "service_role no borra auditoría");
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      assert.ok(anonKey, "hay clave anon local");
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey!, { auth: { persistSession: false } });
      const sel = await anon.from("crm_usuarios").select("id").limit(1);
      assert.ok(sel.error && !sel.data, "anon no lee crm_usuarios");
      const rpc = await anon.rpc("crm_login_credencial", { p_usuario: "x" });
      assert.ok(rpc.error && !rpc.data, "anon no ejecuta las RPCs");
      const rpc2 = await anon.rpc("crm_usuario_crear", { p_usuario: `${MARCA}.anon`, p_nombre: "X", p_password_hash: "x", p_actor_rol: "admin" });
      assert.ok(rpc2.error, "anon no crea usuarios aunque diga ser admin");
    }

    // ── 2) Administración: solo admin; validaciones; DTO ──────────────────
    {
      assert.equal((await http(USUARIOS.GET, "GET", "/api/admin/crm/usuarios")).status, 401, "sin sesión");
      assert.equal((await http(USUARIOS.GET, "GET", "/api/admin/crm/usuarios", { cookies: comoStaff })).status, 403, "staff");
      const body = { usuario: `${MARCA}.x`, nombre: "X", contrasena: "Una-clave-larga-1" };
      assert.equal((await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoStaff, body })).status, 403, "staff no crea");
      assert.equal((await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoAdmin, body, origin: "https://otro.example" })).status, 403, "origen ajeno");
      for (const [b, motivo] of [
        [{ ...body, usuario: "ab" }, "usuario corto"],
        [{ ...body, usuario: "Con Espacio" }, "usuario con espacio"],
        [{ ...body, nombre: "  " }, "sin nombre"],
        [{ ...body, contrasena: "corta-1" }, "contraseña corta"],
        [{ ...body, contrasena: `x-${MARCA}.x-y` }, "contraseña con el usuario"],
        [{ usuario: body.usuario, nombre: "X" }, "sin contraseña"],
      ] as const) {
        assert.equal((await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", { cookies: comoAdmin, body: b })).status, 400, motivo);
      }
    }
    const A = await crear("a", "Prueba A");
    {
      const lista = await http(USUARIOS.GET, "GET", "/api/admin/crm/usuarios", { cookies: comoAdmin });
      assert.equal(lista.status, 200);
      assert.match(lista.cache ?? "", /no-store/, "listado sin caché compartida");
      const fila = (lista.json.usuarios as Array<Record<string, unknown>>).find((u) => u.id === A.id)!;
      assert.deepEqual(Object.keys(fila).sort(),
        ["activo", "contrasena_cambiada_en", "creado_en", "desactivado_en", "id", "nombre", "ultimo_ingreso_en", "usuario"],
        "DTO con campos explícitos");
      assert.equal(fila.usuario, A.usuario);
      assert.equal(fila.activo, true);
      const dup = await http(USUARIOS.POST, "POST", "/api/admin/crm/usuarios", {
        cookies: comoAdmin, body: { usuario: A.usuario.toUpperCase(), nombre: "Otro", contrasena: "Otra-clave-larga-2" },
      });
      assert.equal(dup.status, 409, "usuario duplicado (mayúsculas normalizadas)");
      assert.equal(dup.json.codigo, "usuario_existente");
      assert.equal((await accion("no-es-uuid", "desactivar")).status, 404);
      assert.equal((await accion("00000000-0000-4000-8000-000000000000", "desactivar")).status, 404, "inexistente");
      assert.equal((await accion(A.id, "borrar")).status, 400, "acción inválida");
      assert.equal((await accion(A.id, "desactivar", {}, comoStaff)).status, 403, "staff no desactiva");
      assert.equal((await accion(A.id, "restablecer", { contrasena: "corta" })).status, 400, "política al restablecer");
      assert.equal((await accion(A.id, "reactivar")).status, 409, "reactivar un activo");
    }

    // ── 3) Ingreso ─────────────────────────────────────────────────────────
    let tA: string;
    {
      const mal = await ingresar(A.usuario, A.contrasena + "x");
      const nadie = await ingresar(`${MARCA}.nadie`, A.contrasena);
      const vacio = await ingresar("", "");
      for (const r of [mal, nadie, vacio]) {
        assert.equal(r.status, 401);
        assert.deepEqual(r.json, { error: "Usuario o contraseña incorrectos." }, "misma respuesta sin revelar si existe");
        assert.equal(r.setCookies.length, 0, "sin cookie");
      }
      assert.equal((await ingresar(A.usuario, A.contrasena, { origin: "https://otro.example" })).status, 403, "origen ajeno");
      const ok = await ingresar(`  ${A.usuario.toUpperCase()} `, A.contrasena);
      assert.equal(ok.status, 200, ok.texto);
      assert.deepEqual(ok.json, { ok: true, nombre: "Prueba A" }, "el cuerpo no trae el token");
      assert.match(ok.cache ?? "", /no-store/);
      const cookie = ok.setCookies.find((c) => c.startsWith(`${CRM_COOKIE}=`)) ?? "";
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=strict/i);
      assert.match(cookie, /Path=\/comercial(;|$)/);
      assert.match(cookie, /Max-Age=604800/);
      assert.ok(!ok.setCookies.some((c) => c.startsWith(`${ADMIN_COOKIE}=`)), "no toca la cookie del panel");
      tA = tokenDe(ok);
      assert.ok(tA.startsWith("crm1."));
      const yo = await sesion(comercial(tA));
      assert.deepEqual(yo.json, { actor: { tipo: "comercial", nombre: "Prueba A" } });

      process.env.CRM_SESSION_SECRET = "";
      assert.equal((await ingresar(A.usuario, A.contrasena)).status, 503, "sin clave comercial: cerrado");
      assert.equal((await sesion(comercial(tA))).status, 503, "sin clave, la sesión no se acepta");
      process.env.CRM_SESSION_SECRET = SECRETO_PANEL;
      assert.equal((await ingresar(A.usuario, A.contrasena)).status, 503, "misma clave que el panel: cerrado");
      process.env.CRM_SESSION_SECRET = SECRETO_CRM;
      assert.equal((await sesion(comercial(tA))).status, 200, "control: vuelve a valer");
    }

    // ── 4) Sesión: cookies que conviven y tokens inválidos ─────────────────
    {
      const sv = await versionDe(A.id);
      const casos: Array<[string, Record<string, string>, number, string?]> = [
        ["nada", {}, 401],
        ["staff", comoStaff, 403],
        ["admin", comoAdmin, 200, "admin"],
        ["comercial", comercial(tA), 200, "comercial"],
        ["admin + comercial", { ...comoAdmin, ...comercial(tA) }, 200, "comercial"],
        ["admin + comercial manipulada", { ...comoAdmin, ...comercial(tA.slice(0, -2) + "xx") }, 200, "admin"],
        ["staff + comercial", { ...comoStaff, ...comercial(tA) }, 200, "comercial"],
        ["staff + comercial manipulada", { ...comoStaff, ...comercial(tA + "x") }, 403],
        ["comercial vencida", comercial(crearTokenComercial(A.id, sv, Date.now() - 8 * 24 * 3600_000)), 401],
        ["comercial de otra versión", comercial(crearTokenComercial(A.id, sv + 1)), 401],
        ["comercial de un id inexistente", comercial(crearTokenComercial("00000000-0000-4000-8000-000000000000", 1)), 401],
        ["token del panel en la cookie comercial", comercial(admin), 401],
        ["token comercial en la cookie del panel", { [ADMIN_COOKIE]: tA }, 401],
      ];
      for (const [nombre, cookies, status, tipo] of casos) {
        const r = await sesion(cookies);
        assert.equal(r.status, status, `${nombre}: ${r.texto}`);
        if (tipo) assert.equal((r.json.actor as Record<string, unknown>).tipo, tipo, nombre);
        if (status === 200 && tipo === "admin") assert.equal((r.json.actor as Record<string, unknown>).nombre, "Administración");
        assert.match(r.cache ?? "", /no-store/, `${nombre}: sin caché`);
      }
    }

    // ── 5) Revocación ──────────────────────────────────────────────────────
    {
      // Desactivar → la sesión muere y no ingresa; reactivar no la revive.
      assert.equal((await accion(A.id, "desactivar")).status, 200);
      assert.equal((await sesion(comercial(tA))).status, 401, "desactivado: sesión revocada");
      assert.equal((await ingresar(A.usuario, A.contrasena)).status, 401, "desactivado: no ingresa");
      assert.equal((await accion(A.id, "desactivar")).status, 409, "ya desactivado");
      const re = await accion(A.id, "reactivar");
      assert.equal(re.status, 200);
      assert.equal((re.json.usuario as Record<string, unknown>).activo, true);
      assert.equal((await sesion(comercial(tA))).status, 401, "reactivar NO revive la sesión anterior");
      const t2 = tokenDe(await ingresar(A.usuario, A.contrasena));
      assert.equal((await sesion(comercial(t2))).status, 200, "reactivado: ingresa de nuevo");

      // Restablecer → sesiones revocadas; la contraseña vieja no sirve.
      const nueva = `Nueva-${randomBytes(9).toString("base64url")}`;
      secretos.add(nueva);
      const rs = await accion(A.id, "restablecer", { contrasena: nueva });
      assert.equal(rs.status, 200);
      assert.equal((await sesion(comercial(t2))).status, 401, "restablecer revoca");
      assert.equal((await ingresar(A.usuario, A.contrasena)).status, 401, "contraseña anterior");
      const t3 = tokenDe(await ingresar(A.usuario, nueva));
      assert.equal((await sesion(comercial(t3))).status, 200, "contraseña nueva");
      A.contrasena = nueva;

      // Revocar (acción administrativa) → la sesión muere; la contraseña sigue.
      assert.equal((await accion(A.id, "revocar")).status, 200);
      assert.equal((await sesion(comercial(t3))).status, 401, "revocación administrativa");
      const t4 = tokenDe(await ingresar(A.usuario, nueva));

      // Cerrar sesión → revoca en el servidor y borra la cookie con su Path.
      const fuera = await http(SALIR.POST, "POST", "/comercial/api/salir", { cookies: comercial(t4) });
      assert.equal(fuera.status, 200);
      assert.ok(fuera.setCookies.some((c) => /^sim-crm-session=;/.test(c) && /Max-Age=0/.test(c) && /Path=\/comercial/.test(c)), "borra la cookie");
      assert.equal((await sesion(comercial(t4))).status, 401, "después de salir, el token ya no vale");
      assert.equal((await http(SALIR.POST, "POST", "/comercial/api/salir", { cookies: comercial(t4) })).status, 200, "salir dos veces es inocuo");
      assert.equal((await http(SALIR.POST, "POST", "/comercial/api/salir", { cookies: comercial(t4), origin: "https://otro.example" })).status, 403, "salir: origen ajeno");
      assert.equal((await http(SALIR.POST, "POST", "/comercial/api/salir", { cookies: comoAdmin })).status, 200, "salir sin sesión comercial no toca el panel");
    }

    // ── 6) Carrera entre el ingreso y un cambio del usuario ────────────────
    {
      const B = await crear("b", "Prueba B");
      const deps = (entre: () => Promise<unknown>) => ({
        credencial: credencialParaIngreso, confirmar: confirmarIngreso, entreVerificacionYConfirmacion: async () => { await entre(); },
      });
      const nuevaB = `NuevaB-${randomBytes(9).toString("base64url")}`;
      secretos.add(nuevaB);
      const r1 = await autenticarComercial(B.usuario, B.contrasena, deps(() => accion(B.id, "restablecer", { contrasena: nuevaB })));
      assert.deepEqual(r1, { ok: false, motivo: "credenciales" }, "restablecida en el medio: sin sesión");
      const r2 = await autenticarComercial(B.usuario, nuevaB, deps(() => accion(B.id, "revocar")));
      assert.deepEqual(r2, { ok: false, motivo: "credenciales" }, "revocada en el medio: sin sesión");
      const r3 = await autenticarComercial(B.usuario, nuevaB, deps(() => accion(B.id, "desactivar")));
      assert.deepEqual(r3, { ok: false, motivo: "credenciales" }, "desactivada en el medio: sin sesión");
      await accion(B.id, "reactivar");
      const r4 = await autenticarComercial(B.usuario, nuevaB, deps(async () => {}));
      assert.equal(r4.ok, true, "control: sin cambios en el medio, ingresa");
      if (r4.ok) secretos.add(r4.token);

      // En paralelo real: seis ingresos con la contraseña vieja y un restablecimiento.
      const C = await crear("c", "Prueba C");
      const nuevaC = `NuevaC-${randomBytes(9).toString("base64url")}`;
      secretos.add(nuevaC);
      const todas = await Promise.all([
        ...Array.from({ length: 6 }, () => ingresar(C.usuario, C.contrasena)),
        accion(C.id, "restablecer", { contrasena: nuevaC }),
      ]);
      assert.equal(todas[6].status, 200, "el restablecimiento se aplicó");
      const emitidos = todas.slice(0, 6).filter((r) => r.status === 200).map(tokenDe);
      for (const t of emitidos) {
        assert.equal((await sesion(comercial(t))).status, 401, "ninguna sesión de la contraseña vieja sobrevive al restablecimiento");
      }
      assert.ok(todas.slice(0, 6).every((r) => r.status === 200 || r.status === 401), "solo 200 o 401");
      const tc = tokenDe(await ingresar(C.usuario, nuevaC));
      assert.equal((await sesion(comercial(tc))).status, 200, "la contraseña nueva funciona");
      console.log(`   (carrera en paralelo: ${emitidos.length} de 6 ingresos alcanzaron a emitir sesión antes del restablecimiento; todas quedaron revocadas)`);
    }

    // ── 7) Límites de intentos (memoria del proceso; ver docs/crm/b0-identidad.md) ──
    {
      const mismaIp = "10.99.0.1";
      const r: number[] = [];
      for (let i = 0; i < 9; i++) r.push((await ingresar(`${MARCA}.nadie${i}`, "Intento-incorrecto", { ip: mismaIp })).status);
      assert.deepEqual(r, [401, 401, 401, 401, 401, 401, 401, 401, 429], "8 por minuto por IP");
      const D = await crear("d", "Prueba D");
      const u: number[] = [];
      for (let i = 0; i < 11; i++) u.push((await ingresar(D.usuario, "Intento-incorrecto")).status);
      assert.deepEqual(u, [...Array(10).fill(401), 429], "10 cada 15 minutos por usuario, aunque cambie la IP");
    }

    // ── 8) Endpoints existentes: la cookie comercial sola no abre nada ─────
    {
      const E = await crear("e", "Prueba E");
      const tE = tokenDe(await ingresar(E.usuario, E.contrasena));
      assert.ok(tE, "sesión comercial válida para probar");
      const protegidos: Array<[string, string, string]> = [
        ["@/app/api/admin/empleados/route", "GET", "/api/admin/empleados"],
        ["@/app/api/admin/gift-cards/route", "GET", "/api/admin/gift-cards"],
        ["@/app/api/clientes/route", "GET", "/api/clientes?q=ab"],
        ["@/app/api/admin/mensualidades/route", "GET", "/api/admin/mensualidades"],
        ["@/app/api/turnos-stand/route", "GET", "/api/turnos-stand"],
        ["@/app/api/turnos-stand/route", "POST", "/api/turnos-stand"],
        ["@/app/api/admin/empresas/campanias/route", "GET", "/api/admin/empresas/campanias"],
        ["@/app/api/admin/finanzas/resumen/route", "GET", "/api/admin/finanzas/resumen"],
        ["@/app/api/admin/crm/usuarios/route", "GET", "/api/admin/crm/usuarios"],
      ];
      for (const [mod, metodo, url] of protegidos) {
        const h = (await import(mod))[metodo];
        for (const cookies of [comercial(tE), { [ADMIN_COOKIE]: tE }]) {
          const r = await http(h, metodo, url, { cookies, body: metodo === "POST" ? {} : undefined });
          assert.equal(r.status, 401, `${metodo} ${url} con cookie comercial (${Object.keys(cookies)[0]}): ${r.status}`);
        }
      }
      const me = await http((await import("@/app/api/admin/me/route")).GET, "GET", "/api/admin/me", { cookies: comercial(tE) });
      assert.deepEqual(me.json, { role: null }, "/api/admin/me (público) no ve un rol del panel");
    }

    // ── 9) Errores de base: falla cerrada y sin detalles ──────────────────
    try {
      const F = await crear("f", "Prueba F");
      const tF = tokenDe(await ingresar(F.usuario, F.contrasena));
      sql("revoke select on public.crm_usuarios from service_role;");
      const s = await sesion(comercial(tF));
      assert.equal(s.status, 503, "no se puede verificar al usuario → 503, no acceso");
      const sa = await sesion({ ...comoAdmin, ...comercial(tF) });
      assert.equal(sa.status, 503, "con admin también: no se cae a Administración sin saber quién es");
      const l = await http(USUARIOS.GET, "GET", "/api/admin/crm/usuarios", { cookies: comoAdmin });
      assert.equal(l.status, 500);
      assert.deepEqual(Object.keys(l.json).sort(), ["error", "requestId"], "500 genérico");
      assert.ok(!/permission|42501|crm_usuarios/i.test(l.texto), "sin el error de Postgres en la respuesta");
      sql("revoke execute on function public.crm_login_credencial(text) from service_role;");
      const i = await ingresar(F.usuario, F.contrasena);
      assert.equal(i.status, 503, "credencial no disponible → 503");
      assert.equal(i.setCookies.length, 0, "sin sesión");
      assert.ok(!/permission|42501/i.test(i.texto));
    } finally {
      reaplicarEsquema();
    }
    assert.equal((await http(USUARIOS.GET, "GET", "/api/admin/crm/usuarios", { cookies: comoAdmin })).status, 200, "reaplicar el SQL restaura los privilegios");

    // ── 10) Auditoría ──────────────────────────────────────────────────────
    {
      const { data: filas, error } = await supabaseAdmin.from("crm_auditoria")
        .select("accion, actor_rol, actor_usuario_id, datos").eq("entidad_id", A.id).order("en");
      assert.equal(error, null);
      const acciones = (filas ?? []).map((f) => f.accion);
      for (const a of ["alta", "desactivacion", "reactivacion", "restablecimiento_contrasena", "revocacion_sesiones", "ingreso", "cierre_sesion"]) {
        assert.ok(acciones.includes(a), `auditoría: ${a}`);
      }
      for (const f of filas ?? []) {
        if (f.accion === "ingreso" || f.accion === "cierre_sesion") {
          assert.deepEqual([f.actor_rol, f.actor_usuario_id], ["comercial", A.id], `${f.accion}: actor = el usuario`);
        } else {
          assert.deepEqual([f.actor_rol, f.actor_usuario_id], ["admin", null], `${f.accion}: actor = Administración`);
        }
        const permitidas = new Set(["antes", "despues", "sesiones_revocadas", "usuario", "nombre", "activo"]);
        const claves = (o: unknown): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => [k, ...claves(v)]) : []);
        assert.deepEqual(claves(f.datos).filter((k) => !permitidas.has(k)), [], `${f.accion}: solo campos auditables`);
      }
      const conHash = sql(`select count(*) from public.crm_auditoria a join public.crm_usuarios u on u.id = a.entidad_id
                           where u.usuario like 'zzcrmb0%' and (a.datos::text like '%scrypt$%' or position(u.password_hash in a.datos::text) > 0)`);
      assert.equal(conHash, "0", "la auditoría no contiene hashes");
      const planos = sql(`select count(*) from public.crm_usuarios where usuario like 'zzcrmb0%' and password_hash !~ '^scrypt\\$17\\$8\\$1\\$'`);
      assert.equal(planos, "0", "todas las contraseñas guardadas son hashes scrypt");
      const hashes = sql(`select password_hash from public.crm_usuarios where usuario like 'zzcrmb0%'`).split("\n").filter(Boolean);
      hashes.forEach((h) => secretos.add(h));
      for (const pw of [...secretos].filter((s) => s.startsWith("Clave-") || s.startsWith("Nueva"))) {
        assert.equal(sql(`select count(*) from public.crm_usuarios where password_hash like ${lit("%" + pw + "%")}`), "0", "el hash no contiene la contraseña");
        assert.equal(sql(`select count(*) from public.crm_auditoria where datos::text like ${lit("%" + pw + "%")}`), "0", "la auditoría no contiene contraseñas");
      }
    }

    // ── 11) Ningún secreto en respuestas ni logs ───────────────────────────
    {
      const fugas = (textos: string[]) => [...secretos].filter((s) => s.length >= 10 && textos.some((t) => t.includes(s)));
      assert.deepEqual(fugas(respuestas), [], "respuestas sin contraseñas, hashes ni tokens");
      assert.ok(respuestas.every((t) => !t.includes("scrypt$") && !t.includes("password_hash")), "respuestas sin hash");
      assert.deepEqual(fugas(logs), [], "logs sin contraseñas, hashes ni tokens");
      assert.ok(logs.every((t) => !t.includes("scrypt$")), "logs sin hash");
    }

    console.log(`OK — crmB0 (integración local): ${secretos.size} secretos rastreados, ${respuestas.length} respuestas y ${logs.length} líneas de log sin fugas.`);
  } finally {
    limpiar();
  }
}

main().catch((e) => {
  console.error(e);
  try { limpiar(); } catch { /* el stack local puede no responder */ }
  process.exit(1);
});
