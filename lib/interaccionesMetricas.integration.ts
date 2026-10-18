// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// Interacciones · métricas (Bloque 4) contra el stack LOCAL, con un escenario
// determinista en marzo de 2025 (lejos de cualquier dato de demo):
//
//   lun 10/03  10 "miró" 11:00 · 5 "preguntó" 12:00 (precio×2, tiempo, sin motivo×2) ·
//              3 "se subió" 21:59: S1 con 2 turnos pagos (2 personas → 4 participaciones),
//              S2 con un turno gratis, S3 pendiente
//   mar 11/03  "se subió" 09:30 cerrada sin turno · "se subió" 15:00 ANULADA (no cuenta) ·
//              "miró" 23:30 (UTC ya es 12/03) · "se subió" 23:50 con un turno del 12/03 00:05
//   mié 12/03  "se subió" con turno BORRADO después en el Turnero (vuelve a pendiente) ·
//              "se subió" con turno CORREGIDO a gratis en el Turnero · turnos sin interacción
//              (uno pago y uno con total y método contradictorios)
//   jue 13/03  230 "miró" (para que el período tenga más filas que una página)
//
// Inicio del registro LOCAL para esta suite: 2025-03-10 00:00 (Córdoba).
// Con INTERACCIONES_DEJAR_FIXTURES=1 los datos quedan para mirar el dashboard;
// con INTERACCIONES_SOLO_LIMPIAR=1 solo se borran (y el inicio vuelve al local de demo).
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/interaccionesMetricas.integration.ts

const MARCA = "zzmetricas_b4";
const CONTENEDOR = "supabase_db_sim-web-pruebas";
const INICIO_DEMO_LOCAL = "2026-10-02 00:00";
{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}

function limpiar(inicio: string) {
  sql(`
    create temp table zz as select id from public.interacciones_stand where observaciones = '${MARCA}';
    delete from public.interaccion_turnos where interaccion_id in (select id from zz) or turno_stand_id between -960099 and -960001;
    delete from public.interacciones_stand_eventos where interaccion_id in (select id from zz);
    delete from public.interacciones_stand where id in (select id from zz);
    delete from public.turnos_stand where id between -960099 and -960001;
    delete from public.empleados where nombre_formal = '__TEST_EMP_${MARCA}';
    update public.interacciones_config set inicio_registro = timestamp '${inicio}' at time zone 'America/Argentina/Cordoba' where id;`);
}

