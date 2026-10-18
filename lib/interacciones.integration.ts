// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  LIMITES, MOTIVOS, MOTIVOS_CIERRE, RANGOS_ETARIOS, RESPUESTAS, RESULTADOS, INICIADORES, fechaSim, horaSim,
  minutoLocal, ventanaVinculables,
} from "@/lib/interacciones";
import { sumarDias } from "@/lib/agenda";

// Interacciones del stand · Bloque 2 — las RUTAS reales de Next contra el stack
// LOCAL (db/interacciones-bloque1.sql aplicado). Cubre el contrato HTTP:
// sesión/rol/origen, autoridad del cliente, idempotencia, vínculos sin escrituras
// parciales, edición parcial con versión, ventanas de staff en hora de Córdoba,
// pendientes viejas, cierre, listados con cursor, turnos vinculables sin datos
// personales ni reservas web ni históricos, IDs bigint, módulo sin inicio y el
// contrato de límites/valores entre TypeScript y la base. Cierre previo al
// lanzamiento: pausa de altas (sin tocar el inicio) y borrado administrativo.
//
// La sesión se firma con un secreto DESCARTABLE y next/headers se reemplaza por
// un almacén en memoria (mismo patrón que lib/reservaPostpay.test.ts).
// Lo que service_role no puede hacer —vaciar el inicio, fechar un alta 49 h atrás
// y limpiar— se hace con psql DENTRO del contenedor local, nunca en otra base.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/interacciones.integration.ts

const MARCA = `zzinter2_${Date.now().toString(36)}`;
const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const BIG = "9007199254740993"; // > 2^53: Number() lo redondearía a …992
const BIG_INEXISTENTE = "9007199254740995";

