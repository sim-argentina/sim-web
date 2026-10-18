// Interacciones · migración de edades a selección múltiple, contra el stack LOCAL.
//
// Reproduce el estado de Producción ANTES de la migración y la aplica encima,
// dentro de UNA transacción que termina en ROLLBACK (no deja nada):
//   1. vuelve el esquema local al de Producción: sin rangos_etarios ni tipo_grupo
//      y con las funciones de db/interacciones-bloque1.sql del commit publicado
//      (git show <ref>:db/interacciones-bloque1.sql; por defecto 5a7c52d);
//   2. registra filas con las RPCs ANTERIORES (un rango, sin rango, anulada,
//      borrada, con turno, editada, con los motivos de siempre);
//   3. aplica el db/interacciones-bloque1.sql nuevo (la migración incremental);
//   4. comprueba el backfill (rango único → conjunto de uno; vacío sigue vacío) y
//      que identidad, resultado, tiempos, versión, vínculos, anulación, borrado y
//      auditoría quedaron idénticos;
//   5. reintenta el alta de la pantalla anterior con la misma clave: devuelve la
//      fila original (misma huella), también en la forma nueva; la forma anterior
//      edita un rango y no puede truncar varios;
//   6. vuelve a aplicar el SQL nuevo: no cambia nada (idempotente).
//
// Ejecutar: node scripts/pruebas/interacciones-migracion-rangos.mjs [ref]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const REF = process.argv[2] ?? "5a7c52d";
const MARCA = "zzmigracion_rangos";

const anterior = execFileSync("git", ["show", `${REF}:db/interacciones-bloque1.sql`], { encoding: "utf8", maxBuffer: 1 << 26 });
const nuevo = readFileSync("db/interacciones-bloque1.sql", "utf8");
if (anterior.includes("rangos_etarios")) throw new Error(`${REF} ya tiene rangos_etarios: no es la versión anterior`);

// Solo el contenedor local (nunca una URL remota).
const destino = execFileSync("docker", ["inspect", "-f", "{{.Name}}", CONTENEDOR], { encoding: "utf8" }).trim();
if (destino !== `/${CONTENEDOR}`) throw new Error("No está el stack local de pruebas");

const K = { uno: randomUUID(), vacio: randomUUID(), anulada: randomUUID(), borrada: randomUUID(), turno: randomUUID(), editada: randomUUID() };
const T = -930501;
const PAYLOAD_UNO = `{"resultado":"pregunto","personas_grupo":3,"hombres":2,"mujeres":1,"rango_etario":"18_24","conocia_sim":"no","motivo":"acompanantes","observaciones":"${MARCA}"}`;

// Columnas que la migración NO puede tocar (todo menos las dos nuevas).
const FOTO = `select string_agg(idempotency_key::text || '=' || md5((to_jsonb(s) - 'rangos_etarios' - 'tipo_grupo')::text), ',' order by idempotency_key)
  from public.interacciones_stand s where observaciones = '${MARCA}'`;
const EVENTOS = `select string_agg(md5(to_jsonb(e)::text), ',' order by e.id) from public.interacciones_stand_eventos e
  join public.interacciones_stand s on s.id = e.interaccion_id where s.observaciones = '${MARCA}'`;
const VINCULOS = `select string_agg(md5(to_jsonb(v)::text), ',' order by v.turno_stand_id) from public.interaccion_turnos v
  join public.interacciones_stand s on s.id = v.interaccion_id where s.observaciones = '${MARCA}'`;
const sal = (etiqueta, q) => `select '${etiqueta}=' || coalesce((${q}), '');`;