const FIXTURES = `
update public.interacciones_config set inicio_registro = timestamp '2025-03-10 00:00' at time zone 'America/Argentina/Cordoba' where id;
insert into public.turnos_stand (id, nombre, telefono, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad, simuladores) values
  (-960001, 'NOMBRE SECRETO', '000', '2025-03-10', '21:40', 2, 20, 4, 34000, 'qr', 'activo', 'v2_10', '[]'),
  (-960002, 'NOMBRE SECRETO', '000', '2025-03-10', '21:45', 2, 20, 4, 34000, 'qr', 'activo', 'v2_10', '[]'),
  (-960003, 'NOMBRE SECRETO', '000', '2025-03-10', '21:50', 1, 10, 1, 0, 'gratis', 'activo', 'v2_10', '[]'),
  (-960004, 'NOMBRE SECRETO', '000', '2025-03-11', '14:50', 1, 10, 1, 10000, 'qr', 'activo', 'v2_10', '[]'),
  (-960005, 'NOMBRE SECRETO', '000', '2025-03-12', '00:05', 2, 10, 2, 20000, 'qr', 'activo', 'v2_10', '[]'),
  (-960006, 'NOMBRE SECRETO', '000', '2025-03-12', '18:00', 1, 10, 1, 10000, 'efectivo', 'activo', 'v2_10', '[]'),
  (-960007, 'NOMBRE SECRETO', '000', '2025-03-12', '18:30', 1, 10, 1, 5000, 'gratis', 'activo', 'v2_10', '[]'),
  (-960008, 'NOMBRE SECRETO', '000', '2025-03-12', '12:50', 2, 20, 4, 34000, 'qr', 'activo', 'v2_10', '[]'),
  (-960009, 'NOMBRE SECRETO', '000', '2025-03-12', '13:55', 1, 10, 1, 20000, 'qr', 'activo', 'v2_10', '[]');
insert into public.empleados (nombre_formal) values ('__TEST_EMP_${MARCA}');
do $$
declare
  e uuid := (select id from public.empleados where nombre_formal = '__TEST_EMP_${MARCA}');
  j jsonb;
  i int;
  r text;
  f jsonb;
begin
  for i in 1..10 loop
    f := jsonb_build_object('resultado', 'miro', 'personas_grupo', 2, 'ocurrida_en', '2025-03-10T14:00:00Z', 'observaciones', '${MARCA}');
    if i <= 4 then f := f || '{"rango_etario":"18_24"}'; end if;
    if i <= 3 then f := f || '{"conocia_sim":"no_sabe"}'; elsif i <= 5 then f := f || '{"conocia_sim":"no"}'; end if;
    if i = 1 then f := f || '{"hombres":1,"mujeres":1}'; end if;
    perform public.interaccion_registrar(gen_random_uuid(), f, null, 'admin');
  end loop;
  for i in 1..5 loop
    f := jsonb_build_object('resultado', 'pregunto', 'personas_grupo', 1, 'ocurrida_en', '2025-03-10T15:00:00Z', 'observaciones', '${MARCA}');
    if i <= 2 then f := f || '{"motivo":"precio"}' || jsonb_build_object('atendio_empleado_id', e); elsif i = 3 then f := f || '{"motivo":"tiempo"}'; end if;
    perform public.interaccion_registrar(gen_random_uuid(), f, null, 'admin');
  end loop;
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2,"ocurrida_en":"2025-03-11T00:59:00Z","observaciones":"${MARCA}"}', '{-960001,-960002}', 'admin');
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":1,"ocurrida_en":"2025-03-11T00:59:00Z","observaciones":"${MARCA}"}', '{-960003}', 'admin');
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2,"ocurrida_en":"2025-03-11T00:59:00Z","observaciones":"${MARCA}"}', null, 'admin');
  -- Martes: cerrada, anulada, miró a las 23:30 y subida que cruza la medianoche.
  j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":3,"ocurrida_en":"2025-03-11T12:30:00Z","observaciones":"${MARCA}"}', null, 'admin');
  perform public.interaccion_cerrar_sin_vinculo((j->'interaccion'->>'id')::uuid, 1, 'sin_turno_en_turnero', null, 'admin');
  j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":4,"ocurrida_en":"2025-03-11T18:00:00Z","observaciones":"${MARCA}"}', '{-960004}', 'admin');
  perform public.interaccion_anular((j->'interaccion'->>'id')::uuid, 1, 'prueba', 'admin');
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"miro","personas_grupo":1,"conocia_sim":"si","ocurrida_en":"2025-03-12T02:30:00Z","observaciones":"${MARCA}"}', null, 'admin');
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2,"ocurrida_en":"2025-03-12T02:50:00Z","observaciones":"${MARCA}"}', '{-960005}', 'admin');
  -- Miércoles: turno que se borra y turno que se corrige en el Turnero.
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2,"ocurrida_en":"2025-03-12T16:00:00Z","observaciones":"${MARCA}"}', '{-960008}', 'admin');
  perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":1,"ocurrida_en":"2025-03-12T17:00:00Z","observaciones":"${MARCA}"}', '{-960009}', 'admin');
  -- Jueves: 230 "miró".
  for i in 1..230 loop
    perform public.interaccion_registrar(gen_random_uuid(), '{"resultado":"miro","personas_grupo":1,"ocurrida_en":"2025-03-13T19:00:00Z","observaciones":"${MARCA}"}', null, 'admin');
  end loop;
end $$;
-- El Turnero borra un turno vinculado y corrige otro (no pasan por las RPCs del módulo).
delete from public.turnos_stand where id = -960008;
update public.turnos_stand set total = 0, metodo_pago = 'gratis' where id = -960009;
update public.empleados set activo = false where nombre_formal = '__TEST_EMP_${MARCA}';`;

