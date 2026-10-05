# Entorno de pruebas aislado

Las suites de integración **nunca** deben escribir en la base real. Este documento explica cómo
levantar el Supabase local del repositorio y correr las suites ahí.

## Por qué existe

`.env.local` apunta al proyecto de **producción** (`bcmoewwhsyxsiyvroarj`, SIM WEB). Las suites de
integración se corrían con `--env-file=.env.local`, así que cada una creaba clientes,
mensualidades, campeonatos, inscripciones pagadas y reservas en la base real y confiaba en un
`finally` para borrarlos.

Un proceso interrumpido no ejecuta `finally`. El 03/10/2026 quedaron **87 filas sintéticas
visibles en el panel de administración**, incluidos \$800.000 de recaudación ficticia en
Campeonatos. Las marcas de tiempo coinciden una a una con las corridas que se mataron; las que
terminaron bien limpiaron sin dejar nada.

Desde entonces:

- `lib/guardiaPruebas.ts` decide por **destino**, no por `NODE_ENV` ni por un flag. Solo acepta un
  **loopback validado**. Cualquier proyecto alojado está bloqueado, y en particular SIM WEB y SIM
  TURNOS, incluso si se escriben a mano en la variable de pruebas.
- `lib/guardiaPruebas.activar.ts` va como **primer import** de las 53 suites que escriben, así el
  proceso aborta antes de inicializar cualquier cliente de Supabase. Eso cubre también las
  escrituras indirectas, las que pasan por código de producción en vez de por el cliente de la
  prueba.
- `lib/guardiaPruebas.test.ts` recorre los archivos, detecta quién escribe y falla si alguno no
  activa el guardián o no lo pone primero. Una RPC nueva se asume mutante hasta que se la revise.

## Requisitos

- **Docker Desktop corriendo.** El stack local son contenedores.
- **Supabase CLI**, que se usa vía `npx` (no hace falta instalarlo aparte).

El stack de este repositorio usa el `project_id` **`sim-web-pruebas`** y los puertos **553xx**
(API 55321, DB 55322), para no pisar otro stack local que pueda estar corriendo en la misma
máquina con los puertos por defecto 543xx.

## Comandos

```bash
npm run pruebas:iniciar     # levanta el stack local y escribe .env.test.local
npm run pruebas:esquema     # aplica el esquema completo, en el orden de db/orden.txt
npm run pruebas:reset       # vacía la base y reaplica el esquema desde cero
npm run pruebas:mutantes    # corre las 53 suites que escriben, en serie, contra la base local
npm run pruebas:seguras     # corre la regresión segura (sin base + solo lectura)
npm run pruebas:detener     # detiene el stack (agregá -- --borrar para tirar los datos)
```

Desde cero, en una máquina nueva:

```bash
npm install
npm run pruebas:iniciar
npm run pruebas:esquema
npm run pruebas:mutantes
```

Una sola suite:

```bash
node scripts/pruebas/correr-mutantes.mjs lib/bracketReset.integration.ts
```

## Cómo se reconstruye el esquema

`db/` tiene 63 archivos SQL **incrementales** que crean 59 tablas (`ia_*`, `mensualidad_*`,
`cronograma_*`, `sim_control_*`, `campeonato_checkouts`, `fin_pagos_web` y las de
configuración comercial posteriores). Las **47 tablas de negocio originales** —`reservas`,
`turnos_stand`, `campeonatos`, `gift_cards`, todo `fin_*`, `colectivo_*`, `empresa_*`, los
brackets— se crearon fuera del repositorio al principio del proyecto y existían **solo en
producción**. Sin ellas no se podía levantar una base de pruebas, y por eso las suites mutantes
solo podían correr contra la base real.

`db/esquema-base.sql` cubre esa brecha. Se obtuvo por **introspección de solo lectura** del
catálogo de producción (`pg_catalog` / `information_schema`): es estructura, no un dump de datos.
No contiene una sola fila, ni clientes, ni teléfonos, ni correos, ni pagos.

