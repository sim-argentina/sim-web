// GUARDIÁN: esta suite escribe en la base (siembra su escenario). Si el destino no es una
// base de pruebas aislada, el proceso aborta acá. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// Cierre del MVP · la bandeja de Seguimiento (B2) sin el límite de 1000 oportunidades.
// Siembra 1100 oportunidades ficticias (marca propia) directamente en la instancia LOCAL:
// la buscada queda DESPUÉS de las primeras 1000 en el orden de la consulta anterior
// (lead_en ascendente, limit 1000). Por la ruta real /api/admin/crm/seguimiento:
//   · la búsqueda la encuentra y está en el grupo correcto;
//   · los contadores cuentan todas (= la base) y suman el total;
//   · recorrer todas las páginas no repite ni omite (conjunto sin cambios);
//   · sin búsqueda, se llega a ella navegando su grupo;
//   · abiertas, perdidas y ganadas coherentes; filtros; solo 50 filas por respuesta;
//   · permisos (sin sesión, staff, comercial).
// Limpia SOLO lo que sembró.
//
// Ejecutar: node scripts/pruebas/crm-local.mjs suite lib/crmB2Paginacion.integration.ts

const MARCA = `zzcrmpag${Date.now().toString(36)}`;
const N = 1100;
const BUSCADA = 1048;
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
  sql(`delete from public.crm_seguimientos where oportunidad_id in (select o.id from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id where e.nombre_comercial like 'zzcrmpag%');
    delete from public.crm_oportunidades where empresa_id in (select id from public.crm_empresas where nombre_comercial like 'zzcrmpag%');
    delete from public.crm_empresas where nombre_comercial like 'zzcrmpag%';
    delete from public.crm_auditoria where entidad_id in (select id from public.crm_usuarios where usuario like 'zzcrmpag%') or actor_usuario_id in (select id from public.crm_usuarios where usuario like 'zzcrmpag%');
    delete from public.crm_usuarios where usuario like 'zzcrmpag%';`);
}

