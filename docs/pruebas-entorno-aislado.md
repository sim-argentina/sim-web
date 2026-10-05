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
npm run pruebas:ia-historico  # las cinco suites de IA que dependen del historial (ver abajo)
npm run pruebas:auditar-ia    # audita residuos de pruebas en las tablas de IA (solo lectura)
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

## El escenario histórico de IA SIM

Cinco suites verifican cifras concretas de **agosto y septiembre de 2026**: las tres de la capa
analítica (`servidor5a`, `servidor5b`, `servidor5b1`), la del planificador (`servidor5c`) y la
del saldo de créditos. Nacieron leyendo el historial real de producción, así que contra una base
local vacía fallaban todas.

La solución no fue apuntar de nuevo a producción ni bajar las cifras esperadas, sino construir un
**escenario histórico sintético** que atraviesa las mismas tablas fuente y las mismas reglas de
imputación y produce exactamente los números aprobados.

```bash
npm run pruebas:ia-historico                 # reset, esquema, escenario, contrato, 5 suites, limpieza
npm run pruebas:ia-historico -- --sin-reset  # reusa la base como está
npm run pruebas:ia-historico -- --dejar      # deja el escenario cargado para inspeccionarlo
npm run pruebas:ia-historico-generar         # regenera el SQL del escenario
```

### Cómo está hecho

`db/fixtures-ia-historico.sql` lo **genera** `scripts/pruebas/generar-historico-ia.mjs`. El SQL se
versiona y es auditable línea por línea, pero no se edita a mano: el generador declara los repartos
y verifica toda la aritmética del contrato —totales por mes y por fuente, segmentación, promedios,
mejores días, semanas ISO, turnos, personas, minutos, horas y los deltas entre los dos meses—
**antes** de emitir una sola línea. Si una suma no cierra, no genera nada y dice qué falló.

Son 122 filas de turnero (dos por día: una de 15 minutos y otra de 30, que es la forma real de una
jornada), 6 reservas, 1 campeonato con 18 inscripciones pagadas, 4 ingresos manuales y el cronograma
confirmado de los dos meses con 61 días y 76 jornadas. Nada más: las cantidades se expresan con
`cantidad_turnos` y `cantidad_personas`, no con miles de filas.

| Familia | Dónde |
|---|---|
| `TEST_IA_HIST_2026` | `nombre` de turnos del stand, reservas, campeonato e inscripciones |
| `TEST_IA_HIST_2026` | `creado_por` de los movimientos manuales |
| `@example.test` | los únicos correos del escenario |

No se insertan resultados: ni vistas, ni salidas de RPC, ni tablas derivadas, ni mensajes de IA. Los
totales aparecen al ejecutar la composición canónica de Finanzas, el motor analítico, el
planificador y el cronograma reales.

### Valores estructurales que no estaban en el enunciado

El contrato del bloque fijaba facturación, turnos y horas. Revisando las expectativas de las
suites aparecieron otros valores legítimos que el escenario también tiene que reproducir:

| Valor | Agosto | Septiembre | Dónde está declarado |
|---|---:|---:|---|
| Personas atendidas | 822 | 738 | `lib/ia/plan/ejecutorPlan.integration.ts` |
| Minutos de actividad | 13.680 | 12.390 | `lib/ia/plan/ejecutorPlan.integration.ts` |
| Promedio del mes completo | $434.000 | — | `servidor5b1`, fila **Total** de la tabla |
| Celdas en cero del desglose | manuales de fin de semana y reservas de días hábiles | — | `servidor5b1`: se publican como `$0` |

Las personas no salen de los turnos: una persona que juega 30 minutos deja dos turnos. Por eso
cada día lleva dos filas, una de 15 minutos y otra de 30, y cada una cumple la fórmula legacy
`turnos = personas × (minutos / 15)`. Los minutos de actividad salen solos, porque en legacy son
`turnos × 15`.

Ojo con los porcentajes: el motor guarda la variación con **dos** decimales (−9,43 % en turnos,
−2,15 % en horas) y la tabla publicada la muestra con **uno** (−9,4 % y −2,2 %, que son las cifras
aprobadas). El contrato verifica las dos cosas, y además las filas de la tabla textualmente.

`ejecutorPlan.integration.ts` es de solo lectura, así que sigue corriendo contra producción en
`npm run pruebas:seguras`; con este escenario cargado también pasa contra la base local.

### El contrato, antes de las suites

`scripts/pruebas/contrato-historico-ia.ts` le pregunta al **motor** y comprueba 40 invariantes: los
totales de los dos meses y de cada fuente, la ausencia de Gift Cards y Mensualidades, turnos,
personas y minutos de actividad, las horas del cronograma confirmado, la segmentación de agosto con
sus días calendario, promedios, mejores días y desglose por grupo, las cinco semanas hábiles, las
diferencias y variaciones entre los dos meses, que los deltas por fuente sumen exactamente la
diferencia total, `faltantes: 0`, la lectura `compatible_menor_demanda` y las cuatro filas de la
tabla publicada.

Si alguno no coincide, **las suites no empiezan**: fallarían por el escenario y no por el código, y
el mensaje dice qué invariante se rompió.

### Dos barreras, no una

Además del guardián —que solo acepta un loopback validado—, el propio fixture aborta si la base
tiene turnos fuera de agosto y septiembre de 2026, o reservas con correos que no sean del dominio de
prueba. Producción tiene las dos cosas, así que ahí el script no llega a escribir. El guardián sigue
siendo la barrera principal; esto es una segunda cerradura.