const guion = `
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
-- 1 · Esquema como en Producción antes de la migración.
alter table public.interacciones_stand drop column if exists rangos_etarios cascade;
alter table public.interacciones_stand drop column if exists tipo_grupo cascade;
alter table public.interacciones_stand drop constraint if exists interacciones_stand_rango_sincronizado_chk;
drop function if exists public.interacciones_rangos_canonicos(text[]);
alter table public.interacciones_stand drop constraint if exists interacciones_stand_motivo_chk;
alter table public.interacciones_stand add constraint interacciones_stand_motivo_chk check (
  motivo is null or (resultado <> 'subio'
    and motivo in ('precio', 'tiempo', 'espera', 'vuelve_despues', 'no_interesa', 'requisitos', 'acompanantes', 'otro')));
${anterior}
select 'esquema_anterior=' || (select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'interacciones_stand' and column_name in ('rangos_etarios', 'tipo_grupo'));
update public.interacciones_config set inicio_registro = now() - interval '10 days', altas_pausadas_en = null where id;
insert into public.turnos_stand (id, nombre, telefono, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad, simuladores)
values (${T}, 'NOMBRE SECRETO', '000', (now() at time zone 'America/Argentina/Cordoba')::date, '10:00', 2, 10, 2, 20000, 'qr', 'activo', 'v2_10', '[]');

-- 2 · Filas con las RPCs anteriores.
select public.interaccion_registrar('${K.uno}', '${PAYLOAD_UNO}', null, 'staff') is not null;
select public.interaccion_registrar('${K.vacio}', '{"resultado":"miro","personas_grupo":1,"motivo":"otro","observaciones":"${MARCA}"}', null, 'staff') is not null;
select public.interaccion_registrar('${K.anulada}', '{"resultado":"pregunto","personas_grupo":2,"rango_etario":"50_mas","observaciones":"${MARCA}"}', null, 'staff') is not null;
select public.interaccion_anular((select id from public.interacciones_stand where idempotency_key = '${K.anulada}'), 1, 'duplicada', 'staff') is not null;
select public.interaccion_registrar('${K.borrada}', '{"resultado":"miro","personas_grupo":2,"rango_etario":"35_49","observaciones":"${MARCA}"}', null, 'staff') is not null;
select public.interaccion_eliminar((select id from public.interacciones_stand where idempotency_key = '${K.borrada}'), 1, 'prueba', 'admin') is not null;
select public.interaccion_registrar('${K.turno}', '{"resultado":"subio","personas_grupo":2,"rango_etario":"25_34","iniciador":"cliente","observaciones":"${MARCA}"}', '{${T}}', 'staff') is not null;
select public.interaccion_registrar('${K.editada}', '{"resultado":"pregunto","personas_grupo":2,"rango_etario":"14_17","observaciones":"${MARCA}"}', null, 'staff') is not null;
select public.interaccion_editar((select id from public.interacciones_stand where idempotency_key = '${K.editada}'), 1, '{"rango_etario":"menos_14","conocia_sim":"si"}', 'staff') is not null;

create temp table zz_antes as select * from public.interacciones_stand where observaciones = '${MARCA}';
${sal("foto_antes", FOTO)}
${sal("eventos_antes", EVENTOS)}
${sal("vinculos_antes", VINCULOS)}

-- 3 · Migración incremental (el SQL fuente nuevo, tal cual).
${nuevo}

-- 4 · Backfill y preservación.
${sal("foto_despues", FOTO)}
${sal("eventos_despues", EVENTOS)}
${sal("vinculos_despues", VINCULOS)}
${sal("rangos", `select string_agg(idempotency_key::text || '=' || rangos_etarios::text || '/' || coalesce(rango_etario, '-') || '/' || coalesce(tipo_grupo, '-'), ',' order by idempotency_key) from public.interacciones_stand where observaciones = '${MARCA}'`)}
${sal("versiones_iguales", `select bool_and(s.version = a.version and s.actualizada_en is not distinct from a.actualizada_en and s.anulada_en is not distinct from a.anulada_en and s.eliminada_en is not distinct from a.eliminada_en)::text from public.interacciones_stand s join zz_antes a using (id)`)}
${sal("sin_backfill_pendiente", `select count(*)::text from public.interacciones_stand where rango_etario is not null and rangos_etarios = '{}'`)}

-- 5 · La pantalla anterior después de migrar.
${sal("replay_anterior", `select (r ->> 'repetida') || '/' || ((r -> 'interaccion' ->> 'id') = (select id::text from zz_antes where idempotency_key = '${K.uno}'))::text from (select public.interaccion_registrar('${K.uno}', '${PAYLOAD_UNO}', null, 'staff') as r) x`)}
${sal("replay_nuevo", `select (r ->> 'repetida') from (select public.interaccion_registrar('${K.uno}', '${PAYLOAD_UNO.replace('"rango_etario":"18_24"', '"rangos_etarios":["18_24"],"tipo_grupo":null')}', null, 'staff') as r) x`)}
${sal("edita_un_rango", `select (r -> 'interaccion' ->> 'rango_etario') from (select public.interaccion_editar((select id from zz_antes where idempotency_key = '${K.turno}'), 1, '{"rango_etario":"18_24"}', 'staff') as r) x`)}
select public.interaccion_editar((select id from zz_antes where idempotency_key = '${K.editada}'), 2, '{"rangos_etarios":["menos_14","50_mas"]}', 'staff') is not null;
do $$ begin
  perform public.interaccion_editar((select id from zz_antes where idempotency_key = '${K.editada}'), 3, '{"rango_etario":"18_24"}', 'staff');
  perform set_config('zz.trunca', 'no_fallo', false);
exception when others then perform set_config('zz.trunca', sqlerrm, false); end $$;
select 'no_trunca=' || current_setting('zz.trunca') || '/' || (select rangos_etarios::text from public.interacciones_stand where idempotency_key = '${K.editada}');

-- 6 · Re-aplicar no cambia nada.
create temp table zz_medio as select id, md5(to_jsonb(s)::text) as h from public.interacciones_stand s where observaciones = '${MARCA}';
${nuevo}
${sal("reaplicar_igual", `select bool_and(md5(to_jsonb(s)::text) = m.h)::text from public.interacciones_stand s join zz_medio m using (id)`)}
rollback;
`;

