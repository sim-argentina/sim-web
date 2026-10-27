// Datos de DEMOSTRACIÓN de campañas de Marketing en el Supabase LOCAL (nunca Producción).
//
//   node scripts/pruebas/marketing-campanias-demo.mjs            # carga (reemplaza la demo anterior)
//   node scripts/pruebas/marketing-campanias-demo.mjs --limpiar  # solo borra la demo
//
// Carga, con la marca "DEMO CAMPAÑAS" (nombres y teléfonos INVENTADOS, 3518 / 3543 / 11):
//   · un texto de consentimiento sintético publicado (zz-demo-campanias), guardando
//     cuál estaba vigente para restaurarlo al limpiar;
//   · 30 turnos del stand en los últimos 2 a 20 días (ids negativos -960xxx):
//     teléfonos escritos de distintas formas, repetidos, uno gratis, uno
//     cancelado y uno sin teléfono;
//   · consentimiento registrado para 16 teléfonos y baja para 2 (por las RPCs reales).
// También aplica db/marketing-campanias.sql (idempotente). Borra las campañas
// cuyo nombre empiece con "Demo". Usa psql DENTRO del contenedor local y el
// mismo guardián que las suites.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { abortar, entornoDePruebas } from "./entorno.mjs";

const e = entornoDePruebas();
if (!e.ok) abortar(e);
const MARCA = "DEMO CAMPAÑAS";
const TEXTO = "zz-demo-campanias";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_sim-web-pruebas", "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
  { input: q, encoding: "utf8" }).trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// 24 teléfonos inventados: 3518xxxxxx (Córdoba), 3543xxxxxx (Sierras), 11xxxxxxxx (AMBA).
const TELS = [
  ...Array.from({ length: 16 }, (_, i) => `351800${String(1000 + i * 7).padStart(4, "0")}`),
  ...Array.from({ length: 5 }, (_, i) => `354300${String(2000 + i * 11).padStart(4, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `1100${String(300000 + i * 13).padStart(6, "0")}`),
];
const NOMBRES = ["Lucía", "Martín", "Sofía", "Tomás", "Valentina", "Joaquín", "Camila", "Mateo", "Julieta", "Benjamín", "Emma", "Thiago", "Mía", "Lautaro", "Catalina", "Bruno", "Paz", "Facundo", "Abril", "Nicolás", "Olivia", "Santino", "Renata", "Ignacio"];

sql(readFileSync("db/marketing-campanias.sql", "utf8"));

function limpiar() {
  const tels = TELS.map(lit).join(", ");
  sql(`begin;
    set local session_replication_role = replica;
    delete from public.mkt_whatsapp_envios where campania_id in (select id from public.mkt_campanias where nombre like 'Demo%');
    delete from public.mkt_campania_eventos where campania_id in (select id from public.mkt_campanias where nombre like 'Demo%');
    delete from public.mkt_campania_destinatarios where campania_id in (select id from public.mkt_campanias where nombre like 'Demo%');
    delete from public.mkt_campanias where nombre like 'Demo%';
    delete from public.mkt_consentimiento_eventos where telefono in (${tels});
    delete from public.turnos_stand where id between -960999 and -960001;
    commit;`);
  // El texto de la demo se retira (los textos publicados no se borran: el registro es inmutable).
  const vigente = sql(`select coalesce((select version from public.mkt_textos_consentimiento where estado = 'vigente'), '')`);
  if (vigente === TEXTO) sql(`select public.mkt_texto_retirar(${lit(TEXTO)}, 'admin');`);
}

limpiar();
if (process.argv.includes("--limpiar")) {
  console.log("Demo de campañas borrada (el texto zz-demo-campanias quedó retirado).");
  process.exit(0);
}

// 1 · Texto sintético publicado (publicar otro retira el vigente: es la base local).
sql(`insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
     select ${lit(TEXTO)}, 'Demo campañas', 'Acepto recibir promociones de SIM Argentina por WhatsApp. Texto SINTÉTICO de la demo local de campañas.', ''
      where not exists (select 1 from public.mkt_textos_consentimiento where version = ${lit(TEXTO)});
     select public.mkt_texto_publicar(${lit(TEXTO)}, 'admin');`);

// 2 · Turnos en la ventana, escritos de distintas formas.
const escrito = (t, i) => (t.startsWith("11") ? (i % 2 ? `+54 9 11 ${t.slice(2, 6)}-${t.slice(6)}` : `011 15 ${t.slice(2)}`)
  : i % 3 === 0 ? `+54 9 ${t.slice(0, 4)} ${t.slice(4)}` : i % 3 === 1 ? `0${t.slice(0, 4)} 15 ${t.slice(4)}` : t);
const filas = [];
let id = -960001;
const turno = (i, dias, extra = {}) => {
  filas.push(`(${id--}, ${lit(`${NOMBRES[i % NOMBRES.length]} (${MARCA})`)}, ${extra.sinTel ? "null" : lit(escrito(TELS[i], i))},
    (now() at time zone 'America/Argentina/Buenos_Aires')::date - ${dias}, '${String(15 + (i % 6)).padStart(2, "0")}:00',
    ${lit(extra.estado ?? "confirmado")}, ${extra.total ?? 14000}, ${lit(extra.metodo ?? (i % 2 ? "efectivo" : "mercado_pago"))})`);
};
TELS.forEach((_, i) => turno(i, 2 + (i % 19)));
turno(0, 12);                       // repetido: un solo destinatario
turno(3, 5);                        // repetido
turno(20, 6, { total: 0, metodo: "gratis" });
turno(21, 7, { estado: "cancelado" });
turno(22, 8, { sinTel: true });
turno(5, 25);                       // fuera de la ventana de 21 días
sql(`insert into public.turnos_stand (id, nombre, telefono, fecha, hora, estado, total, metodo_pago) values ${filas.join(",\n")};`);

// 3 · Consentimiento para 16 y baja para 2, por las RPCs reales.
const alta = (t) => `select public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
  'tipo', 'alta', 'fuente', 'admin_evidencia', 'telefono', ${lit(t)}, 'texto_version', ${lit(TEXTO)},
  'evidencia', jsonb_build_object('tipo', 'papel_firmado', 'referencia', 'Planilla SINTÉTICA de la demo'),
  'ocurrido_en', to_char((clock_timestamp() - interval '4 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'admin');`;
const baja = (t) => `select public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
  'tipo', 'baja', 'fuente', 'admin_pedido', 'telefono', ${lit(t)}, 'evidencia', jsonb_build_object('canal', 'presencial')), 'admin');`;
const conAlta = [...TELS.slice(0, 13), TELS[16], TELS[17], TELS[21]];
sql([...conAlta.map(alta), baja(TELS[13]), baja(TELS[2])].join("\n"));

const n = sql(`select count(*) from public.mkt_consentimiento_estado where telefono in (${TELS.map(lit).join(", ")}) and estado = 'alta'`);
console.log(`Demo de campañas cargada: ${filas.length} turnos sintéticos, ${n} teléfonos con consentimiento vigente, 2 con baja.`);
console.log("Abrí /admin/marketing?vista=campanias en el Next local (cupones-local o marketing-local).");
