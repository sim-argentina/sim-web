// Datos de DEMOSTRACIÓN de Interacciones en el Supabase LOCAL (nunca Producción).
//
//   node scripts/pruebas/interacciones-demo-local.mjs            # carga (reemplaza la demo anterior)
//   node scripts/pruebas/interacciones-demo-local.mjs --limpiar  # solo borra la demo
//
// Carga, con la marca "DEMO LOCAL" (sin nombres ni teléfonos reales):
//   · inicio del registro LOCAL fijo: 2026-10-01 00:00 (Córdoba), solo si no había uno.
//     Es un valor de pruebas; NO define el lanzamiento de Producción.
//   · turnos del Turnero de hoy alrededor de la hora actual (ids negativos -950xxx),
//     uno gratis y uno con total y método contradictorios;
//   · una "Se subió" pendiente cargada hace 49 h y su turno de ese momento;
//   · unas pocas interacciones de hoy, creadas por las RPCs reales.
// Usa psql DENTRO del contenedor local y el mismo guardián que las suites.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { abortar, entornoDePruebas } from "./entorno.mjs";

const e = entornoDePruebas();
if (!e.ok) abortar(e);
const MARCA = "DEMO LOCAL";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_sim-web-pruebas", "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
  { input: q, encoding: "utf8" }).trim();

function limpiar() {
  sql(`
    create temp table zz as select id from public.interacciones_stand where observaciones = '${MARCA}';
    delete from public.interaccion_turnos where interaccion_id in (select id from zz) or turno_stand_id between -950999 and -950001;
    delete from public.interacciones_stand_eventos where interaccion_id in (select id from zz);
    delete from public.interacciones_stand where id in (select id from zz);
    delete from public.turnos_stand where id between -950999 and -950001;`);
}

limpiar();
if (process.argv.includes("--limpiar")) {
  console.log("Demo local borrada.");
  process.exit(0);
}

sql(`update public.interacciones_config
       set inicio_registro = timestamp '2026-10-01 00:00' at time zone 'America/Argentina/Cordoba'
     where id and inicio_registro is null;`);

// Turnos de hoy (y uno de hace 49 h), con fecha y hora de Córdoba calculadas en la base.
const turnos = [
  [-950001, "10 minutes", 2, 20, 34000, "qr"],
  [-950002, "35 minutes", 3, 20, 51000, "efectivo"],
  [-950003, "70 minutes", 1, 10, 10000, "debito"],
  [-950004, "100 minutes", 2, 10, 0, "gratis"],
  [-950005, "130 minutes", 1, 10, 5000, "gratis"],
  [-950006, "190 minutes", 4, 30, 92000, "qr"],
  [-950007, "49 hours 20 minutes", 2, 20, 34000, "qr"],
];
sql(turnos.map(([id, hace, p, m, total, metodo]) => `
  insert into public.turnos_stand (id, nombre, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad, simuladores)
  select ${id}, '${MARCA}', (t at time zone 'America/Argentina/Cordoba')::date, to_char(t at time zone 'America/Argentina/Cordoba', 'HH24:MI'),
         ${p}, ${m}, ${p * (m / 10)}, ${total}, '${metodo}', 'activo', 'v2_10', '[]'::jsonb
    from (select now() - interval '${hace}' as t) s;`).join("\n"));

// Pendiente vieja (registrada hace 49 h: staff ya no la puede editar, sí vincular).
sql(`insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_en, registrada_por_rol, resultado, personas_grupo, observaciones)
     values ('${randomUUID()}', md5('demo-vieja'), now() - interval '49 hours', now() - interval '49 hours', 'staff', 'subio', 2, '${MARCA}');`);

// Interacciones de hoy por las RPCs reales.
const alta = (datos, turnosIds = null, rol = "staff") => sql(`select public.interaccion_registrar('${randomUUID()}', $j$${JSON.stringify({ observaciones: MARCA, ...datos })}$j$::jsonb, ${turnosIds ? `'{${turnosIds.join(",")}}'::bigint[]` : "null"}, '${rol}') is not null;`);
const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();
alta({ resultado: "miro", personas_grupo: 2, ocurrida_en: hace(15) });
alta({ resultado: "pregunto", personas_grupo: 3, hombres: 2, mujeres: 1, rango_etario: "18_24", conocia_sim: "no", motivo: "precio", ocurrida_en: hace(40) });
alta({ resultado: "subio", personas_grupo: 3, rango_etario: "25_34", conocia_sim: "si", se_subio_antes: "no", iniciador: "cliente", ocurrida_en: hace(30) }, [-950002]);
alta({ resultado: "subio", personas_grupo: 2, ocurrida_en: hace(60) });

console.log(sql(`select 'interacciones demo: ' || count(*) from public.interacciones_stand where observaciones = '${MARCA}'
                 union all select 'turnos demo: ' || count(*) from public.turnos_stand where id between -950999 and -950001
                 union all select 'inicio local: ' || coalesce(to_char(inicio_registro at time zone 'America/Argentina/Cordoba', 'YYYY-MM-DD HH24:MI'), 'sin inicio') from public.interacciones_config;`));