let out;
try {
  out = execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-f", "-"],
    { input: guion, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["pipe", "pipe", "pipe"] });
} catch (e) {
  console.error(String(e.stderr ?? e.message).split("\n").filter((l) => /ERROR|error|LINE|DETAIL|CONTEXT/.test(l)).slice(0, 15).join("\n"));
  process.exit(1);
}
const v = Object.fromEntries(out.split("\n").filter((l) => /^[a-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

let fallas = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallas++;
  console.log(`${ok ? "  ok  " : "  FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};
const rangos = Object.fromEntries((v.rangos ?? "").split(",").map((x) => x.split("=")));
comprobar("esquema local vuelto al de Producción (sin columnas nuevas)", v.esquema_anterior === "0", v.esquema_anterior);
comprobar("6 filas creadas con las RPCs anteriores", (v.foto_antes ?? "").split(",").length === 6, `${(v.foto_antes ?? "").split(",").length}`);
comprobar("rango único → conjunto de uno (también anulada y borrada); vacío sigue vacío; tipo sin dato",
  rangos[K.uno] === "{18_24}/18_24/-" && rangos[K.vacio] === "{}/-/-" && rangos[K.anulada] === "{50_mas}/50_mas/-"
  && rangos[K.borrada] === "{35_49}/35_49/-" && rangos[K.turno] === "{25_34}/25_34/-" && rangos[K.editada] === "{menos_14}/menos_14/-",
  v.rangos);
comprobar("nada más cambió en las filas (identidad, resultado, tiempos, versión, anulación, borrado)",
  v.foto_antes === v.foto_despues && v.versiones_iguales === "true");
comprobar("auditoría y vínculos idénticos (la migración no generó eventos)", v.eventos_antes === v.eventos_despues && v.vinculos_antes === v.vinculos_despues && v.vinculos_antes !== "");
comprobar("no queda ningún rango sin migrar", v.sin_backfill_pendiente === "0", v.sin_backfill_pendiente);
comprobar("reintento de la pantalla anterior con la misma clave = la fila original", v.replay_anterior === "true/true", v.replay_anterior);
comprobar("la misma carga en la forma nueva tiene la misma huella", v.replay_nuevo === "true", v.replay_nuevo);
comprobar("la pantalla anterior edita una fila de un rango", v.edita_un_rango === "18_24", v.edita_un_rango);
comprobar("la pantalla anterior no trunca varios rangos (409)", v.no_trunca === "cliente_desactualizado/{menos_14,50_mas}", v.no_trunca);
comprobar("re-aplicar el SQL nuevo no cambia ninguna fila", v.reaplicar_igual === "true", v.reaplicar_igual);
console.log(`\n${fallas === 0 ? "OK" : `${fallas} FALLA(S)`} — migración ${REF} → actual en una transacción revertida (sin rastros).`);
process.exit(fallas ? 1 : 0);