// ── psql local (solo para lo que service_role no puede hacer) ──────────────
{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
// Sesión psql ASÍNCRONA que retiene un bloqueo unos segundos (para forzar el cruce
// de dos rutas reales en un orden determinado). Solo contra el contenedor local.
function retener(q: string, segundos: number): Promise<{ code: number | null; err: string }> {
  return new Promise((res) => {
    const p = spawn("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => res({ code, err }));
    p.stdin.end(`begin;\n${q};\nselect pg_sleep(${segundos});\ncommit;`);
  });
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Registro de lo creado, para limpiar ────────────────────────────────────
const claves: string[] = [];
const interacciones = new Set<string>();
const turnosFixture: string[] = [];
let inicioPrevio: string | null = null;
let pausaPrevia: string | null = null;
let empleadoId: string | null = null;

async function main() {
  // ── Sesión y rutas ───────────────────────────────────────────────────────
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }) },
  } as unknown as NodeJS.Module;
  const { createSessionToken } = await import("@/lib/adminSession");
  const staff = await createSessionToken("staff");
  const admin = await createSessionToken("admin");
  const RAIZ = await import("@/app/api/admin/interacciones/route");
  const UNA = await import("@/app/api/admin/interacciones/[id]/route");
  const ANULAR = await import("@/app/api/admin/interacciones/[id]/anular/route");
  const TURNOS = await import("@/app/api/admin/interacciones/[id]/turnos/route");
  const CIERRE = await import("@/app/api/admin/interacciones/[id]/cierre/route");
  const VINC = await import("@/app/api/admin/interacciones/turnos-vinculables/route");
  const ELIM = await import("@/app/api/admin/interacciones/[id]/eliminar/route");
  const METR = await import("@/app/api/admin/interacciones/metricas/route");
  const TURNERO = await import("@/app/api/turnos-stand/[id]/route");
  const EMPS = await import("@/app/api/admin/interacciones/empleados/route");

  type Resp = { status: number; json: Record<string, unknown> & { interaccion?: Record<string, unknown> } };
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  async function http(h: unknown, metodo: string, url: string, o: { token?: string; body?: unknown; origin?: string | null; id?: string } = {}): Promise<Resp> {
    cookie = o.token;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (o.origin !== null) headers.origin = o.origin ?? ORIGEN;
    const req = new Request(`${ORIGEN}${url}`, { method: metodo, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    const res = await (h as Handler)(req, { params: Promise.resolve({ id: o.id ?? "" }) });
    const json = (await res.json().catch(() => ({}))) as Resp["json"];
    const i = json?.interaccion as { id?: string } | undefined;
    if (i?.id) interacciones.add(i.id);
    return { status: res.status, json };
  }
  const alta = (token: string, datos: Record<string, unknown>, turnos?: string[], key = randomUUID(), extra: Record<string, unknown> = {}) => {
    claves.push(key);
    return http(RAIZ.POST, "POST", "/api/admin/interacciones", { token, body: { idempotency_key: key, datos: { observaciones: MARCA, ...datos }, ...(turnos ? { turnos } : {}), ...extra } });
  };
  const inter = (r: Resp) => r.json.interaccion as Record<string, unknown> & {
    id: string; version: number; vinculo: Record<string, unknown>; turnos: Array<Record<string, unknown>>;
    advertencias: Array<{ codigo: string; turnos?: string[]; turno_stand_id?: string }>; permisos: Record<string, boolean>;
  };
  const codigos = (r: Resp) => inter(r).advertencias.map((a) => a.codigo);

  // ── Fixtures: turnos del Turnero con datos personales y cabina, para probar que no salen ──
  const ahora = new Date();
  const hoy = fechaSim(ahora);
  const A = new Date(ahora.getTime() - 30 * 60_000); // ancla de vinculables
  const en = (msDesdeAncla: number) => new Date(A.getTime() + msDesdeAncla);
  const min = 60_000;
  type Fx = { id: string; instante: Date; total?: number; metodo?: string };
  const fx: Record<string, Fx> = {
    T1: { id: "-930001", instante: en(25 * min) }, T2: { id: "-930002", instante: en(25 * min) },
    T3: { id: "-930003", instante: en(25 * min) }, T4: { id: "-930004", instante: en(25 * min) },
    V1: { id: "-930011", instante: en(-10 * min) }, V2: { id: "-930012", instante: en(-100 * min) },
    V3: { id: "-930013", instante: en(-150 * min) }, V4: { id: "-930014", instante: en(20 * min) },
    V5: { id: "-930015", instante: en(-60 * min) }, VG: { id: "-930016", instante: en(-40 * min), total: 0, metodo: "gratis" },
    VB: { id: BIG, instante: en(-5 * min) },
    E1: { id: "-930031", instante: en(-35 * min) }, E2: { id: "-930032", instante: en(-45 * min) },
    E3: { id: "-930033", instante: en(-55 * min), total: 0, metodo: "gratis" },
    OLD: { id: "-930021", instante: new Date(ahora.getTime() - 49 * 3_600_000 - 30 * min) },
  };
  const filasTurnos = Object.values(fx).map((t) => ({
    id: t.id, nombre: `NOMBRE SECRETO ${MARCA}`, telefono: "000-SECRETO", observaciones: "OBS SECRETA",
    simuladores: ["Ferrari", "McLaren"], cantidad_simuladores: 2,
    fecha: fechaSim(t.instante), hora: horaSim(t.instante), cantidad_personas: 2, cantidad_minutos: 20, cantidad_turnos: 4,
    total: t.total ?? 34000, metodo_pago: t.metodo ?? "qr", estado: "activo", modalidad: "v2_10",
  }));
  for (const f of filasTurnos) turnosFixture.push(f.id);
  {
    const { error } = await supabaseAdmin.from("turnos_stand").insert(filasTurnos);
    assert.equal(error, null, `fixtures de turnos: ${error?.message}`);
  }
  // Una reserva web y un histórico a la misma hora: NO tienen que aparecer nunca.
  sql(`insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado)
       overriding system value values (-939001, ${lit(`RESERVA ${MARCA}`)}, '000', ${lit(fechaSim(en(-15 * min)))}, ${lit(horaSim(en(-15 * min)))}, '["Alpine"]', 1, 10000, 'activa');
       insert into public.turnos_historicos (archivo_nombre, archivo_key, fecha, metodo_pago, hash_unico, hora_tomado)
       values (${lit(MARCA)}, ${lit(MARCA)}, ${lit(fechaSim(en(-15 * min)))}, 'qr', ${lit(MARCA)}, ${lit(horaSim(en(-15 * min)))});`);
  const huellaAjena = () => sql(`select md5(string_agg(h, '|' order by h)) from (
      select md5(string_agg(md5(t::text), '' order by md5(t::text))) as h from public.turnos_stand t
      union all select md5(coalesce(string_agg(md5(r::text), '' order by md5(r::text)), '')) from public.reservas r
      union all select md5(coalesce(string_agg(md5(h::text), '' order by md5(h::text)), '')) from public.turnos_historicos h
      union all select md5(coalesce(string_agg(md5(f::text), '' order by md5(f::text)), '')) from public.fin_movimientos f
    ) s;`);
  const huella0 = huellaAjena();

  // ── 1. Módulo sin inicio: se detecta y no se escribe nada ────────────────
  inicioPrevio = sql("select coalesce(inicio_registro::text, '') from public.interacciones_config where id;") || null;
  pausaPrevia = sql("select coalesce(altas_pausadas_en::text, '') from public.interacciones_config where id;") || null;
  sql("update public.interacciones_config set inicio_registro = null, altas_pausadas_en = null where id;");
  {
    const l = await http(RAIZ.GET, "GET", "/api/admin/interacciones", { token: admin });
    assert.equal(l.status, 200);
    const modulo = l.json.modulo as Record<string, unknown>;
    assert.deepEqual([modulo.instalado, modulo.habilitado, modulo.inicio_registro], [true, false, null], "1 · el listado dice que no está habilitado");
    const k = randomUUID();
    const r = await alta(staff, { resultado: "miro", personas_grupo: 1 }, undefined, k);
    assert.deepEqual([r.status, r.json.codigo], [503, "modulo_no_habilitado"], "1 · alta sin inicio → 503 controlado");
    assert.equal(sql(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`), "0");
    const local = sql("select to_char((now() - interval '30 days') at time zone 'America/Argentina/Cordoba', 'YYYY-MM-DD HH24:MI:SS');");
    const { error } = await supabaseAdmin.rpc("interacciones_definir_inicio", { p_inicio_local: local, p_rol: "admin" });
    assert.equal(error, null, "1 · el inicio se define por la RPC, en hora de Córdoba");
    const l2 = await http(RAIZ.GET, "GET", "/api/admin/interacciones", { token: staff });
    assert.equal((l2.json.modulo as Record<string, unknown>).habilitado, true);
  }

  // ── 2. Contrato TypeScript ↔ base: límites y valores permitidos ──────────
  {
    const { data, error } = await supabaseAdmin.rpc("interacciones_limites");
    assert.equal(error, null);
    assert.deepEqual(data, { ...LIMITES }, "2 · LIMITES = interacciones_limites()");
    // Valores de "<columna> = ANY (ARRAY[...])" dentro del CHECK.
    const valores = (con: string, columna: string) => {
      const def = sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = '${con}';`);
      const m = new RegExp(`\\(${columna} = ANY \\(ARRAY\\[([^\\]]+)\\]\\)\\)`).exec(def);
      assert.ok(m, `2 · ${con} enumera ${columna}`);
      return [...m[1].matchAll(/'([^']+)'::text/g)].map((x) => x[1]).sort();
    };
    const igual = (con: string, columna: string, esperado: readonly string[]) =>
      assert.deepEqual(valores(con, columna), [...esperado].sort(), `2 · ${con}`);
    igual("interacciones_stand_resultado_chk", "resultado", RESULTADOS);
    igual("interacciones_stand_rango_chk", "rango_etario", RANGOS_ETARIOS);
    igual("interacciones_stand_conocia_chk", "conocia_sim", RESPUESTAS);
    igual("interacciones_stand_subio_antes_chk", "se_subio_antes", RESPUESTAS);
    igual("interacciones_stand_iniciador_chk", "iniciador", INICIADORES);
    igual("interacciones_stand_motivo_chk", "motivo", MOTIVOS);
    igual("interacciones_stand_cierre_chk", "cierre_motivo", MOTIVOS_CIERRE);
    assert.ok(sql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'interacciones_stand_personas_chk';")
      .includes(`${LIMITES.personas_grupo_max}`), "2 · tope de personas");
  }

  // ── 3. Sesión, rol y origen ──────────────────────────────────────────────
  const id0 = randomUUID();
  {
    const sinSesion: Array<[unknown, string, string]> = [
      [RAIZ.GET, "GET", "/api/admin/interacciones"], [RAIZ.POST, "POST", "/api/admin/interacciones"],
      [UNA.GET, "GET", `/api/admin/interacciones/${id0}`], [UNA.PATCH, "PATCH", `/api/admin/interacciones/${id0}`],
      [ANULAR.POST, "POST", `/api/admin/interacciones/${id0}/anular`], [TURNOS.POST, "POST", `/api/admin/interacciones/${id0}/turnos`],
      [TURNOS.DELETE, "DELETE", `/api/admin/interacciones/${id0}/turnos?turno=1&version=1`],
      [CIERRE.POST, "POST", `/api/admin/interacciones/${id0}/cierre`],
      [VINC.GET, "GET", "/api/admin/interacciones/turnos-vinculables"], [EMPS.GET, "GET", "/api/admin/interacciones/empleados"],
    ];
    for (const [h, m, u] of sinSesion) {
      for (const token of [undefined, "falsa.firma"]) {
        const r = await http(h, m, u, { token, id: id0, body: m === "GET" || m === "DELETE" ? undefined : {} });
        assert.equal(r.status, 401, `3 · ${m} ${u} sin sesión válida → 401`);
      }
    }
    const k = randomUUID();
    claves.push(k);
    const mal = await http(RAIZ.POST, "POST", "/api/admin/interacciones", {
      token: staff, origin: "https://evil.example", body: { idempotency_key: k, datos: { resultado: "miro", personas_grupo: 1 } },
    });
    assert.equal(mal.status, 403, "3 · origen ajeno → 403");
    assert.equal(sql(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`), "0", "3 · y no escribe");
    for (const [h, m, u] of [
      [UNA.PATCH, "PATCH", `/api/admin/interacciones/${id0}`], [ANULAR.POST, "POST", `/api/admin/interacciones/${id0}/anular`],
      [TURNOS.POST, "POST", `/api/admin/interacciones/${id0}/turnos`], [TURNOS.DELETE, "DELETE", `/api/admin/interacciones/${id0}/turnos?turno=1&version=1`],
      [CIERRE.POST, "POST", `/api/admin/interacciones/${id0}/cierre`],
    ] as Array<[unknown, string, string]>) {
      const r = await http(h, m, u, { token: admin, origin: "https://evil.example", id: id0, body: m === "DELETE" ? undefined : { version: 1 } });
      assert.equal(r.status, 403, `3 · ${m} ${u} desde otro origen → 403`);
    }
    const c = await http(CIERRE.POST, "POST", `/api/admin/interacciones/${id0}/cierre`, { token: staff, id: id0, body: { version: 1, motivo: "otro", nota: "x" } });
    assert.equal(c.status, 403, "3 · staff no cierra");
    const nf = await http(UNA.GET, "GET", "/api/admin/interacciones/no-es-uuid", { token: staff, id: "no-es-uuid" });
    assert.deepEqual([nf.status, nf.json.codigo], [404, "interaccion_inexistente"]);
  }

  // ── 4. Autoridad: nunca del cliente ──────────────────────────────────────
  {
    for (const [extra, datos, campo] of [
      [{ rol: "admin" }, {}, "rol"],
      [{}, { registrada_por_rol: "admin" }, "registrada_por_rol"],
      [{}, { actualizada_por_rol: "admin" }, "actualizada_por_rol"],
      [{}, { nombre: "Juan" }, "nombre"],
    ] as Array<[Record<string, unknown>, Record<string, unknown>, string]>) {
      const k = randomUUID();
      const r = await alta(staff, { resultado: "miro", personas_grupo: 1, ...datos }, undefined, k, extra);
      assert.deepEqual([r.status, r.json.codigo, r.json.campo], [400, "campo_no_permitido", campo], `4 · ${campo} desde el cliente → 400`);
      assert.equal(sql(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`), "0");
    }
    const s = await alta(staff, { resultado: "miro", personas_grupo: 1 });
    assert.equal(inter(s).registrada_por_rol, "staff", "4 · el registrador sale de la sesión");
    const a = await alta(admin, { resultado: "miro", personas_grupo: 1 });
    assert.equal(inter(a).registrada_por_rol, "admin");
  }

  // ── 5. Alta idempotente ──────────────────────────────────────────────────
  {
    const k = randomUUID();
    const d = { resultado: "pregunto", personas_grupo: 3, hombres: 2, mujeres: 1, rango_etario: "18_24", conocia_sim: "no", motivo: "precio" };
    const r1 = await alta(staff, d, undefined, k);
    assert.equal(r1.status, 201);
    assert.equal(r1.json.repetida, false);
    const r2 = await alta(staff, d, undefined, k);
    assert.deepEqual([r2.status, r2.json.repetida, inter(r2).id, inter(r2).version], [200, true, inter(r1).id, 1], "5 · reintento = la original");
    const r3 = await alta(staff, { ...d, personas_grupo: 4, hombres: 3 }, undefined, k);
    assert.deepEqual([r3.status, r3.json.codigo], [409, "idempotency_key_con_otro_payload"]);
    assert.equal(sql(`select count(*) || '|' || max(personas_grupo) from public.interacciones_stand where idempotency_key = '${k}';`), "1|3");
    const g = await http(UNA.GET, "GET", `/api/admin/interacciones/${inter(r1).id}`, { token: staff, id: inter(r1).id });
    assert.deepEqual([g.status, inter(g).version, inter(g).motivo], [200, 1, "precio"]);
  }

  // ── 6. Alta con vínculos: sin escrituras parciales ───────────────────────
  let conTurno: Resp;
  {
    conTurno = await alta(staff, { resultado: "subio", personas_grupo: 2, iniciador: "cliente" }, [fx.T1.id]);
    assert.equal(conTurno.status, 201);
    assert.equal(inter(conTurno).vinculo.estado, "con_turno");
    assert.equal(inter(conTurno).turnos[0].turno_stand_id, fx.T1.id, "6 · id como cadena");
    assert.equal(typeof inter(conTurno).turnos[0].turno_stand_id, "string");
    const k = randomUUID();
    const r = await alta(staff, { resultado: "subio", personas_grupo: 2 }, [fx.T2.id, fx.T1.id], k);
    assert.deepEqual([r.status, r.json.codigo, r.json.turno_stand_id], [409, "turno_ya_vinculado", fx.T1.id]);
    assert.equal(sql(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`), "0", "6 · no se guarda la interacción");
    assert.equal(sql(`select count(*) from public.interaccion_turnos where turno_stand_id = ${fx.T2.id};`), "0", "6 · ni el turno libre");
    for (const v of Object.values(r.json)) assert.ok(!/violates|ERROR|constraint|SQL/i.test(String(v)), "6 · sin texto SQL");
  }

  // ── 7. Edición parcial, versión y liberación explícita ───────────────────
  {
    const r = await alta(staff, { resultado: "pregunto", personas_grupo: 2, rango_etario: "18_24", conocia_sim: "no", motivo: "precio" });
    const id = inter(r).id;
    const p = (body: unknown, token = staff) => http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${id}`, { token, id, body });
    const p1 = await p({ version: 1, cambios: { rango_etario: "25_34" } });
    assert.equal(p1.status, 200);
    assert.deepEqual([inter(p1).rango_etario, inter(p1).conocia_sim, inter(p1).motivo, inter(p1).observaciones, inter(p1).version],
      ["25_34", "no", "precio", MARCA, 2], "7 · lo omitido no cambia");
    const p2 = await p({ version: 1, cambios: { rango_etario: "50_mas" } }, admin);
    assert.deepEqual([p2.status, p2.json.codigo], [409, "version_desactualizada"], "7 · versión vieja → 409");
    const p3 = await p({ version: 2, cambios: { conocia_sim: null } });
    assert.deepEqual([inter(p3).conocia_sim, inter(p3).rango_etario], [null, "25_34"], "7 · null vacía solo esa clave");
    const p4 = await p({ version: 3, cambios: { resultado: "subio" } });
    assert.deepEqual([p4.status, p4.json.codigo], [400, "motivo_no_aplica"], "7 · el motivo no se borra solo");
    const p5 = await p({ version: 3, cambios: { resultado: "subio", motivo: null } });
    assert.deepEqual([p5.status, inter(p5).vinculo.estado, inter(p5).motivo], [200, "pendiente", null]);
    // Liberar turnos exige pedirlo.
    const cid = inter(conTurno).id;
    const q = (body: unknown) => http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${cid}`, { token: staff, id: cid, body });
    const q1 = await q({ version: 1, cambios: { resultado: "pregunto" } });
    assert.deepEqual([q1.status, q1.json.codigo, q1.json.turnos], [409, "confirmar_liberacion", [fx.T1.id]]);
    assert.equal(sql(`select count(*) from public.interaccion_turnos where turno_stand_id = ${fx.T1.id};`), "1", "7 · sin confirmar no libera");
    const q0 = await q({ version: 9, cambios: { resultado: "pregunto" }, confirmar_liberacion: true });
    assert.deepEqual([q0.status, q0.json.codigo], [409, "version_desactualizada"]);
    const q2 = await q({ version: 1, cambios: { resultado: "pregunto" }, confirmar_liberacion: true });
    assert.equal(q2.status, 200);
    assert.deepEqual(inter(q2).advertencias.find((a) => a.codigo === "turnos_liberados")?.turnos, [fx.T1.id]);
    assert.equal(sql(`select count(*) from public.interaccion_turnos where turno_stand_id = ${fx.T1.id};`), "0");
  }

  // ── 8. "Atendió": declarado, activo al asignarlo, se conserva si se archiva ──
  {
    const { data, error } = await supabaseAdmin.from("empleados").insert({ nombre_formal: `__TEST_EMP_${MARCA}` }).select("id").single();
    assert.equal(error, null);
    empleadoId = String(data!.id);
    const e = await http(EMPS.GET, "GET", "/api/admin/interacciones/empleados", { token: staff });
    assert.equal(e.status, 200);
    const lista = e.json.empleados as Array<Record<string, unknown>>;
    assert.ok(lista.every((x) => Object.keys(x).sort().join() === "id,nombre"), "8 · solo id y nombre");
    assert.ok(lista.some((x) => x.id === empleadoId));
    assert.ok((e.json.sugeridos as string[]).every((s) => lista.some((x) => x.id === s)), "8 · sugeridos ⊆ activos");
    const r = await alta(staff, { resultado: "pregunto", personas_grupo: 2, atendio_empleado_id: empleadoId });
    assert.deepEqual(inter(r).atendio, { empleado_id: empleadoId, nombre: `__TEST_EMP_${MARCA}`, activo: true, declarado: true });
    await supabaseAdmin.from("empleados").update({ activo: false }).eq("id", empleadoId);
    const id = inter(r).id;
    const p = await http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${id}`, { token: staff, id, body: { version: 1, cambios: { rango_etario: "35_49" } } });
    assert.deepEqual([p.status, (inter(p).atendio as Record<string, unknown>).activo], [200, false], "8 · conservar un archivado no falla");
    const n = await alta(staff, { resultado: "miro", personas_grupo: 1, atendio_empleado_id: empleadoId });
    assert.deepEqual([n.status, n.json.codigo], [400, "empleado_no_disponible"], "8 · asignarlo de nuevo, sí");
    const e2 = await http(EMPS.GET, "GET", "/api/admin/interacciones/empleados", { token: staff });
    assert.ok(!(e2.json.empleados as Array<Record<string, unknown>>).some((x) => x.id === empleadoId), "8 · los archivados no se ofrecen");
  }

  // ── 9. Ventanas de staff (Córdoba) y pendiente vieja ─────────────────────
  {
    // Córdoba es UTC−3 todo el año (sin horario de verano).
    const ayer0 = `${sumarDias(hoy, -1)}T00:00:00-03:00`;
    const ok = await alta(staff, { resultado: "miro", personas_grupo: 1, ocurrida_en: ayer0 });
    assert.equal(ok.status, 201, "9 · staff: ayer 00:00:00 de Córdoba");
    assert.equal(inter(ok).fecha_negocio, sumarDias(hoy, -1));
    const antes = `${sumarDias(hoy, -2)}T23:59:59-03:00`;
    const no = await alta(staff, { resultado: "miro", personas_grupo: 1, ocurrida_en: antes });
    assert.deepEqual([no.status, no.json.codigo], [403, "fuera_de_ventana"], "9 · un segundo antes, no (día calendario, no 24 h)");
    assert.equal((await alta(admin, { resultado: "miro", personas_grupo: 1, ocurrida_en: antes })).status, 201, "9 · admin sí");
    const fut = await alta(staff, { resultado: "miro", personas_grupo: 1, ocurrida_en: new Date(Date.now() + 10 * min).toISOString() });
    assert.deepEqual([fut.status, fut.json.codigo], [400, "ocurrida_en_futura"]);

    // Pendiente cargada hace 49 h (registrada_en no se puede fechar por la RPC: psql local).
    const vieja = sql(`insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_en, registrada_por_rol, resultado, personas_grupo, observaciones)
      values (gen_random_uuid(), md5('vieja'), now() - interval '49 hours', now() - interval '49 hours', 'staff', 'subio', 2, ${lit(MARCA)}) returning id;`).split("\n")[0];
    interacciones.add(vieja);
    const g = await http(UNA.GET, "GET", `/api/admin/interacciones/${vieja}`, { token: staff, id: vieja });
    assert.deepEqual(inter(g).permisos, { editar: false, anular: false, vincular: true, desvincular: false, cerrar_sin_vinculo: false, eliminar: false });
    const e = await http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${vieja}`, { token: staff, id: vieja, body: { version: 1, cambios: { personas_grupo: 3 } } });
    assert.deepEqual([e.status, e.json.codigo], [403, "fuera_de_ventana"]);
    const an = await http(ANULAR.POST, "POST", `/api/admin/interacciones/${vieja}/anular`, { token: staff, id: vieja, body: { version: 1 } });
    assert.deepEqual([an.status, an.json.codigo], [403, "fuera_de_ventana"]);
    // La ventana de turnos sugeridos se ancla en la hora de la INTERACCIÓN, no en ahora.
    const v = await http(VINC.GET, "GET", `/api/admin/interacciones/turnos-vinculables?interaccion=${vieja}`, { token: staff });
    const idsV = (v.json.turnos as Array<{ id: string }>).map((t) => t.id);
    assert.ok(idsV.includes(fx.OLD.id) && !idsV.includes(fx.T3.id), "9 · sugiere los turnos de ese momento");
    // Tolerancia contra la fecha de la interacción: hoy queda afuera aunque se complete hoy.
    const lejos = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${vieja}/turnos`, { token: staff, id: vieja, body: { version: 1, turnos: [fx.T3.id] } });
    assert.deepEqual([lejos.status, lejos.json.codigo, lejos.json.turno_stand_id], [400, "turno_fuera_de_tolerancia", fx.T3.id]);
    const cerca = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${vieja}/turnos`, { token: staff, id: vieja, body: { version: 1, turnos: [fx.OLD.id] } });
    assert.deepEqual([cerca.status, inter(cerca).vinculo.estado, inter(cerca).version], [200, "con_turno", 2], "9 · staff completa una pendiente vieja");
    const des = await http(TURNOS.DELETE, "DELETE", `/api/admin/interacciones/${vieja}/turnos?turno=${fx.OLD.id}&version=2`, { token: staff, id: vieja });
    assert.deepEqual([des.status, des.json.codigo], [403, "fuera_de_ventana"], "9 · pero desvincular, no");
    const desA = await http(TURNOS.DELETE, "DELETE", `/api/admin/interacciones/${vieja}/turnos?turno=${fx.OLD.id}&version=2`, { token: admin, id: vieja });
    assert.deepEqual([desA.status, inter(desA).vinculo.estado], [200, "pendiente"]);
  }

  // ── 10. Cierre (solo admin) y vínculo posterior coherente ────────────────
  {
    const r = await alta(staff, { resultado: "subio", personas_grupo: 3 });
    const id = inter(r).id;
    const c0 = await http(CIERRE.POST, "POST", `/api/admin/interacciones/${id}/cierre`, { token: admin, id, body: { version: 1 } });
    assert.deepEqual([c0.status, c0.json.campo], [400, "cierre_motivo"]);
    const c1 = await http(CIERRE.POST, "POST", `/api/admin/interacciones/${id}/cierre`, { token: admin, id, body: { version: 1, motivo: "sin_turno_en_turnero" } });
    assert.deepEqual([c1.status, inter(c1).vinculo.estado, inter(c1).vinculo.venta_verificada], [200, "cerrada_sin_turno", false], "10 · cerrar no verifica");
    assert.ok(codigos(c1).includes("subida_declarada_sin_turno"));
    const v = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${id}/turnos`, { token: staff, id, body: { version: 2, turnos: [fx.T2.id] } });
    assert.deepEqual([v.status, inter(v).vinculo.estado, inter(v).cierre], [200, "con_turno", null]);
    assert.ok(codigos(v).includes("cierre_retirado"), "10 · el cierre se retira y se avisa");
    const c2 = await http(CIERRE.POST, "POST", `/api/admin/interacciones/${id}/cierre`, { token: admin, id, body: { version: 3, motivo: "otro", nota: "x" } });
    assert.deepEqual([c2.status, c2.json.codigo], [409, "tiene_turnos_vinculados"]);
    // Anulación: libera, avisa y no se repite.
    const a1 = await http(ANULAR.POST, "POST", `/api/admin/interacciones/${id}/anular`, { token: staff, id, body: { version: 3, motivo: "duplicada" } });
    assert.deepEqual([a1.status, inter(a1).vinculo.estado], [200, "anulada"]);
    assert.deepEqual(inter(a1).advertencias.find((a) => a.codigo === "turnos_liberados")?.turnos, [fx.T2.id]);
    const a2 = await http(ANULAR.POST, "POST", `/api/admin/interacciones/${id}/anular`, { token: staff, id, body: { version: 3 } });
    assert.deepEqual([a2.status, a2.json.sin_cambios], [200, true]);
    const pe = await http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${id}`, { token: admin, id, body: { version: 4, cambios: { personas_grupo: 2 } } });
    assert.deepEqual([pe.status, pe.json.codigo], [409, "interaccion_anulada"]);
  }

  // ── 11. IDs bigint de punta a punta ──────────────────────────────────────
  {
    const r = await alta(staff, { resultado: "subio", personas_grupo: 2 });
    const id = inter(r).id;
    const num = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${id}/turnos`, { token: staff, id, body: { version: 1, turnos: [Number(fx.T4.id)] } });
    assert.deepEqual([num.status, num.json.campo], [400, "turnos"], "11 · un número de JSON se rechaza");
    const ovf = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${id}/turnos`, { token: staff, id, body: { version: 1, turnos: ["9223372036854775808"] } });
    assert.equal(ovf.status, 400);
    const ine = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${id}/turnos`, { token: staff, id, body: { version: 1, turnos: [BIG_INEXISTENTE] } });
    assert.deepEqual([ine.status, ine.json.codigo, ine.json.turno_stand_id], [404, "turno_inexistente", BIG_INEXISTENTE], "11 · sin redondeo en el error");
    const ok = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${id}/turnos`, { token: staff, id, body: { version: 1, turnos: [BIG] } });
    assert.deepEqual([ok.status, inter(ok).turnos[0].turno_stand_id], [200, BIG], "11 · 9007199254740993 vuelve exacto");
    const l = await http(RAIZ.GET, "GET", `/api/admin/interacciones?desde=${fechaSim(A)}&hasta=${hoy}&limite=100`, { token: admin });
    const enLista = (l.json.items as Array<{ id: string; turnos: Array<{ turno_stand_id: string }> }>).find((x) => x.id === id);
    assert.equal(enLista?.turnos[0].turno_stand_id, BIG, "11 · también en el listado");
    const de = await http(TURNOS.DELETE, "DELETE", `/api/admin/interacciones/${id}/turnos?turno=${BIG}&version=2`, { token: staff, id });
    assert.deepEqual([de.status, inter(de).vinculo.estado], [200, "pendiente"]);
  }

  // ── 12. Turnos vinculables: ventana, búsqueda, sin datos personales, solo Turnero ──
  {
    // Un turno de la ventana queda tomado por otra interacción.
    const duena = await alta(staff, { resultado: "subio", personas_grupo: 2 }, [fx.V5.id]);
    const { data: todos } = await supabaseAdmin.from("turnos_stand").select("id:id::text, fecha, hora").in("id", turnosFixture);
    const esperado = (alcance: "2h" | "dia" | "tolerancia") => {
      const v = ventanaVinculables(A, alcance);
      return ((todos ?? []) as Array<{ id: string; fecha: string; hora: string }>)
        .filter((t) => { const m = minutoLocal(t.fecha, t.hora)!; return m >= v.minuto_desde && m <= v.minuto_hasta; })
        .map((t) => t.id).sort();
    };
    const pedir = (q: string, token = staff) => http(VINC.GET, "GET", `/api/admin/interacciones/turnos-vinculables?ocurrida_en=${encodeURIComponent(A.toISOString())}${q}`, { token });
    const soloFixtures = (r: Resp) => (r.json.turnos as Array<{ id: string }>).map((t) => t.id).filter((i) => turnosFixture.includes(i)).sort();
    for (const alcance of ["2h", "dia", "tolerancia"] as const) {
      const r = await pedir(alcance === "2h" ? "" : `&alcance=${alcance}`);
      assert.equal(r.status, 200);
      assert.deepEqual(soloFixtures(r), esperado(alcance), `12 · alcance ${alcance}`);
    }
    const r = await pedir("");
    const turnos = r.json.turnos as Array<Record<string, unknown>>;
    assert.ok(turnos.some((t) => t.id === BIG), "12 · el id grande aparece exacto");
    for (const t of turnos) {
      assert.deepEqual(Object.keys(t).sort(), ["disponible", "es_pago", "fecha", "hora", "hora_subida", "id", "minutos", "modalidad", "pago_contradictorio", "personas", "total", "vinculacion"]);
      assert.equal(typeof t.id, "string");
    }
    const texto = JSON.stringify(r.json);
    for (const prohibido of ["SECRETO", "SECRETA", "Ferrari", "McLaren", "Alpine", "RESERVA"]) assert.ok(!texto.includes(prohibido), `12 · no sale "${prohibido}"`);
    const { data: existentes } = await supabaseAdmin.from("turnos_stand").select("id:id::text").in("id", turnos.map((t) => String(t.id)));
    assert.equal((existentes ?? []).length, turnos.length, "12 · todo lo listado es turnos_stand (ni reservas web ni históricos)");
    assert.ok(!turnos.some((t) => t.id === "-939001"));
    const v5 = turnos.find((t) => t.id === fx.V5.id)!;
    assert.deepEqual([v5.vinculacion, v5.disponible], ["otra", false], "12 · ocupado = no disponible");
    assert.ok(!soloFixtures(await pedir("&incluir_vinculados=0")).includes(fx.V5.id), "12 · y se puede ocultar");
    const propia = await http(VINC.GET, "GET", `/api/admin/interacciones/turnos-vinculables?interaccion=${inter(duena).id}&alcance=dia`, { token: staff });
    assert.equal((propia.json.turnos as Array<Record<string, unknown>>).find((t) => t.id === fx.V5.id)?.vinculacion, "esta");
    const vg = turnos.find((t) => t.id === fx.VG.id);
    if (vg) assert.deepEqual([vg.es_pago, vg.pago_contradictorio], [false, false], "12 · gratis coherente");
    const h = horaSim(fx.V1.instante).slice(0, 4);
    const b = await pedir(`&alcance=dia&hora=${encodeURIComponent(h)}`);
    assert.ok((b.json.turnos as Array<{ hora: string }>).every((t) => t.hora.startsWith(h)) && soloFixtures(b).includes(fx.V1.id), "12 · búsqueda por hora");
    const malo = await pedir("&nombre=juan");
    assert.equal(malo.status, 400);
  }

  // ── 13. Listados: orden estable, cursor, ventana de staff, pendientes ────
  {
    for (let i = 0; i < 5; i++) {
      await alta(staff, { resultado: "miro", personas_grupo: 1, ocurrida_en: new Date(Date.now() - (i + 1) * 1000).toISOString() });
    }
    const vistos: Array<{ id: string; ocurrida_en: string }> = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const q: string = `/api/admin/interacciones?desde=${hoy}&hasta=${hoy}&limite=2${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await http(RAIZ.GET, "GET", q, { token: staff });
      assert.equal(r.status, 200);
      const items = r.json.items as Array<{ id: string; ocurrida_en: string }>;
      assert.ok(items.length <= 2);
      vistos.push(...items);
      cursor = r.json.siguiente as string | null;
      paginas++;
    } while (cursor && paginas < 100);
    assert.equal(new Set(vistos.map((x) => x.id)).size, vistos.length, "13 · sin repetidos entre páginas");
    // Mismo formato y offset (+00:00) en todas: la comparación de texto respeta los
    // microsegundos, que Date.parse perdería.
    for (let i = 1; i < vistos.length; i++) {
      const a = vistos[i - 1];
      const b = vistos[i];
      assert.ok(a.ocurrida_en > b.ocurrida_en || (a.ocurrida_en === b.ocurrida_en && a.id > b.id), "13 · ocurrida_en desc, id desc");
    }
    const total = sql(`select count(*) from public.interacciones_stand where fecha_negocio = ${lit(hoy)} and anulada_en is null;`);
    assert.equal(String(vistos.length), total, "13 · el cursor recorre todo y nada más");
    const fuera = await http(RAIZ.GET, "GET", `/api/admin/interacciones?desde=${sumarDias(hoy, -5)}`, { token: staff });
    assert.deepEqual([fuera.status, fuera.json.codigo], [403, "fuera_de_ventana"]);
    assert.equal((await http(RAIZ.GET, "GET", `/api/admin/interacciones?desde=${sumarDias(hoy, -5)}`, { token: admin })).status, 200);
    const pend = await http(RAIZ.GET, "GET", "/api/admin/interacciones?estado=pendiente&limite=100", { token: staff });
    const pendientes = pend.json.items as Array<{ fecha_negocio: string; vinculo: { estado: string } }>;
    assert.ok(pendientes.length > 0 && pendientes.every((x) => x.vinculo.estado === "pendiente"));
    assert.ok(pendientes.some((x) => x.fecha_negocio < sumarDias(hoy, -1)), "13 · staff ve pendientes viejas");
    const conAnul = await http(RAIZ.GET, "GET", `/api/admin/interacciones?desde=${hoy}&incluir_anuladas=1&limite=100`, { token: admin });
    const sinAnul = await http(RAIZ.GET, "GET", `/api/admin/interacciones?desde=${hoy}&limite=100`, { token: admin });
    assert.ok((conAnul.json.items as unknown[]).length > (sinAnul.json.items as unknown[]).length, "13 · anuladas solo si se piden");
    assert.ok(!JSON.stringify(conAnul.json).includes("SECRETO"), "13 · sin datos personales");
  }

  // ── 15. Pausa de altas: rechaza cargas nuevas, conserva inicio, historial y correcciones ──
  {
    const inicio = sql("select inicio_registro::text from public.interacciones_config where id;");
    const kGuardada = randomUUID();
    const guardada = await alta(staff, { resultado: "pregunto", personas_grupo: 2 }, undefined, kGuardada);
    assert.equal(guardada.status, 201);
    const { error: ePausa } = await supabaseAdmin.rpc("interacciones_pausar_altas", { p_rol: "admin" });
    assert.equal(ePausa, null, "15 · la pausa la hace un admin por la RPC");
    const l = await http(RAIZ.GET, "GET", "/api/admin/interacciones", { token: staff });
    const modulo = l.json.modulo as Record<string, unknown>;
    assert.deepEqual([l.status, modulo.habilitado, modulo.altas_pausadas, modulo.inicio_registro !== null], [200, true, true, true],
      "15 · el listado sigue y distingue pausa de no habilitado");
    const k = randomUUID();
    const nueva = await alta(staff, { resultado: "miro", personas_grupo: 1 }, undefined, k);
    assert.deepEqual([nueva.status, nueva.json.codigo], [503, "altas_pausadas"], "15 · alta nueva → 503 altas_pausadas");
    assert.ok(!/sql|supabase|config/i.test(String(nueva.json.error)), "15 · sin detalles de infraestructura para el personal");
    assert.equal(sql(`select count(*) from public.interacciones_stand where idempotency_key = '${k}';`), "0");
    const repetida = await alta(staff, { resultado: "pregunto", personas_grupo: 2 }, undefined, kGuardada);
    assert.deepEqual([repetida.status, inter(repetida).id], [200, inter(guardada).id], "15 · el reintento de una carga ya guardada devuelve la original");
    const ed = await http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${inter(guardada).id}`, { token: staff, id: inter(guardada).id, body: { version: 1, cambios: { motivo: "precio" } } });
    assert.equal(ed.status, 200, "15 · corregir sigue");
    const det = await http(UNA.GET, "GET", `/api/admin/interacciones/${inter(guardada).id}`, { token: staff, id: inter(guardada).id });
    assert.equal(det.status, 200, "15 · consultar sigue");
    const m = await http(METR.GET, "GET", `/api/admin/interacciones/metricas?desde=${hoy}&hasta=${hoy}`, { token: admin });
    assert.equal(m.status, 200, "15 · el análisis sigue disponible");
    assert.equal((m.json.modulo as Record<string, unknown>).altas_pausadas, true, "15 · y avisa la pausa");
    const { error: eReanudar } = await supabaseAdmin.rpc("interacciones_reanudar_altas", { p_rol: "admin" });
    assert.equal(eReanudar, null);
    assert.equal(sql("select inicio_registro::text from public.interacciones_config where id;"), inicio, "15 · pausar y reanudar no tocan el inicio");
    const otra = await alta(staff, { resultado: "miro", personas_grupo: 1 }, undefined, k);
    assert.equal(otra.status, 201, "15 · reanudada, la misma carga entra una sola vez");
    const { error: eInicio } = await supabaseAdmin.rpc("interacciones_definir_inicio", { p_inicio_local: "2020-01-01 00:00", p_rol: "admin" });
    assert.equal(eInicio?.message, "inicio_ya_definido", "15 · con registros, el inicio histórico no se cambia");
  }

  // ── 16. Borrado administrativo por la API ────────────────────────────────
  {
    const metricasHoy = async () => {
      const r = await http(METR.GET, "GET", `/api/admin/interacciones/metricas?desde=${hoy}&hasta=${hoy}`, { token: admin });
      const a = r.json.actual as { metricas: { embudo: { interacciones: number; personas: number; subieron: number } }; cobertura: { turnos: number; vinculados: number } };
      return { embudo: a.metricas.embudo, cobertura: a.cobertura };
    };
    const conTurnos = await alta(staff, { resultado: "subio", personas_grupo: 3 }, [fx.E1.id, fx.E2.id]);
    const anulada = await alta(staff, { resultado: "miro", personas_grupo: 2 });
    assert.equal((await http(ANULAR.POST, "POST", `/api/admin/interacciones/${inter(anulada).id}/anular`, { token: staff, id: inter(anulada).id, body: { version: 1 } })).status, 200);
    const pendiente = await alta(staff, { resultado: "subio", personas_grupo: 1 });
    const id = inter(conTurnos).id;
    // Otro dispositivo la corrige después de que el admin abrió la confirmación (v1 → v2).
    const corregida = await http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${id}`, { token: staff, id, body: { version: 1, cambios: { personas_grupo: 4 } } });
    assert.equal(inter(corregida).version, 2);
    const antes = await metricasHoy();
    const borrar = (token: string, cuerpo: unknown, o: { id?: string; origin?: string | null } = {}) =>
      http(ELIM.POST, "POST", `/api/admin/interacciones/${o.id ?? id}/eliminar`, { token, id: o.id ?? id, body: cuerpo, origin: o.origin });

    assert.equal((await borrar(staff, { version: 1 })).status, 403, "16 · staff no puede borrar por API");
    assert.equal((await borrar("", { version: 1 })).status, 401, "16 · sin sesión → 401");
    assert.equal((await borrar(admin, { version: 1 }, { origin: "https://otro.example" })).status, 403, "16 · origen ajeno → 403");
    assert.equal((await borrar(admin, { version: 1, rol: "admin" })).status, 400, "16 · el rol no viaja en el cuerpo");
    const vieja = await borrar(admin, { version: 1 });
    assert.deepEqual([vieja.status, vieja.json.codigo], [409, "version_desactualizada"], "16 · versión vieja → conflicto, no borra");
    assert.equal(sql(`select count(*) from public.interaccion_turnos where interaccion_id = '${id}';`), "2");

    const ok = await borrar(admin, { version: 2, motivo: "  carga de prueba  " });
    assert.equal(ok.status, 200, "16 · admin borra");
    assert.deepEqual([ok.json.eliminada, ok.json.sin_cambios, [...(ok.json.turnos_liberados as string[])].sort()], [true, false, [fx.E1.id, fx.E2.id].sort()]);
    assert.ok(!("interaccion" in ok.json), "16 · no devuelve la interacción: ya no existe para el panel");
    const otraVez = await borrar(admin, { version: 2 });
    assert.deepEqual([otraVez.status, otraVez.json.sin_cambios], [200, true], "16 · repetirlo no hace nada");
    assert.equal(sql(`select count(*) from public.interacciones_stand_eventos where interaccion_id = '${id}' and tipo = 'eliminacion' and rol = 'admin';`), "1", "16 · una sola auditoría");
    assert.equal(sql(`select eliminada_por_rol || '|' || eliminada_motivo from public.interacciones_stand where id = '${id}';`), "admin|carga de prueba");

    const det = await http(UNA.GET, "GET", `/api/admin/interacciones/${id}`, { token: admin, id });
    assert.equal(det.status, 404, "16 · el detalle ya no la muestra");
    for (const q of [`desde=${hoy}&hasta=${hoy}&incluir_anuladas=1&limite=100`, "estado=pendiente&limite=100"]) {
      const l = await http(RAIZ.GET, "GET", `/api/admin/interacciones?${q}`, { token: admin });
      assert.ok(!(l.json.items as Array<{ id: string }>).some((x) => x.id === id), `16 · no aparece en el listado (${q})`);
    }
    const ed = await http(UNA.PATCH, "PATCH", `/api/admin/interacciones/${id}`, { token: admin, id, body: { version: 3, cambios: { personas_grupo: 2 } } });
    assert.deepEqual([ed.status, ed.json.codigo], [404, "interaccion_eliminada"], "16 · no se edita");
    const vin = await http(TURNOS.POST, "POST", `/api/admin/interacciones/${id}/turnos`, { token: admin, id, body: { version: 3, turnos: [fx.E3.id] } });
    assert.deepEqual([vin.status, vin.json.codigo], [404, "interaccion_eliminada"], "16 · no se vuelve a vincular");
    const anc = await http(VINC.GET, "GET", `/api/admin/interacciones/turnos-vinculables?interaccion=${id}`, { token: admin });
    assert.equal(anc.status, 404, "16 · tampoco como ancla de vinculables");
    const libres = await http(VINC.GET, "GET", `/api/admin/interacciones/turnos-vinculables?ocurrida_en=${encodeURIComponent(A.toISOString())}`, { token: staff });
    const vinc = libres.json.turnos as Array<{ id: string; vinculacion: string }>;
    assert.deepEqual([fx.E1.id, fx.E2.id].map((t) => vinc.find((x) => x.id === t)?.vinculacion), ["libre", "libre"], "16 · sus turnos quedaron libres");
    const { data: turnosVivos } = await supabaseAdmin.from("turnos_stand").select("id:id::text, total, estado").in("id", [fx.E1.id, fx.E2.id]);
    assert.equal((turnosVivos ?? []).length, 2, "16 · los turnos siguen en el Turnero");

    const delAnulada = await borrar(admin, { version: 2 }, { id: inter(anulada).id });
    const delPendiente = await borrar(admin, { version: 1 }, { id: inter(pendiente).id });
    assert.deepEqual([delAnulada.status, delPendiente.status], [200, 200], "16 · también una anulada y una pendiente");
    const conAnuladas = await http(RAIZ.GET, "GET", `/api/admin/interacciones?desde=${hoy}&hasta=${hoy}&incluir_anuladas=1&limite=100`, { token: admin });
    assert.ok(!(conAnuladas.json.items as Array<{ id: string }>).some((x) => x.id === inter(anulada).id), "16 · \"ver anuladas\" no la devuelve");

    const despues = await metricasHoy();
    assert.deepEqual([despues.embudo.interacciones, despues.embudo.personas, despues.embudo.subieron],
      [antes.embudo.interacciones - 2, antes.embudo.personas - 5, antes.embudo.subieron - 2],
      "16 · deja de contar en el embudo (la anulada ya no contaba)");
    assert.deepEqual([despues.cobertura.turnos, despues.cobertura.vinculados], [antes.cobertura.turnos, antes.cobertura.vinculados - 2],
      "16 · cobertura: mismo denominador, numerador sin sus vínculos");

    const otraInter = await alta(staff, { resultado: "subio", personas_grupo: 2 }, [fx.E1.id]);
    assert.equal(otraInter.status, 201, "16 · el turno liberado se vincula a otra interacción");
  }

  // ── 17. El Turnero borra un turno mientras se libera su interacción (rutas reales) ──
  // Orden de bloqueo: turno → vínculo → interacción en los dos caminos. Una sesión
  // local retiene un bloqueo para forzar el cruce en cada orden; con el orden viejo
  // de las RPCs (interacción primero) los dos casos terminaban en deadlock 40P01.
  {
    const nuevoTurno = () => {
      const id = sql(`insert into public.turnos_stand (nombre, telefono, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad)
        values (${lit(`NOMBRE SECRETO ${MARCA}`)}, '000', ${lit(fechaSim(new Date(Date.now() - 20 * 60_000)))}, ${lit(horaSim(new Date(Date.now() - 20 * 60_000)))}, 2, 20, 4, 34000, 'qr', 'activo', 'v2_10')
        returning id;`).split("\n").pop()!;
      turnosFixture.push(id);
      return id;
    };
    const borrarTurno = (t: string) => http(TURNERO.DELETE, "DELETE", `/api/turnos-stand/${t}`, { token: admin, id: t });
    const eliminarInter = (i: string, version: number) =>
      http(ELIM.POST, "POST", `/api/admin/interacciones/${i}/eliminar`, { token: admin, id: i, body: { version } });
    const anularInter = (i: string, version: number) =>
      http(ANULAR.POST, "POST", `/api/admin/interacciones/${i}/anular`, { token: admin, id: i, body: { version } });

    for (const [nombre, liberar] of [["eliminar", eliminarInter], ["anular", anularInter]] as const) {
      // a · El Turnero llega primero al vínculo: termina bien; la ruta de
      //     Interacciones responde 409 sin escribir y el reintento funciona.
      {
        const t = nuevoTurno();
        const i = inter(await alta(staff, { resultado: "subio", personas_grupo: 2 }, [t])).id;
        const h = retener(`select 1 from public.interaccion_turnos where interaccion_id = '${i}' for update`, 2);
        await esperar(400);
        const turnero = borrarTurno(t);
        await esperar(300);
        const libera = liberar(i, 1);
        const [rt, rl, rh] = [await turnero, await libera, await h];
        assert.equal(rh.code, 0, rh.err);
        assert.deepEqual([rt.status, rt.json.ok], [200, true], `17 · ${nombre}: el Turnero borra el turno`);
        assert.deepEqual([rl.status, rl.json.codigo], [409, "version_desactualizada"], `17 · ${nombre}: conflicto controlado, no un 500`);
        const fila = sql(`select s.version || '|' || e.vinculo_estado || '|' || (s.anulada_en is null) || '|' || (s.eliminada_en is null)
          || '|' || (select count(*) from public.interacciones_stand_eventos where interaccion_id = s.id and tipo = 'turno_eliminado')
          || '|' || (select count(*) from public.turnos_stand where id = ${t})
          from public.interacciones_stand s join public.interacciones_stand_estado e on e.interaccion_id = s.id where s.id = '${i}';`);
        assert.equal(fila, "2|pendiente|true|true|1|0", `17 · ${nombre}: sin escrituras parciales y con la auditoría del turno borrado`);
        const otraVez = await liberar(i, 2);
        assert.equal(otraVez.status, 200, `17 · ${nombre}: el reintento con la versión nueva funciona`);
      }
      // b · Interacciones llega primero a los vínculos: las dos rutas terminan bien.
      {
        const t = nuevoTurno();
        const i = inter(await alta(staff, { resultado: "subio", personas_grupo: 2 }, [t])).id;
        const h = retener(`select 1 from public.interacciones_stand where id = '${i}' for update`, 2);
        await esperar(400);
        const libera = liberar(i, 1);
        await esperar(300);
        const turnero = borrarTurno(t);
        const [rl, rt, rh] = [await libera, await turnero, await h];
        assert.equal(rh.code, 0, rh.err);
        assert.equal(rl.status, 200, `17 · ${nombre}: Interacciones primero → aplicada`);
        assert.deepEqual([rt.status, rt.json.ok], [200, true], `17 · ${nombre}: y el Turnero borra igual (esperó, no abortó)`);
        const fila = sql(`select (select count(*) from public.interaccion_turnos where interaccion_id = '${i}' or turno_stand_id = ${t})
          || '|' || (select count(*) from public.turnos_stand where id = ${t})
          || '|' || (select count(*) from public.interacciones_stand_eventos where interaccion_id = '${i}' and tipo in ('anulacion', 'eliminacion'));`);
        assert.equal(fila, "0|0|1", `17 · ${nombre}: ningún vínculo inválido, turno borrado y una sola auditoría`);
      }
    }
  }

  // ── 14. Nada ajeno cambió ────────────────────────────────────────────────
  assert.equal(huellaAjena(), huella0, "14 · turnos, reservas, históricos y Finanzas idénticos");

  console.log("interacciones.integration.ts OK — rutas reales contra el stack local: 401/403/origen, autoridad solo de la sesión, alta idempotente, vínculos atómicos, edición parcial con versión y liberación confirmada, atendió declarado, ventanas de Córdoba, pendiente vieja con tolerancia contra ocurrida_en, cierre solo admin, IDs bigint exactos, vinculables sin datos personales ni reservas/históricos, listados con cursor, módulo sin inicio, contrato de límites, pausa de altas que conserva el inicio, borrado solo admin que libera turnos y sale de listas y métricas, y Turnero ↔ anulación/borrado a la vez sin deadlock por las rutas reales.");
}

