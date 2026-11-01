// GUARDIÁN: esta suite escribe en la base (siembra su escenario). Si el destino no es una
// base de pruebas aislada, el proceso aborta acá. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

// Preparación de rutas · negocios importados para visitar (db/crm-rutas-preparacion.sql).
// Contra la instancia LOCAL, con un comercial y una zona propios (marca única):
//   · crm_empresa_importar crea el negocio con origen 'importacion', ID de investigación,
//     tramo, parada, notas y teléfono publicado (decisor «no sabe»); no crea visita,
//     oportunidad, tarea ni jornada;
//   · reejecutar el mismo ID devuelve 'ya_aplicado' sin cambiar nada;
//   · solo Administración importa;
//   · el comercial ve sus negocios de la zona en orden de recorrido, con tramo, parada y
//     notas, sin el ID interno de importación ni el responsable;
//   · la lista no se corta en 300.
// Limpia SOLO lo que sembró.
//
// Ejecutar: node scripts/pruebas/crm-local.mjs suite lib/crmRutasPreparacion.integration.ts

const MARCA = `zzrutas${Date.now().toString(36)}`;
const CONTENEDOR = process.env.SIM_TEST_CONTENEDOR_DB || "";
assert.match(CONTENEDOR, /^supabase_db_[a-z0-9-]+$/, "falta SIM_TEST_CONTENEDOR_DB (correr con scripts/pruebas/crm-local.mjs suite)");
{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const N_VOLUMEN = 320;

function limpiar() {
  sql(`delete from public.crm_auditoria where entidad_id in (select id from public.crm_empresas where origen_ref like ${lit(MARCA + "%")})
         or entidad_id in (select c.id from public.crm_contactos c join public.crm_empresas e on e.id = c.empresa_id where e.origen_ref like ${lit(MARCA + "%")})
         or entidad_id in (select id from public.crm_zonas where nombre = ${lit(MARCA)});
    delete from public.crm_contactos where empresa_id in (select id from public.crm_empresas where origen_ref like ${lit(MARCA + "%")});
    delete from public.crm_empresas where origen_ref like ${lit(MARCA + "%")};
    delete from public.crm_zonas where nombre = ${lit(MARCA)};
    delete from public.crm_usuarios where usuario = ${lit(MARCA)};`);
}

const importar = (ref: string, datos: Record<string, unknown>, contactos: unknown[] | null, rol = "'admin'", usuario = "null") =>
  JSON.parse(sql(`select public.crm_empresa_importar(${lit(MARCA)}, ${lit(ref)}, ${lit(JSON.stringify(datos))}::jsonb,
    ${contactos ? `${lit(JSON.stringify(contactos))}::jsonb` : "null"}, ${rol}, ${usuario})::text;`));

async function main() {
  limpiar();
  const S = await import("@/lib/crmB1Server");
  // Hash con formato válido e inutilizable: el usuario de prueba nunca ingresa.
  const hash = `scrypt$15$8$1$${randomBytes(16).toString("base64url").slice(0, 22)}$${randomBytes(32).toString("base64url").slice(0, 43)}`;
  const usuarioId = sql(`insert into public.crm_usuarios (usuario, nombre, password_hash) values (${lit(MARCA)}, 'Comercial de prueba', ${lit(hash)}) returning id;`);
  const zonaId = JSON.parse(sql(`select public.crm_catalogo_guardar('zona', null, null, jsonb_build_object('nombre', ${lit(MARCA)}), 'admin', null)::text;`)).id as string;
  const base = { zona_id: zonaId, responsable_id: usuarioId, prioridad: "A" };

  const ids: Record<string, string> = {};
  for (const [n, orden] of [["c", 3], ["a", 1], ["b", 2]] as const) {
    const r = importar(`${MARCA}-${n}`, {
      ...base, nombre_comercial: `${MARCA} ${n}`, direccion: `Calle de prueba ${orden}00`, rubro_detalle: "Rubro de la fuente",
      recorrido_tramo: "Tramo A — prueba", recorrido_orden: orden, notas_preparacion: `${MARCA}-${n} · Tramo A\n   Para la visita:  pedir gerencia.\n\nMapa: búsqueda`,
    }, n === "a" ? [{ telefono: "0351 555 0101", tiene_whatsapp: true, cargo: "Teléfono publicado (sin verificar)" }] : null);
    assert.equal(r.resultado, "ok", JSON.stringify(r));
    ids[n] = r.id;
  }
  const fila = sql(`select origen || '|' || origen_ref || '|' || recorrido_orden || '|' || version from public.crm_empresas where id = ${lit(ids.a)};`);
  assert.equal(fila, `importacion|${MARCA}-a|1|1`);
  assert.equal(sql(`select es_decisor || '|' || coalesce(nombre, '-') || '|' || tiene_whatsapp from public.crm_contactos where empresa_id = ${lit(ids.a)};`), "no_sabe|-|true");

  // Reejecución: mismo ID → ya aplicado, sin cambios (aunque lleguen otros datos).
  const otra = importar(`${MARCA}-a`, { ...base, nombre_comercial: "otro nombre" }, [{ telefono: "0351 555 0199" }]);
  assert.deepEqual(otra, { resultado: "ya_aplicado", id: ids.a });
  assert.equal(sql(`select nombre_comercial || '|' || version from public.crm_empresas where id = ${lit(ids.a)};`), `${MARCA} a|1`);
  assert.equal(sql(`select count(*) from public.crm_contactos where empresa_id = ${lit(ids.a)};`), "1");

  // Solo Administración.
  assert.throws(() => importar(`${MARCA}-x`, { nombre_comercial: "x" }, null, "'comercial'", lit(usuarioId)), /no_autorizado/);

  // Sin actividad comercial generada.
  const lista = Object.values(ids).map(lit).join(",");
  assert.equal(sql(`select (select count(*) from public.crm_visitas where empresa_id in (${lista})) + (select count(*) from public.crm_oportunidades where empresa_id in (${lista}))
    + (select count(*) from public.crm_tareas where empresa_id in (${lista}));`), "0");

  // Vista del comercial: su zona en orden de recorrido, con preparación y sin datos de Administración.
  const comercial = { rol: "comercial" as const, usuarioId };
  const suyos = await S.listarEmpresas(comercial, { zona: zonaId });
  assert.deepEqual(suyos.map((e) => e.recorrido_orden), [1, 2, 3]);
  assert.equal(suyos[0].recorrido_tramo, "Tramo A — prueba");
  assert.match(suyos[0].notas_preparacion ?? "", /Para la visita/);
  assert.equal(suyos[0].estado, "por_visitar");
  for (const e of suyos) {
    assert.equal(e.origen_ref, undefined);
    assert.equal(e.responsable, undefined);
    assert.equal(e.origen, undefined);
  }
  const ficha = await S.fichaEmpresa(comercial, ids.a);
  assert.ok(ficha);
  assert.match(ficha!.empresa.notas_preparacion ?? "", new RegExp(`${MARCA}-a`));
  // Los saltos de línea se conservan; espacios y líneas vacías se normalizan.
  assert.equal(ficha!.empresa.notas_preparacion, `${MARCA}-a · Tramo A\nPara la visita: pedir gerencia.\nMapa: búsqueda`);
  assert.equal(ficha!.contactos.length, 1);
  const admin = await S.listarEmpresas({ rol: "admin" }, { zona: zonaId });
  assert.deepEqual(admin.map((e) => e.origen_ref), [`${MARCA}-a`, `${MARCA}-b`, `${MARCA}-c`]);

  // Sin tope de 300: siembra más filas en la zona y el comercial las recibe todas.
  for (let i = 1; i <= N_VOLUMEN; i++) {
    importar(`${MARCA}-v${i}`, { ...base, nombre_comercial: `${MARCA} v${String(i).padStart(4, "0")}`, recorrido_orden: 100 + i }, null);
  }
  const todos = await S.listarEmpresas(comercial, { zona: zonaId });
  assert.equal(todos.length, 3 + N_VOLUMEN);
  assert.deepEqual(todos.slice(0, 4).map((e) => e.recorrido_orden), [1, 2, 3, 101]);
  console.log(`OK crmRutasPreparacion · importación, reejecución, permisos, vista comercial y ${todos.length} filas sin tope`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { try { limpiar(); } catch (e) { console.error("limpieza:", e); } });
