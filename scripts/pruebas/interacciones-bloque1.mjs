// Interacciones · Bloque 1 — verificación en el stack LOCAL.
//
//   node scripts/pruebas/interacciones-bloque1.mjs
//
// 1. Corre db/interacciones-bloque1.verificacion.sql (sin huella: se revierte).
// 2. Prueba la concurrencia REAL que una sola transacción no puede probar: dos
//    conexiones psql a la vez (una retiene su transacción 2 s y la otra choca) y
//    ráfagas simultáneas por la API REST local, como las mandará el Bloque 2.
// 3. Prueba los permisos por REST (service_role solo lee; anon nada) y el borrado
//    de un turno vinculado por el mismo camino que usa el Turnero.
//
// Nunca toca Producción: usa el guardián del runner (entornoDePruebas: loopback y
// ningún ref prohibido) y psql DENTRO del contenedor local. Los fixtures son
// turnos con id negativo (-920001 … -920040) e interacciones con observaciones
// "TEST_INTERACCIONES_B1"; se borran al final aunque algo falle.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { entornoDePruebas, abortar } from "./entorno.mjs";

const entorno = entornoDePruebas();
if (!entorno.ok) abortar(entorno);

const API = entorno.url.replace(/\/$/, "");
const SERVICE = entorno.env.SIM_TEST_SUPABASE_SERVICE_ROLE_KEY;
const ANON = entorno.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CONTENEDOR = "supabase_db_sim-web-pruebas";
const MARCA = "TEST_INTERACCIONES_B1";
const T_MIN = -920040;
const T_MAX = -920001;
const RETENCION_S = 2;

// ── psql dentro del contenedor local ───────────────────────────────────────
function psql(sql) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const p = spawn("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres",
      "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      const m = /ERROR:\s+(.+)/.exec(err);
      resolve({ code, out: out.trim(), error: m ? m[1].trim() : null, ms: Date.now() - inicio, stderr: err });
    });
    p.stdin.end(sql);
  });
}

async function q(sql) {
  const r = await psql(sql);
  if (r.code !== 0) throw new Error(`SQL falló: ${r.error ?? r.stderr}\n${sql.slice(0, 300)}`);
  return r.out;
}

const espera = (ms) => new Promise((res) => setTimeout(res, ms));
const jsonb = (o) => `$j$${JSON.stringify(o)}$j$::jsonb`;
const arr = (a) => (a && a.length ? `'{${a.join(",")}}'::bigint[]` : "null::bigint[]");
const datos = (resultado, extra = {}) => ({ resultado, personas_grupo: 2, observaciones: MARCA, ...extra });

// Una sesión retiene su transacción RETENCION_S segundos; la otra arranca 0,5 s
// después y tiene que esperar o chocar.
async function carrera(sqlA, sqlB) {
  const a = psql(`begin;\n${sqlA};\nselect pg_sleep(${RETENCION_S});\ncommit;`);
  await espera(500);
  const b = psql(sqlB);
  return { a: await a, b: await b };
}

async function registrar(d, turnos = null, rol = "staff") {
  const out = await q(`select public.interaccion_registrar('${randomUUID()}'::uuid, ${jsonb(d)}, ${arr(turnos)}, '${rol}') -> 'interaccion' ->> 'id';`);
  return out.split("\n").pop();
}