function limpiar() {
  try {
    const ids = [...interacciones].filter((x) => /^[0-9a-f-]{36}$/.test(x)).map((x) => `'${x}'`);
    const keys = claves.map((k) => `'${k}'`);
    const filtro = `(${ids.length ? `id in (${ids.join(",")}) or ` : ""}${keys.length ? `idempotency_key in (${keys.join(",")}) or ` : ""}observaciones = ${lit(MARCA)})`;
    sql(`
      create temp table zz_ids as select id from public.interacciones_stand where ${filtro};
      delete from public.interaccion_turnos where interaccion_id in (select id from zz_ids)
        ${turnosFixture.length ? `or turno_stand_id in (${turnosFixture.join(",")})` : ""};
      delete from public.interacciones_stand_eventos where interaccion_id in (select id from zz_ids);
      delete from public.interacciones_stand where id in (select id from zz_ids);
      ${turnosFixture.length ? `delete from public.turnos_stand where id in (${turnosFixture.join(",")});` : ""}
      delete from public.reservas where id = -939001;
      delete from public.turnos_historicos where hash_unico = ${lit(MARCA)};
      ${empleadoId ? `delete from public.empleados where id = '${empleadoId}';` : ""}
      update public.interacciones_config set inicio_registro = ${inicioPrevio ? `${lit(inicioPrevio)}::timestamptz` : "null"},
        altas_pausadas_en = ${pausaPrevia ? `${lit(pausaPrevia)}::timestamptz` : "null"} where id;`);
    const resto = sql(`select (select count(*) from public.interacciones_stand where observaciones = ${lit(MARCA)})
      + (select count(*) from public.turnos_stand where nombre like ${lit(`%${MARCA}%`)});`);
    assert.equal(resto, "0", "limpieza completa");
  } catch (e) {
    console.error("No se pudo limpiar del todo:", e);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(limpiar);