### ¿Y las demás suites?

La pregunta importaba: un campeonato, un cronograma confirmado de agosto y septiembre o cuatro
movimientos de Finanzas podrían romper pruebas de otros módulos. Se midió corriendo **las 53
suites mutantes con el escenario cargado**: 46 en verde, 0 bloqueadas y exactamente las mismas
siete fallas preexistentes de Mensualidades, Disponibilidad y Empresas que ya había antes. Ni
Campeonatos, ni Cronograma, ni Gift Cards, ni Brackets, ni Reservas cambiaron de resultado.

Por eso `npm run pruebas:mutantes` **carga el escenario** antes de empezar: es idempotente, trae
su propia guardia y hace que las cinco suites pasen sin configuración extra. Se puede omitir con
`-- --sin-historico`.

El escenario **no** está en `db/orden.txt` a propósito: no es configuración de la base, es un
escenario de negocio. `npm run pruebas:reset` deja la base limpia, sin historia.

### Por qué el saldo de créditos es aparte

`lib/ia/creditos/saldo.integration.ts` no necesitaba historial de ventas: necesitaba una
**conciliación anterior con baseline**, la que demuestra que el consumo previo no se descuenta dos
veces. Antes leía la conciliación real del administrador, lo que la ataba al saldo y al consumo
verdaderos de SIM. Ahora el test arma esa conciliación previa —sintética, por el camino real, con
`conciliar()` calculando el baseline del lado del servidor— y la borra al terminar, verificando que
el ledger vuelve a tener exactamente los movimientos que tenía antes. No depende del escenario
histórico ni de ningún dato real.

## Residuos de pruebas en Producción, y cómo no volver

El 03/10/2026 se limpiaron 87 filas de negocio (campeonatos, mensualidades, reservas). El
05/10/2026, en el bloque 5C.2, se limpió lo que había quedado en las tablas de **IA**:

| Tabla | Antes | Después | Qué era |
|---|---:|---:|---|
| `ia_ejecuciones` | 1600 | 42 | 1.558 con `proveedor = 'fake'` |
| `ia_herramientas_ejecuciones` | 1058 | 94 | 964 colgadas de esas ejecuciones |
| `ia_consumo` | 15 | 13 | 2 owners sintéticos (`admin:zztest-dbg3`, `admin:zzdebug10`) |

Las 1.558 ejecuciones falsas eran **huérfanas**: sus 1.368 conversaciones ya no existían,
porque el `finally` de cada suite sí había limpiado conversaciones y mensajes. Lo que no
limpiaba era la ejecución, el consumo ni las herramientas.

El saldo no se movió un centavo: `ia_costo_interno_acumulado` excluye `proveedor = 'fake'`
por definición, así que esos US$ 20,64 de costo estimado nunca estuvieron en el saldo. Y
`ia_consumo` del owner real reconcilia **exacto** con sus 42 ejecuciones reales (42
solicitudes, 1.040.197 tokens de entrada, 49.238 de salida, US$ 2,883311), lo que demuestra
que ninguna corrida de pruebas escribió bajo el owner real.

### La defensa

`lib/ia/proveedorPermitido.ts` decide **por destino**, igual que el guardián de pruebas, y
falla cerrada. El proveedor falso solo puede atender una consulta si se puede establecer
positivamente que la base es un loopback validado, o que el despliegue es Preview o
Development de Vercel. En Vercel Production está prohibido siempre, y un portátil con
`.env.local` —que apunta a Producción— también: ese era justamente el camino.

`correrChat` la evalúa **antes** de cualquier lectura o escritura, así que un entorno mal
configurado no deja conversación, mensaje, ejecución, consumo ni crédito, y no consume
cuota. `lib/ia/proveedorPermitido.test.ts` lo verifica, incluido que `NODE_ENV` no
participe de la decisión y que una URL que apenas *contiene* `localhost` no pase.

### La auditoría

```bash
npm run pruebas:auditar-ia             # Producción (solo lectura)
npm run pruebas:auditar-ia -- --local  # la base local de pruebas
```

Informa ejecuciones por proveedor, owners con firma de fixture, conteos de las 26 tablas de
IA y señales no concluyentes. **No expone contenido**: ni preguntas, ni respuestas, ni
títulos, ni documentos, ni correos. Devuelve **código 1** si encuentra residuos inequívocos,
así que sirve en cualquier verificación posterior a un bloque que toque IA.

### Ninguna integración de IA toca Producción

Antes, varias suites de IA corrían con `--env-file=.env.local`. Ahora:

- las 57 suites que exigen la base local la declaran activando el guardián;
- `ejecutorPlan`, `ejecutorAnalitico`, `completar` y `capacidades.contrato` —de solo
  lectura— se movieron al Supabase local sobre el escenario `TEST_IA_HIST_2026`;
- el runner manda a la base local toda suite que active el guardián, aunque no escriba;
- `lib/guardiaPruebas.test.ts` (control 13) **falla** si una integración de IA nueva
  menciona un project ref prohibido, documenta `.env.local` o toca la base sin guardián.

El reparto de horas del escenario dejó de ser decorativo: `completar.integration.ts` afirma
194 h del integrante de la mañana en agosto, así que el escenario las reproduce (11.640 min
de 24.840) y el contrato del fixture lo verifica.

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