// ── REST local (PostgREST), como lo usará la API ───────────────────────────
async function rest(metodo, ruta, cuerpo, clave = SERVICE) {
  const res = await fetch(`${API}/rest/v1/${ruta}`, {
    method: metodo,
    headers: {
      apikey: clave, Authorization: `Bearer ${clave}`, "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
}

// ── Resultados ─────────────────────────────────────────────────────────────
const resultados = [];
function comprobar(nombre, ok, detalle = "") {
  resultados.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "  ok  " : "  FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// Huella de lo que este módulo NO debe tocar: una fila "tabla|md5" por tabla.
async function huella() {
  const tablas = (await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and (c.relname in ('reservas', 'reserva_operacion', 'reserva_slots', 'empleados', 'turnos_historicos', 'gift_cards')
            or c.relname like 'fin\\_%' or c.relname like 'mensualidad%' or c.relname like 'colectivo\\_%')
     order by 1;`)).split("\n").filter(Boolean);
  const md5De = (desde) => `coalesce(md5(string_agg(md5(x::text), '' order by md5(x::text))), 'vacia') from ${desde}`;
  const partes = [`select 'turnos_stand', ${md5De("public.turnos_stand x")} where x.id not between ${T_MIN} and ${T_MAX}`];
  for (const t of tablas) partes.push(`select '${t}', ${md5De(`public."${t}" x`)}`);
  return q(`${partes.join("\nunion all\n")};`);
}

let inicioOriginal = null;
let inicioTocado = false;

async function limpiar() {
  await q(`
    delete from public.interaccion_turnos
     where turno_stand_id between ${T_MIN} and ${T_MAX}
        or interaccion_id in (select id from public.interacciones_stand where observaciones = '${MARCA}');
    delete from public.interacciones_stand_eventos
     where interaccion_id in (select id from public.interacciones_stand where observaciones = '${MARCA}');
    delete from public.interacciones_stand where observaciones = '${MARCA}';
    delete from public.turnos_stand where id between ${T_MIN} and ${T_MAX};`);
  if (inicioTocado) {
    await q(`update public.interacciones_config set inicio_registro = ${inicioOriginal ? `'${inicioOriginal}'::timestamptz` : "null"} where id;`);
  }
}

async function main() {
  // Comprobación previa: es el contenedor local y tiene el bloque aplicado.
  const ping = await psql("select current_database() || '@' || inet_server_port();");
  if (ping.code !== 0) {
    console.error(`\nEl contenedor ${CONTENEDOR} no responde. Corré: npm run pruebas:iniciar\n`);
    process.exit(78);
  }
  const aplicado = await q("select count(*) from pg_proc where proname = 'interaccion_registrar' and pronamespace = 'public'::regnamespace;");
  if (aplicado !== "1") {
    console.error("\nEl Bloque 1 no está aplicado en la base local. Corré: npm run pruebas:esquema\n");
    process.exit(78);
  }

  // 1 · Verificación SQL (se revierte entera).
  console.log("\n· Verificación SQL (db/interacciones-bloque1.verificacion.sql)");
  const ver = await psql(readFileSync("db/interacciones-bloque1.verificacion.sql", "utf8"));
  const linea = /RESULTADO (.+)/.exec(ver.stderr)?.[1] ?? "(sin resultado)";
  comprobar("verificación SQL sin FALLA ni ABORTO", linea.startsWith("INTERACCIONES-B1|") && !/FALLA|ABORTO/.test(linea), linea);

  // Fixtures (commiteados: la concurrencia necesita dos conexiones).
  inicioOriginal = (await q("select coalesce(inicio_registro::text, '') from public.interacciones_config where id;")) || null;
  if (!inicioOriginal) {
    await q("update public.interacciones_config set inicio_registro = now() - interval '30 days' where id;");
    inicioTocado = true;
  }
  await q(`insert into public.turnos_stand
      (id, nombre, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad)
    select g, '${MARCA}', public.interacciones_fecha_sim(now()), '15:00', 2, 20, 4, 34000, 'qr', 'activo', 'v2_10'
      from generate_series(${T_MIN}, ${T_MAX}) g;`);
  const huella0 = await huella();
  await q("notify pgrst, 'reload schema';");

  // 2 · Concurrencia real con dos conexiones.
  console.log("\n· Concurrencia (dos conexiones a la vez)");
  const comoServicio = "set role service_role;\n";

  {
    const k2 = randomUUID();
    const r = await carrera(
      `${comoServicio}select public.interaccion_registrar('${randomUUID()}'::uuid, ${jsonb(datos("subio"))}, ${arr([-920001])}, 'staff') is not null`,
      `${comoServicio}select public.interaccion_registrar('${k2}'::uuid, ${jsonb(datos("subio"))}, ${arr([-920001])}, 'staff');`);
    const n = await q(`select count(*) from public.interaccion_turnos where turno_stand_id = -920001;`);
    const nada = await q(`select count(*) from public.interacciones_stand where idempotency_key = '${k2}';`);
    comprobar("mismo turno desde dos altas simultáneas: una gana, la otra no guarda nada",
      r.a.code === 0 && r.b.error === "turno_ya_vinculado:-920001" && r.b.ms >= 1200 && n === "1" && nada === "0",
      `B esperó ${r.b.ms} ms y recibió "${r.b.error}"`);
  }

  {
    const id = await registrar(datos("subio"), [-920002, -920003, -920004]);
    const r = await carrera(
      `insert into public.interaccion_turnos (interaccion_id, turno_stand_id, vinculado_por_rol) values ('${id}', -920005, 'admin')`,
      `insert into public.interaccion_turnos (interaccion_id, turno_stand_id, vinculado_por_rol) values ('${id}', -920006, 'admin');`);
    const n = await q(`select count(*) from public.interaccion_turnos where interaccion_id = '${id}';`);
    comprobar("máximo de 4 con inserciones directas simultáneas (sin pasar por la RPC)",
      r.a.code === 0 && r.b.error === "maximo_turnos_por_interaccion" && r.b.ms >= 1200 && n === "4",
      `B esperó ${r.b.ms} ms y recibió "${r.b.error}"; vínculos = ${n}`);
  }

  {
    const id = await registrar(datos("subio"), [-920007, -920008, -920009]);
    const r = await carrera(
      `${comoServicio}select public.interaccion_vincular('${id}', 1, ${arr([-920010])}, 'staff') is not null`,
      `${comoServicio}select public.interaccion_vincular('${id}', 1, ${arr([-920011])}, 'staff');`);
    const n = await q(`select count(*) from public.interaccion_turnos where interaccion_id = '${id}';`);
    const libre = await q(`select count(*) from public.interaccion_turnos where turno_stand_id = -920011;`);
    comprobar("dos vinculaciones simultáneas con la misma versión: una gana, la otra recibe conflicto",
      r.a.code === 0 && r.b.error === "version_desactualizada" && r.b.ms >= 1200 && n === "4" && libre === "0",
      `B esperó ${r.b.ms} ms y recibió "${r.b.error}"; vínculos = ${n}`);
  }

  {
    const k = randomUUID();
    const d = datos("pregunto", { motivo: "precio" });
    const r = await carrera(
      `${comoServicio}select public.interaccion_registrar('${k}'::uuid, ${jsonb(d)}, null, 'staff') -> 'interaccion' ->> 'id'`,
      `${comoServicio}select (r ->> 'repetida') || '|' || (r -> 'interaccion' ->> 'id') from (select public.interaccion_registrar('${k}'::uuid, ${jsonb(d)}, null, 'staff') as r) s;`);
    const idA = r.a.out.split("\n")[0];
    const n = await q(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`);
    comprobar("misma clave y mismo contenido en paralelo: una sola fila, la segunda recibe la original",
      r.a.code === 0 && r.b.code === 0 && r.b.out === `true|${idA}` && r.b.ms >= 1200 && n === "1",
      `B esperó ${r.b.ms} ms; respuesta "${r.b.out}"`);
  }

  {
    const k = randomUUID();
    const r = await carrera(
      `${comoServicio}select public.interaccion_registrar('${k}'::uuid, ${jsonb(datos("miro"))}, null, 'staff') is not null`,
      `${comoServicio}select public.interaccion_registrar('${k}'::uuid, ${jsonb(datos("pregunto"))}, null, 'staff');`);
    const n = await q(`select count(*) || '|' || max(resultado) from public.interacciones_stand where idempotency_key = '${k}';`);
    comprobar("misma clave con otro contenido en paralelo: conflicto, se conserva el alta original",
      r.a.code === 0 && r.b.error === "idempotency_key_con_otro_payload" && n === "1|miro",
      `B recibió "${r.b.error}"; filas = ${n}`);
  }

  {
    const id = await registrar(datos("pregunto"));
    const r = await carrera(
      `${comoServicio}select public.interaccion_editar('${id}', 1, ${jsonb({ rango_etario: "25_34" })}, 'staff') is not null`,
      `${comoServicio}select public.interaccion_editar('${id}', 1, ${jsonb({ rango_etario: "50_mas" })}, 'admin');`);
    const fila = await q(`select rango_etario || '|' || version from public.interacciones_stand where id = '${id}';`);
    comprobar("dos ediciones simultáneas con la misma versión: la vieja no pisa a la nueva",
      r.a.code === 0 && r.b.error === "version_desactualizada" && fila === "25_34|2",
      `B recibió "${r.b.error}"; queda ${fila}`);
  }

  {
    const id = await registrar(datos("subio"));
    const r = await carrera(
      `${comoServicio}select public.interaccion_anular('${id}', 1, 'duplicada', 'staff') is not null`,
      `${comoServicio}select public.interaccion_vincular('${id}', 1, ${arr([-920012])}, 'staff');`);
    const libre = await q(`select count(*) from public.interaccion_turnos where turno_stand_id = -920012;`);
    comprobar("anular y vincular a la vez: gana la anulación y el turno queda libre",
      r.a.code === 0 && r.b.error === "interaccion_anulada" && libre === "0",
      `B recibió "${r.b.error}"`);
  }

  {
    const id = await registrar(datos("subio"));
    const r = await carrera(
      `${comoServicio}select public.interaccion_vincular('${id}', 1, ${arr([-920013])}, 'staff') is not null`,
      `${comoServicio}update public.turnos_stand set cantidad_personas = 3, turno_listo = true where id = -920013;`);
    const mod = await q(`select turno_modificado from public.interacciones_vinculos_control where turno_stand_id = -920013;`);
    comprobar("el Turnero edita un turno mientras se lo vincula: no se bloquea",
      r.a.code === 0 && r.b.code === 0 && r.b.ms < 1200 && mod === "t",
      `la edición tardó ${r.b.ms} ms; turno_modificado = ${mod}`);
  }

  {
    const id = await registrar(datos("subio"));
    const r = await carrera(
      `${comoServicio}select public.interaccion_vincular('${id}', 1, ${arr([-920014])}, 'staff') is not null`,
      `${comoServicio}delete from public.turnos_stand where id = -920014;`);
    const estado = await q(`select vinculo_estado from public.interacciones_stand_estado where interaccion_id = '${id}';`);
    const ev = await q(`select count(*) from public.interacciones_stand_eventos where interaccion_id = '${id}' and tipo = 'turno_eliminado' and turno_stand_id = -920014;`);
    comprobar("el Turnero borra un turno mientras se lo vincula: espera, borra y la interacción queda pendiente con evento",
      r.a.code === 0 && r.b.code === 0 && r.b.ms >= 1200 && estado === "pendiente" && ev === "1",
      `el borrado esperó ${r.b.ms} ms; estado = ${estado}; eventos turno_eliminado = ${ev}`);
  }

  // 3 · Ráfagas por la API REST local (PostgREST), como las mandará el Bloque 2.
  console.log("\n· Ráfagas simultáneas por REST");
  {
    const k = randomUUID();
    const cuerpo = { p_idempotency_key: k, p_datos: datos("miro", { rango_etario: "18_24" }), p_turnos: null, p_rol: "staff" };
    const rs = await Promise.all(Array.from({ length: 8 }, () => rest("POST", "rpc/interaccion_registrar", cuerpo)));
    const ids = new Set(rs.map((x) => x.json?.interaccion?.id));
    const nuevas = rs.filter((x) => x.json?.repetida === false).length;
    const n = await q(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`);
    comprobar("8 altas iguales a la vez (doble clic exagerado): 1 fila, las 8 reciben la misma",
      rs.every((x) => x.status === 200) && ids.size === 1 && nuevas === 1 && n === "1",
      `estados ${[...new Set(rs.map((x) => x.status))].join(",")}; nuevas = ${nuevas}; filas = ${n}`);
  }

  {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await registrar(datos("subio")));
    const rs = await Promise.all(ids.map((id) =>
      rest("POST", "rpc/interaccion_vincular", { p_id: id, p_version: 1, p_turnos: [-920015], p_rol: "staff" })));
    const ok = rs.filter((x) => x.status === 200).length;
    const choques = rs.filter((x) => x.status === 409 && x.json?.message === "turno_ya_vinculado:-920015").length;
    const n = await q(`select count(*) from public.interaccion_turnos where turno_stand_id = -920015;`);
    comprobar("6 interacciones vinculan el mismo turno a la vez: 1 gana, 5 reciben 409",
      ok === 1 && choques === 5 && n === "1",
      `ok = ${ok}; 409 = ${choques}; vínculos = ${n}`);
  }

  {
    const id = await registrar(datos("pregunto"));
    const rs = await Promise.all(["menos_14", "14_17", "18_24", "25_34", "35_49"].map((rango) =>
      rest("POST", "rpc/interaccion_editar", { p_id: id, p_version: 1, p_cambios: { rango_etario: rango }, p_rol: "staff" })));
    const ok = rs.filter((x) => x.status === 200).length;
    const conflictos = rs.filter((x) => x.json?.message === "version_desactualizada").length;
    const v = await q(`select version from public.interacciones_stand where id = '${id}';`);
    comprobar("5 ediciones simultáneas con la misma versión: 1 aplica, 4 conflicto",
      ok === 1 && conflictos === 4 && v === "2", `ok = ${ok}; conflictos = ${conflictos}; versión = ${v}`);
  }

  // 4 · Permisos por REST.
  console.log("\n· Permisos por REST");
  {
    const id = await registrar(datos("subio"));
    const ins = await rest("POST", "interaccion_turnos", { interaccion_id: id, turno_stand_id: -920016, vinculado_por_rol: "admin" });
    const upd = await rest("PATCH", `interacciones_stand?id=eq.${id}`, { personas_grupo: 9, version: 9 });
    const del = await rest("DELETE", `interacciones_stand_eventos?interaccion_id=eq.${id}`);
    const lee = await rest("GET", `interacciones_stand_estado?interaccion_id=eq.${id}`);
    const anonRpc = await rest("POST", "rpc/interaccion_registrar",
      { p_idempotency_key: randomUUID(), p_datos: datos("miro"), p_turnos: null, p_rol: "admin" }, ANON);
    const anonLee = await rest("GET", "interacciones_stand?limit=1", undefined, ANON);
    const sigue = await q(`select personas_grupo || '|' || (select count(*) from public.interaccion_turnos where interaccion_id = '${id}') from public.interacciones_stand where id = '${id}';`);
    comprobar("service_role no puede escribir tablas directo (solo por RPC) y sí leer",
      ins.json?.code === "42501" && upd.json?.code === "42501" && del.json?.code === "42501"
        && lee.status === 200 && sigue === "2|0",
      `insert ${ins.status}/${ins.json?.code}, patch ${upd.status}/${upd.json?.code}, delete ${del.status}/${del.json?.code}, lectura ${lee.status}`);
    comprobar("anon no ejecuta RPCs ni lee",
      anonRpc.status >= 400 && anonLee.status >= 400, `rpc ${anonRpc.status}, lectura ${anonLee.status}`);
  }

  {
    const id = await registrar(datos("subio"), [-920017]);
    const del = await rest("DELETE", "turnos_stand?id=eq.-920017&select=id");
    const estado = await q(`select vinculo_estado || '|' || version || '|' || actualizada_por_rol from public.interacciones_stand s join public.interacciones_stand_estado e on e.interaccion_id = s.id where s.id = '${id}';`);
    const ev = await q(`select datos -> 'al_vincular' ->> 'total' from public.interacciones_stand_eventos where interaccion_id = '${id}' and tipo = 'turno_eliminado' and turno_stand_id = -920017 and rol is null;`);
    comprobar("borrar por REST un turno vinculado (camino del Turnero): funciona y deja la interacción pendiente",
      del.status === 200 && Array.isArray(del.json) && del.json.length === 1 && estado === "pendiente|2|sistema" && ev === "34000",
      `DELETE ${del.status}; estado ${estado}; total al vincular en el evento = ${ev}`);
  }

  // 5 · Lo ajeno no cambió.
  const huella1 = await huella();
  comprobar("turnos (fuera de los fixtures), reservas, Finanzas, Mensualidades y empleados sin cambios", huella0 === huella1);
}

let fallo = null;
try {
  await main();
} catch (e) {
  fallo = e;
  console.error(`\nABORTO: ${e.message}`);
} finally {
  try {
    await limpiar();
    const resto = await q(`select (select count(*) from public.turnos_stand where id between ${T_MIN} and ${T_MAX})
      + (select count(*) from public.interacciones_stand where observaciones = '${MARCA}');`);
    comprobar("limpieza: no quedan fixtures en la base local", resto === "0", `restos = ${resto}`);
  } catch (e) {
    console.error(`\nNo se pudo limpiar: ${e.message}`);
    fallo ??= e;
  }
}

const fallas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones OK${fallas ? ` — ${fallas} FALLA(S)` : ""}`);
process.exit(fallo || fallas ? 1 : 0);