let ipN = 0;
const ip = () => `10.96.${Math.floor(++ipN / 250)}.${ipN % 250}`;
type J = Record<string, unknown>;

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
  const USUARIOS = await import("@/app/api/admin/crm/usuarios/route");
  const INGRESAR = await import("@/app/comercial/api/ingresar/route");
  const SEG = await import("@/app/api/admin/crm/seguimiento/route");
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");
  type Handler = (req: Request) => Promise<Response>;
  async function pedir(qs: string, cookies: Record<string, string> = { [ADMIN_COOKIE]: admin }) {
    const req = new Request(`${ORIGEN}/api/admin/crm/seguimiento?${qs}`, { headers: { "x-real-ip": ip(), origin: ORIGEN } });
    const res = await almacen.run(new Map(Object.entries(cookies)), () => (SEG.GET as Handler)(req));
    const texto = await res.text();
    let json: J = {};
    try { json = JSON.parse(texto); } catch { /* sin JSON */ }
    return { status: res.status, json, bytes: texto.length };
  }
  type Fila = { id: string; grupo: string; empresa: { nombre: string } };
  const filas = (j: J) => j.filas as Fila[];

  try {
    // ── Siembra: 1100 negocios y oportunidades abiertas (las 30 más viejas, perdidas) ──
    const hoy = sql("select public.crm_fecha_sim(now())");
    sql(`insert into public.crm_empresas (nombre_comercial, nombre_normalizado, creada_por_rol)
           select ${lit(MARCA)} || ' ' || lpad(i::text, 4, '0'), public.crm_normalizar_texto(${lit(MARCA)} || ' ' || lpad(i::text, 4, '0')), 'admin'
             from generate_series(1, ${N}) i;
         insert into public.crm_oportunidades (empresa_id, estado, origen_tipo, lead_en, ciclo, ciclo_inicio_en, ciclo_estado_inicial, gestionada_en,
             cerrada_en, cierre_motivo, perdida_en, perdida_motivo, estado_al_perder)
           select e.id, case when x.i <= 30 then 'perdida' else 'contacto' end, 'recompra_admin', x.lead, 1, x.lead, 'contacto',
                  case when x.i % 3 = 0 then null else x.lead end,
                  case when x.i <= 30 then now() end, case when x.i <= 30 then 'perdida' end, case when x.i <= 30 then now() - (x.i || ' minutes')::interval end,
                  case when x.i <= 30 then 'precio' end, case when x.i <= 30 then 'contacto' end
             from (select i, now() - ((${N} - i + 1) || ' minutes')::interval as lead from generate_series(1, ${N}) i) x
             join public.crm_empresas e on e.nombre_comercial = ${lit(MARCA)} || ' ' || lpad(x.i::text, 4, '0');
         insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, operacion_clave)
           select o.id, 1, 'seguimiento', case when split_part(e.nombre_comercial, ' ', 2)::int % 8 = 0 then ${lit(hoy)}::date - 1 else ${lit(hoy)}::date + 3 end, gen_random_uuid()
             from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id
            where e.nombre_comercial like ${lit(`${MARCA} %`)} and o.cerrada_en is null
              and split_part(e.nombre_comercial, ' ', 2)::int % 3 <> 0 and split_part(e.nombre_comercial, ' ', 2)::int % 4 = 0;`);
    const buscada = `${MARCA} ${String(BUSCADA).padStart(4, "0")}`;
    const idBuscada = sql(`select o.id from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id where e.nombre_comercial = ${lit(buscada)}`);
    // La prueba tiene sentido: con la consulta anterior (lead_en, limit 1000) la buscada quedaba afuera.
    const posicion = Number(sql(`select n from (select id, row_number() over (order by lead_en) n from public.crm_oportunidades where cerrada_en is null) x where id = ${lit(idBuscada)}`));
    assert.ok(posicion > 1000, `la buscada está en la posición ${posicion} (> 1000)`);
    const abiertasDb = Number(sql(`select count(*) from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id where e.nombre_comercial like ${lit(`${MARCA}%`)} and o.cerrada_en is null`));
    assert.equal(abiertasDb, N - 30);

    // ── Permisos ─────────────────────────────────────────────────────────
    const usuario = `${MARCA}.tob`;
    const contrasena = `Clave-${randomBytes(9).toString("base64url")}`;
    const conSesion = await almacen.run(new Map([[ADMIN_COOKIE, admin]]), () => (USUARIOS.POST as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}/api/admin/crm/usuarios`,
      { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN, "x-real-ip": ip() }, body: JSON.stringify({ usuario, nombre: "Tob", contrasena }) })));
    assert.equal(conSesion.status, 201);
    const ing = await (INGRESAR.POST as (r: Request) => Promise<Response>)(new Request(`${ORIGEN}/comercial/api/ingresar`, { method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, "x-real-ip": ip() }, body: JSON.stringify({ usuario, contrasena }) }));
    const tok = /^[^=]+=([^;]*)/.exec(ing.headers.getSetCookie().find((x) => x.startsWith(`${CRM_COOKIE}=`))!)![1];
    for (const [cookies, esperado, quien] of [[{}, 401, "sin sesión"], [{ [ADMIN_COOKIE]: staff }, 403, "staff"], [{ [CRM_COOKIE]: tok }, 401, "comercial"]] as const) {
      assert.equal((await pedir(`vista=abiertas&pagina=2&q=${MARCA}`, cookies)).status, esperado, quien);
    }

    // ── Búsqueda y grupo de la buscada ───────────────────────────────────
    const una = await pedir(`vista=abiertas&q=${encodeURIComponent(buscada)}`);
    assert.equal(una.status, 200);
    assert.deepEqual(filas(una.json).map((x) => [x.id, x.grupo]), [[idBuscada, "vencidos"]], "la de la posición > 1000 se encuentra y cae en «vencidos»");

    // ── Contadores sobre todas y recorrido completo de páginas ───────────
    const t1 = await pedir(`vista=abiertas&q=${MARCA}`);
    const conteos = t1.json.conteos as Record<string, number>;
    assert.equal(t1.json.total, abiertasDb, "el total cuenta todas, no las primeras 1000");
    assert.equal(Object.values(conteos).reduce((a, b) => a + b, 0), abiertasDb, "los grupos suman el total");
    const porGrupoDb = (w: string) => Number(sql(`select count(*) from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id
      where e.nombre_comercial like ${lit(`${MARCA}%`)} and o.cerrada_en is null and ${w}`));
    const pend = `exists (select 1 from public.crm_seguimientos s where s.oportunidad_id = o.id and s.estado = 'pendiente'`;
    assert.equal(conteos.vencidos, porGrupoDb(`${pend} and s.vence_el < ${lit(hoy)})`));
    assert.equal(conteos.proximas, porGrupoDb(`${pend} and s.vence_el > ${lit(hoy)})`));
    assert.equal(conteos.nuevos, porGrupoDb(`not ${pend}) and o.gestionada_en is null`));
    assert.equal(conteos.sin_proxima, porGrupoDb(`not ${pend}) and o.gestionada_en is not null`));
    assert.equal(t1.json.total_paginas, Math.ceil(abiertasDb / 50));
    assert.equal(filas(t1.json).length, 50, "al navegador viajan 50 filas, no miles");
    assert.ok(t1.bytes < 120_000, `respuesta acotada (${t1.bytes} bytes)`);
    const vistos: string[] = [];
    let grupoAnterior = -1;
    const ordenGrupos = ["vencidos", "hoy", "nuevos", "sin_proxima", "retomar", "proximas"];
    for (let p = 1; p <= Number(t1.json.total_paginas); p++) {
      const r = await pedir(`vista=abiertas&q=${MARCA}&pagina=${p}`);
      assert.equal(r.json.pagina, p);
      assert.deepEqual(r.json.conteos, conteos, "los contadores no cambian con la página");
      for (const f of filas(r.json)) {
        const g = ordenGrupos.indexOf(f.grupo);
        assert.ok(g >= grupoAnterior, "páginas en el orden de los grupos");
        grupoAnterior = g;
        vistos.push(f.id);
      }
    }
    assert.equal(vistos.length, abiertasDb, "no omite");
    assert.equal(new Set(vistos).size, abiertasDb, "no repite");
    const idsDb = new Set(sql(`select o.id from public.crm_oportunidades o join public.crm_empresas e on e.id = o.empresa_id
      where e.nombre_comercial like ${lit(`${MARCA}%`)} and o.cerrada_en is null`).split("\n"));
    assert.ok(vistos.every((id) => idsDb.has(id)), "son exactamente las de la base");
    assert.equal((await pedir(`vista=abiertas&q=${MARCA}&pagina=999`)).json.pagina, t1.json.total_paginas, "fuera de rango: la última");

    // ── Sin búsqueda: se llega navegando su grupo (con los datos de QA que ya existen) ──
    const g1 = await pedir("vista=abiertas&grupo=vencidos");
    let hallada = false;
    for (let p = 1; p <= Number(g1.json.total_paginas) && !hallada; p++) {
      hallada = filas((await pedir(`vista=abiertas&grupo=vencidos&pagina=${p}`)).json).some((x) => x.id === idBuscada);
    }
    assert.ok(hallada, "sin búsqueda, la buscada está en alguna página de «vencidos»");
    assert.equal(g1.json.coincidencias, (g1.json.conteos as Record<string, number>).vencidos, "con grupo: coincidencias = su contador");

    // ── Filtros y vistas ─────────────────────────────────────────────────
    const venc = await pedir(`vista=abiertas&q=${MARCA}&proxima=vencida`);
    assert.equal(venc.json.total, conteos.vencidos);
    assert.equal((await pedir(`vista=abiertas&q=${MARCA}&origen=admin`)).json.total, abiertasDb, "filtro de origen sobre el conjunto completo");
    assert.equal((await pedir(`vista=abiertas&q=${MARCA}&estado=negociacion`)).json.total, 0);
    const perdidas = await pedir(`vista=perdidas&q=${MARCA}`);
    assert.deepEqual([perdidas.json.total, perdidas.json.total_paginas], [30, 1]);
    assert.equal(new Set(filas(perdidas.json).map((x) => x.id)).size, 30);
    assert.equal((await pedir(`vista=ganadas&q=${MARCA}`)).json.total, 0);
    assert.equal(Number(t1.json.total) + Number(perdidas.json.total), N, "abiertas + perdidas = todas las sembradas");

    console.log(`OK — Seguimiento sin límite de 1000: ${N} oportunidades sembradas (buscada en la posición ${posicion}), búsqueda y grupo, contadores = base, ${t1.json.total_paginas} páginas sin repetir ni omitir, vistas, filtros y permisos.`);
  } finally {
    limpiar();
  }
}

main().catch((e) => {
  console.error(e);
  try { limpiar(); } catch { /* ya se informó el error principal */ }
  process.exit(1);
});