async function main() {
  if (process.env.INTERACCIONES_SOLO_LIMPIAR === "1") {
    limpiar(INICIO_DEMO_LOCAL);
    console.log("Fixtures de métricas borrados; inicio local de demo restaurado.");
    return;
  }
  const inicioPrevio = sql("select coalesce(to_char(inicio_registro at time zone 'America/Argentina/Cordoba', 'YYYY-MM-DD HH24:MI'), '') from public.interacciones_config where id;") || INICIO_DEMO_LOCAL;
  limpiar(inicioPrevio);
  let dejar = false;
  try {
    sql(FIXTURES);
    const { metricas } = await import("@/lib/interaccionesMetricasServer");
    const ahora = new Date("2026-10-18T15:00:00Z");
    const semana = { desde: "2025-03-10", hasta: "2025-03-16", comparar: null, filtros: {} };

    // ── 1. Carga completa, paginada y verificada ─────────────────────────
    const chica = await metricas(semana, ahora, { tamPagina: 50 });
    const grande = await metricas(semana, ahora);
    assert.ok(chica.ok && grande.ok);
    const ci = chica.valor.actual.carga.interacciones!;
    assert.deepEqual([ci.filas, ci.esperadas, ci.paginas, ci.consistente], [253, 253, 6, true], "1 · 253 filas en 6 páginas de 50, sin truncar");
    assert.deepEqual(chica.valor.actual.metricas, grande.valor.actual.metricas, "1 · mismo resultado con cualquier tamaño de página");
    assert.equal(grande.valor.actual.carga.interacciones!.paginas, 1);

    // ── 2. Embudo, unidades y vínculos (esperados a mano) ────────────────
    const m = grande.valor.actual.metricas;
    assert.deepEqual(m.embudo.exclusivos, { miro: 241, pregunto: 5, subio: 7 }, "2 · exclusivos (la anulada no cuenta)");
    assert.deepEqual([m.embudo.interacciones, m.embudo.miraron, m.embudo.preguntaron, m.embudo.subieron], [253, 253, 12, 7]);
    assert.deepEqual([m.embudo.tasas.miro_pregunto.num, m.embudo.tasas.miro_pregunto.den, m.embudo.tasas.pregunto_subio.num, m.embudo.tasas.pregunto_subio.den, m.embudo.tasas.miro_subio.num, m.embudo.tasas.miro_subio.den], [12, 253, 7, 12, 7, 253]);
    assert.equal(m.embudo.personas, 269, "2 · personas observadas");
    assert.deepEqual(m.vinculo, {
      subidas_declaradas: 7, con_turno: 4, con_turno_pago: 2, turno_no_activo: 0, pendientes: 2, cerradas_sin_turno: 1,
      con_pago_contradictorio: 0, turnos_vinculados: 5, participaciones: 8,
    }, "2 · borrado = pendiente; corregido a gratis = sin venta; participaciones ≠ personas");
    assert.deepEqual([m.motivos.base, m.motivos.con_motivo, m.motivos.sin_motivo], [5, 3, 2]);
    assert.deepEqual(m.motivos.valores.filter((x) => x.n > 0).map((x) => [x.motivo, x.n, x.pct.den]), [["precio", 2, 3], ["tiempo", 1, 3]]);
    assert.deepEqual(m.franjas.map((f) => [f.clave, f.embudo.interacciones]), [
      ["10-12", 10], ["12-14", 6], ["14-16", 1], ["16-18", 230], ["18-20", 0], ["20-22", 3], ["otros", 3],
    ], "2 · franjas sin duplicar, 21:59 en 20–22 y 23:30/23:50/09:30 en otros");
    assert.deepEqual(m.dias_semana.map((d) => d.embudo.interacciones), [18, 3, 2, 230, 0, 0, 0], "2 · 23:30 del martes es martes");
    assert.deepEqual(Object.fromEntries(m.perfil.conocia_sim.valores.map((x) => [x.valor, x.n])), { si: 1, no: 2, no_sabe: 3 });
    assert.equal(m.perfil.conocia_sim.sin_dato, 247);
    assert.deepEqual([m.perfil.genero.registros_con_desglose, m.perfil.genero.hombres, m.perfil.genero.mujeres, m.perfil.genero.cobertura.den], [1, 1, 1, 269]);
    const emp = m.atendio.find((a) => a.empleado_id !== null)!;
    assert.deepEqual([emp.nombre, emp.activo, emp.embudo.interacciones, emp.embudo.preguntaron], [`__TEST_EMP_${MARCA}`, false, 2, 2], "2 · atribución histórica a un inactivo");
    assert.deepEqual(m.serie.map((s) => [s.fecha, s.interacciones, s.preguntaron, s.subieron]), [
      ["2025-03-10", 18, 8, 3], ["2025-03-11", 3, 2, 2], ["2025-03-12", 2, 2, 2], ["2025-03-13", 230, 0, 0],
      ["2025-03-14", 0, 0, 0], ["2025-03-15", 0, 0, 0], ["2025-03-16", 0, 0, 0],
    ]);

    // ── 3. Cobertura por fecha del turno, independiente de filtros ───────
    const c = grande.valor.actual.cobertura;
    assert.deepEqual([c.turnos, c.vinculados, c.pagos.total, c.pagos.vinculados, c.gratis.total, c.gratis.vinculados, c.contradictorios.total, c.contradictorios.vinculados],
      [8, 5, 6, 3, 2, 2, 1, 0], "3 · el borrado no es elegible; el corregido cuenta como gratis");
    const filtrada = await metricas({ ...semana, filtros: { rango_etario: "18_24" } }, ahora);
    assert.ok(filtrada.ok);
    assert.equal(filtrada.valor.actual.metricas.embudo.interacciones, 4, "3 · el filtro aplica a las interacciones…");
    assert.deepEqual(filtrada.valor.actual.cobertura, c, "3 · …y NO a la cobertura general");
    const miercoles = await metricas({ desde: "2025-03-12", hasta: "2025-03-12", comparar: null, filtros: {} }, ahora);
    assert.ok(miercoles.ok);
    assert.deepEqual([miercoles.valor.actual.cobertura.turnos, miercoles.valor.actual.cobertura.vinculados], [4, 2], "3 · el turno de las 00:05 cuenta aunque la interacción sea del martes");

    // ── 4. Períodos frente al inicio y comparación ───────────────────────
    const parcial = await metricas({ desde: "2025-03-01", hasta: "2025-03-16", comparar: null, filtros: {} }, ahora);
    assert.ok(parcial.ok);
    assert.deepEqual([parcial.valor.actual.periodo.estado, parcial.valor.actual.periodo.cubierto], ["parcial", { desde: "2025-03-10", hasta: "2025-03-16", dias: 7 }]);
    assert.equal(parcial.valor.actual.metricas.embudo.interacciones, 253);
    const conComp = await metricas({ ...semana, comparar: { desde: "2025-03-03", hasta: "2025-03-09" } }, ahora);
    assert.ok(conComp.ok && conComp.valor.comparacion);
    const comp = conComp.valor.comparacion!;
    assert.equal(comp.periodo.estado, "sin_registro", "4 · antes del inicio: sin datos de registro");
    assert.equal(comp.metricas.embudo.interacciones, 0);
    assert.deepEqual([comp.deltas!.interacciones.variacion, comp.deltas!.miro_subio.diferencia_pp, comp.deltas!.mismos_dias], [null, null, false], "4 · Sin base y Sin datos");

    // ── 5. La ruta real: solo admin, sin datos personales ────────────────
    process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
    let cookie: string | undefined;
    const rutaHeaders = require.resolve("next/headers");
    require.cache[rutaHeaders] = {
      id: rutaHeaders, filename: rutaHeaders, loaded: true,
      exports: { cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }) },
    } as unknown as NodeJS.Module;
    const { createSessionToken } = await import("@/lib/adminSession");
    const RUTA = await import("@/app/api/admin/interacciones/metricas/route");
    const pedir = async (token: string | undefined, q: string) => {
      cookie = token;
      const res = await RUTA.GET(new Request(`https://simexperience.com.ar/api/admin/interacciones/metricas?${q}`));
      return { status: res.status, json: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
    };
    const q = "desde=2025-03-10&hasta=2025-03-16&comp_desde=2025-03-03&comp_hasta=2025-03-09";
    assert.equal((await pedir(undefined, q)).status, 401, "5 · sin sesión");
    assert.equal((await pedir(await createSessionToken("staff"), q)).status, 403, "5 · staff no obtiene métricas");
    const r = await pedir(await createSessionToken("admin"), q);
    assert.equal(r.status, 200);
    assert.match(r.cache ?? "", /no-store/);
    const actual = r.json.actual as { metricas: { embudo: { interacciones: number; subieron: number } }; cobertura: { turnos: number } };
    assert.deepEqual([actual.metricas.embudo.interacciones, actual.metricas.embudo.subieron, actual.cobertura.turnos], [253, 7, 8]);
    assert.ok(!JSON.stringify(r.json).includes("SECRETO"), "5 · sin nombres ni teléfonos");
    const malo = await pedir(await createSessionToken("admin"), "desde=2025-03-16&hasta=2025-03-10");
    assert.deepEqual([malo.status, malo.json.codigo], [400, "campo_invalido"]);

    dejar = process.env.INTERACCIONES_DEJAR_FIXTURES === "1";
    console.log("interaccionesMetricas.integration.ts OK — 253 filas paginadas sin truncar (6×50 = 1×1000), embudo 253/12/7, personas 269, vínculos (pendiente por turno borrado, gratis por turno corregido), participaciones 8, franjas y días de Córdoba, cobertura 5/8 por fecha del turno e independiente de filtros, período parcial y comparación sin registro, ruta solo admin y sin datos personales.");
  } finally {
    if (dejar) console.log("Fixtures de métricas CONSERVADOS (INTERACCIONES_DEJAR_FIXTURES=1). Borrarlos: INTERACCIONES_SOLO_LIMPIAR=1.");
    else limpiar(inicioPrevio);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