Además faltaban en el repositorio:

| Qué | Dónde quedó |
|---|---|
| 47 tablas de negocio, con sus claves, checks, FKs e índices | `db/esquema-base.sql` |
| 6 funciones (`fin_set_updated_at`, `cancelar_reserva_empresa`, `crear_bloqueo_reserva`, `mensualidad_bloques_coherentes` y los dos constructores del tipo range) | `db/esquema-base.sql` |
| El tipo `cronograma_timerange` | `db/esquema-base.sql` |
| Los 13 triggers `trg_fin_*_updated` | `db/esquema-base.sql` |
| El trigger `reserva_slot_bloqueo` sobre `reserva_slots` — el repositorio creaba la función pero nunca el `create trigger` | `db/esquema-base-cierre.sql` |
| La FK `reservas.mensualidad_id` → `mensualidades`, que cruza dos módulos | `db/esquema-base-cierre.sql` |
| Los grants de `service_role`, sin los cuales la base nueva responde *permission denied* | `db/esquema-base-permisos.sql` |

`db/orden.txt` fija el orden de aplicación. No es alfabético: hay dependencias reales, por ejemplo
`modalidad-comercial-b1.sql` crea `reserva_hhmm_a_minutos` pero necesita `mensualidades`, así que
va entre `mensualidades-m5c2` y `mensualidades-b6`. No se aplican los `*.previo.sql`, los
`*.verificacion.sql`, `modalidad-comercial-b1.matriz-legacy.sql` ni `b2-motor-vs-trigger.sql`
(una matriz de 577 casos que termina siempre con `RAISE EXCEPTION` para revertirse).

Paridad verificada contra producción: **106 tablas, 83 funciones propias, 323 índices, 99 claves
foráneas, 106 tablas con RLS y 17 triggers** en los dos lados.

## Datos de prueba

La base local arranca con la configuración que crean los propios archivos de `db/`
(`mensualidad_planes`, `mensualidad_plan_precios`, `mensualidad_config`,
`modalidad_comercial_config`, `empleados`, `ia_conocimiento_categorias`) y **nada más**. Cada suite
crea sus propios datos con un identificador de corrida propio, así que no dependen del orden entre
archivos. Los datos de prueba son sintéticos y reconocibles; los correos usan el dominio reservado
`@example.test`.

El `finally` de cada suite se mantiene por higiene, pero **no es una barrera de seguridad**: la
barrera es que el proceso no pueda llegar a producción.

## Variables y secretos

- `.env.test.local` lo **genera** `npm run pruebas:iniciar` a partir de lo que publica el stack
  local. Está cubierto por `.gitignore` (`.env*`) y no se commitea nunca.
- `.env.test.example` es el template versionado, solo con placeholders.
- El runner no hereda el entorno: construye uno. Borra del proceso hijo todas las variables de
  Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `POSTGRES_URL`
  y las demás) y todas las credenciales de proveedores (Anthropic, OpenAI, Tavily, Mercado Pago,
  correo, WhatsApp, Vercel, Supabase), y después aplica las del archivo de pruebas. Si cualquier
  variable del entorno final menciona un project ref prohibido, aborta antes de la primera suite.
- Las suites mutantes **no cargan** `.env.local`.

## Proveedores externos

En pruebas, `IA_PROVIDER=fake`. No hay llamadas reales a Claude, Tavily, Mercado Pago, correo ni
WhatsApp, y el consumo facturable es cero. El runner no deja ninguna credencial real en el proceso,
así que una suite que intentara usarlas no tendría con qué.

## Si una suite queda bloqueada

El mensaje del guardián lo dice: el destino no es la base local. Salida con código **78**
(configuración), distinta de `1` (un test que falló). Revisá que el stack esté arriba
(`npm run pruebas:iniciar`) y que `.env.test.local` apunte a `127.0.0.1`.
