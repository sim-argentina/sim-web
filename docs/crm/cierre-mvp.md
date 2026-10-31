# CRM B2B — Cierre del MVP

Cierre integral del MVP (B0 → B4) **sin módulos nuevos**: corrección del límite de 1000 filas de
Seguimiento, recorrido integral con los dos roles y plan de publicación y de vuelta atrás. Incluye
las condiciones comerciales vigentes, lo que siguen abiertas y la compatibilidad del código común
con Empresas (§7–§10, ajuste del 31/10/2026). **Nada de esto está publicado:** sin push, sin merge a
`main`, sin SQL en Producción y sin cambios en Vercel. Diseño: [diseno.md](diseno.md). Bloques:
[B0](b0-identidad.md) · [B1](b1-prospeccion.md) · [B2](b2-seguimiento.md) ·
[B3](b3-ventas-cobros-comisiones.md) · [B4](b4-metricas.md).

## 1. Estado del código

**Rama `crm-b0-identidad`** en el worktree `C:/SIM/sim-argentina-crm`, creada desde `origin/main`
`c66beda` y **sin upstream** a propósito. El último commit de código del cierre es `ae60dbb`; el
de este documento va encima.

| Bloque | Commits | Qué deja |
|---|---|---|
| B0 / B0.1 | `df6c147`, `ea3207d` | Usuarios comerciales con sesión propia (`/comercial`), límite de intentos con respaldo, aislamiento de la analítica. |
| B1 | `a070610..08e79f6` | Negocios, contactos, jornadas y visitas desde el celular; oportunidad solo con contacto útil. |
| B2 | `d2a0b1b..81a999d` | Bandeja de Seguimiento de Administración: estados, gestiones, próxima acción, pausa, pérdida y ciclos. |
| B3 | `9792c7d..b87c789` (+ `01f8a63`) | Ventas y Ganado, cobros, comisiones, recompras, vínculo de solo lectura con Empresas. |
| B4 | `b010285..ee5a9f1` | Métricas de solo lectura en `/admin/crm/metricas`. |
| Cierre | `ae60dbb` y este documento | Seguimiento sin el límite de 1000; control de solo lectura `db/crm-poscontrol.sql`; esta guía. |

**Frente a `main` actual** (`origin/main` = `33ca411`, consultado el 31/10/2026):
- La rama tiene 27 commits que `main` no tiene: los del CRM y tres `cherry-pick -x` del parche de
  seguridad.
- `main` no tiene nada pendiente de integrar. Sus tres commits posteriores a `c66beda` son
  justamente ese parche (`git cherry` los marca como ya incluidos):
  - `6f9f523` → `bd7f170` (Next 16.4.3, React 19.2.9, sharp 0.35.5);
  - `9e1ebf3` → `958de20` (eslint-config-next 16.2.9);
  - `33ca411` → `32c2700` (firma de webhooks de Mercado Pago).
- **El parche se mantiene:** `package.json` y `package-lock.json` son idénticos a los de `main`.
- `git merge-tree` entre `main` y la rama no da conflictos.
- No se integró nada más de `main` en este cierre. Si `main` avanza antes de publicar, se compara
  de nuevo y se integra **solo con autorización** (ver §4, prechequeos).

Archivos compartidos con el resto del sitio que el CRM modifica (todo lo demás es nuevo y propio
del CRM). Revisarlos con cuidado al fusionar:

| Archivo | Cambio |
|---|---|
| `middleware.ts` | Área `/comercial`: navegación de documento completo al entrar y salir; `/admin/crm` solo para admin. |
| `app/robots.ts` | `disallow` de `/comercial`. |
| `components/AdminSidebar.tsx` | Entrada «CRM» (solo admin). |
| `components/NavbarWrapper.tsx`, `components/FooterWrapper.tsx` | Sin navbar ni footer del sitio en `/comercial`. |
| `components/analytics/*`, `lib/analytics.ts`, `lib/analytics.allowed.test.ts` | Sin GTM ni consentimiento de cookies en `/comercial`. |
| `db/orden.txt` | Secciones 13g–13j (los cuatro SQL del CRM). |
| `.env.example`, `.gitignore` | `CRM_SESSION_SECRET` y la carpeta de la instancia local. |
| `scripts/pruebas/crm-local.mjs` | Instancia local aislada del CRM. |

Marketing (`marketing-etapa1-simulacion`) y los demás worktrees no se tocaron.

## 2. Corrección del límite de 1000 de Seguimiento

**Antes:** la bandeja pedía las oportunidades de la vista en una sola consulta a PostgREST, que
corta en 1000 filas. Con más de 1000, la búsqueda, los filtros, los grupos y los contadores
trabajaban sobre un recorte. Una oportunidad fuera de ese recorte no aparecía ni buscándola.

**Ahora** se usa el mismo motor de B2, sin uno paralelo:
- **Carga completa:** `crmB2Server.bandeja` lee **todas** las oportunidades de la vista con
  `todasLasFilas`, que pagina con un orden estable (`lead_en`, `id`). Es el mismo helper que ya
  usaban Ventas (B3) y Métricas (B4). Los datos relacionados (`porIds`) también se paginan por
  tramo de ids.
- **Mismo cálculo:** sobre el conjunto completo corren `armarFilas`, `filtrar` y `contar` de
  `lib/crmB2.ts`. Búsqueda, filtros, grupos y contadores ven todo.
- **Orden total y estable**, independiente del orden en que llegan las filas:
  - en Para seguir: grupo, vencimiento de la próxima acción, `lead_en` e `id`;
  - en Perdidas y Ganadas: fecha descendente e `id`.
- **Al navegador solo va la página:** 50 filas (`POR_PAGINA`), con `coincidencias`, `pagina` y
  `total_paginas`. Cada oportunidad está en una sola página y en un solo grupo.
- **Pantalla:** «desde–hasta de N · página x de y», Anterior/Siguiente. La página vuelve a 1 al
  cambiar la búsqueda o un filtro. Con varias páginas, cada encabezado de grupo dice cuántas tiene
  en total.

Leer todo en el servidor es lineal y está acotado por el volumen real del CRM (miles, no
millones). No agrega SQL ni índices.

**Evidencia:**
- **`lib/crmB2Paginacion.integration.ts`** (rutas reales, instancia aislada, OK en ~10 s):
  - siembra 1100 oportunidades ficticias, entre ellas 30 perdidas, con y sin gestión y con
    seguimientos vencidos y futuros;
  - la oportunidad buscada queda en la posición 1024 del orden anterior: no aparecía;
  - comprueba permisos (401/403/401);
  - la búsqueda la encuentra en «Seguimientos vencidos», y sin búsqueda se llega a ella por su
    grupo;
  - los contadores coinciden con los conteos de la base por grupo;
  - 22 páginas sin repetidos ni faltantes;
  - filtros por próxima acción, origen y estado;
  - Perdidas = 30 y Ganadas = 0;
  - cada respuesta pesa menos de 120 kB;
  - limpia solo sus filas (`zzcrmpag…`).
- **`lib/crmB2.test.ts`:** paginación de 237 filas con orden independiente de la entrada, orden
  de grupos, sin repetidos ni omisiones, y página fuera de rango acotada.
- **Pantalla, con 120 oportunidades temporales sumadas a las del QA**, borradas al terminar:
  - escritorio: «1–50 de 128 · página 1 de 3», luego 51–100 y 101–128 (Siguiente deshabilitado);
    el encabezado dice «(125 en total)»; la búsqueda de una sola da «1 oportunidad.»;
  - emulación de celular de 375×812: sin desborde y botones de 44 px.

## 3. Base de datos y configuración

### SQL, orden y verificaciones

Los cuatro archivos se aplican **en este orden**, que es el de `db/orden.txt` (13g → 13j), después
del esquema existente de SIM WEB:

| Orden | Archivo | Verificación (instancia local; se deshace entera) | Resultado |
|---|---|---|---|
| 1 | `db/crm-b0-identidad.sql` | `db/crm-b0-identidad.verificacion.sql` | `OK 129` |
| 2 | `db/crm-b1-prospeccion.sql` | `db/crm-b1-prospeccion.verificacion.sql` | `OK 110` |
| 3 | `db/crm-b2-seguimiento.sql` | `db/crm-b2-seguimiento.verificacion.sql` | `OK 42` |
| 4 | `db/crm-b3-ventas.sql` | `db/crm-b3-ventas.verificacion.sql` | `OK 49` |
| — | (la cadena completa) | `db/crm-cadena.verificacion.sql` | `OK 60` |
| — | (solo lectura, también en una base real) | `db/crm-poscontrol.sql` | ver abajo |

B4 y el cierre no tienen SQL. Los archivos son aditivos e idempotentes y solo crean o modifican
objetos `crm_*`: 19 tablas y 57 funciones. No tocan tablas, funciones ni permisos de otros
módulos. B3 **lee** `empresa_campanias` y `empresa_codigos`, sin escribirlas y sin claves
foráneas.

Reglas para reaplicar:
- Las restricciones que amplía un bloque posterior se crean `NOT VALID` y se validan al aplicar
  el siguiente. Reaplicar un bloque anterior solo deja, de forma transitoria, una sin validar.
- Una función redefinida por un bloque posterior se restaura **siempre** desde el último archivo
  de la cadena que la define, nunca desde uno anterior.

Las verificaciones completas **escriben dentro de un bloque que se deshace**, así que corren en la
instancia local. En una base real se usa `db/crm-poscontrol.sql`: solo hace `SELECT`. Lo esperado
para la cadena del cierre:

```
P1 tablas|19|rls=true|politicas=0        RLS activa y sin políticas en las 19 tablas
P2 sin_validar|0                         ninguna restricción crm_* sin validar
P3 anon_auth|0                           anon/authenticated/PUBLIC sin privilegios
P4 service_role|SELECT                   service_role solo lee; se escribe por RPC
P5 hash_legible|false                    el hash de la contraseña no es legible
P6 definer_sin_path|0                    toda SECURITY DEFINER fija search_path = public
P7 exec_anon_auth|0                      ninguna función ejecutable por anon/authenticated
P8 funciones|57|service_role_exec=26     57 funciones; 26 RPC que llama el servidor
P9 rubros|14                             configuración inicial de B1
P10 productos|pack_10:150000.00:40000.00,pack_25:360000.00:90000.00,personalizado:-:-
P11 datos|usuarios=0|zonas=0|negocios=0|…|pagos_comision=0   base recién migrada
```

En la instancia local los P1–P10 coinciden. P11 no da cero porque ahí están los datos ficticios
del QA. Las 57 funciones de la base local son exactamente las que definen los archivos, sin
sobrecargas ni restos.

### Variables de entorno

Solo nombres y propósito. Los valores no van en el repositorio ni en este documento.

| Variable | ¿Nueva? | Para qué |
|---|---|---|
| `CRM_SESSION_SECRET` | **Sí, la única** | Firma de la sesión comercial (`/comercial`). Al menos 32 caracteres al azar, **distinta** de `ADMIN_SESSION_SECRET`. Si falta, es corta o coincide, el ingreso comercial queda cerrado (503) y el panel no se afecta. Rotarla cierra todas las sesiones comerciales. |
| `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD`, `STAFF_PASSWORD` | No | Panel de Administración, sin cambios. El CRM se usa con el rol admin; staff no entra. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | No | El servidor llama a las RPC del CRM con `service_role`, que nunca llega al navegador. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (o sus alias `…_KV_REST_API_…`) | No | Límite de intentos del ingreso comercial, el mismo almacén que `lib/rateLimit.ts`. Sin ellas, respaldo en memoria por instancia. |

Los usuarios y contraseñas comerciales **no** son variables: se crean desde la pantalla y se
guardan como hash en la base.

### Configuración inicial legítima

Esto es lo único que la base real necesita al publicar. Lo siembran los propios SQL o lo carga
Administración desde `/admin/crm/configuracion`:
- **Rubros:** los 14 de B1 (Concesionarias … Peluquerías). Administración puede agregar, renombrar
  o desactivar; no se borran.
- **Productos y comisiones de lista:**
  - Pack 10: 10 experiencias de 20 min, $150.000, comisión $40.000;
  - Pack 25: 25 experiencias de 20 min, $360.000, comisión $90.000;
  - Personalizado: desde 26 experiencias, cotización de Administración, importe y comisión a mano.

  Son los importes vigentes (§7.1). El CRM no les agrega IVA; el tratamiento fiscal sigue
  pendiente (§7.3). Cambiarlos vale para las ventas siguientes.
- **Zonas:** los SQL no siembran ninguna. Administración carga las que vaya a trabajar Tobías.
  Son opcionales en jornadas y negocios, pero sin ellas no hay métricas por zona.
- **Usuario comercial de Tobías:** se crea después de publicar (abajo).

### Datos ficticios del QA (no se copian nunca)

Todo lo que hay en la instancia local `sim-web-crm-local` es de prueba y **no se copia a
Producción**: ni un volcado ni una exportación. La base real arranca vacía (P11 en cero), salvo la
configuración de arriba. Lo ficticio:
- usuarios `qa.tobias` y `qa.cierre`;
- negocios como «Gimnasio …» y «Kiosco …» del recorrido, y los de B1–B3;
- sus jornadas, visitas, oportunidades, gestiones, ventas, cobros y pagos de comisión;
- la campaña de Empresas ficticia (`created_by = 'qa-crm-local'`);
- las zonas de prueba.

Las suites automáticas limpian sus propias marcas (`zzcrm…`). Las contraseñas locales están fuera
de los repositorios (`C:/SIM/crm-local-qa/`) y en `.env.crm.local`, que git ignora.

Este bloque **no importa rutas ni prospectos reales**. Los negocios reales nacen en la calle
(visitas de Tobías) o los da de alta Administración, uno por uno, cuando el CRM ya esté en uso.

### Alta del usuario real de Tobías (después de publicar)

1. Ingresar al panel con la credencial de **Administración** (no la de staff).
2. `/admin/crm/configuracion` → **Usuarios comerciales** → **Nuevo usuario**:
   - usuario de 3 a 40 caracteres (minúsculas, números, punto, guion o guion bajo), por ejemplo
     `tobias`;
   - nombre visible;
   - contraseña de al menos 10 caracteres y sin el usuario («Generar» arma una al azar en el
     navegador).
3. Pasarle la contraseña **por un medio privado**: después de guardar no se vuelve a mostrar. No
   se anota en el repositorio, ni en un chat compartido, ni en un documento.
4. Tobías entra desde su celular en `/comercial/ingresar`. «Restablecer contraseña» y
   «Desactivar» están en la misma pantalla. Desactivar revoca sus sesiones al instante.
5. Asignarle negocios (si Administración carga alguno) desde `/admin/crm/negocios`. Los que él
   crea quedan asignados a él.

## 4. Pasos de publicación (no ejecutados)

Cada paso requiere autorización explícita del owner. Orden pensado para que cada paso sea inocuo
con el código anterior: la variable no se usa hasta el código nuevo, y las tablas nuevas no las
lee nadie hasta entonces.

**Prechequeos**
1. `git fetch` y comparar la rama con `main` de ese momento: `git log crm-b0-identidad..origin/main`
   y `git merge-tree --write-tree origin/main crm-b0-identidad`. Si `main` avanzó, integrar con
   autorización (sin automatismos) y repetir el punto 3.
2. Armar la instancia local desde cero con la cadena:
   `node scripts/pruebas/crm-local.mjs esquema --reset`. Esto borra el `public` **de la instancia
   local del CRM** y sus datos de QA, nunca otra base. Correr las cinco verificaciones (resultados
   de §3) y `db/crm-poscontrol.sql` (P11 en cero).
3. Pruebas: puras del CRM, integraciones B0–B4 y la de paginación, `tsc`, `eslint` y `next build`.
4. En Producción, solo lectura: confirmar que no existe ningún objeto del CRM
   (`select to_regclass('public.crm_usuarios')` → nulo) y que hay respaldo reciente de la base.
   Registrar la foto de control de Finanzas y Empresas (conteos de `fin_*` y huella de
   `empresa_campanias` y `empresa_codigos`) para compararla al final.

**Esquema y configuración**

5. En Vercel → Production: cargar `CRM_SESSION_SECRET` (y en Preview solo si se va a probar ahí).
   Confirmar que `ADMIN_SESSION_SECRET` existe y es distinta, y que las variables de Upstash ya
   están (las usa `lib/rateLimit.ts`).
6. En SIM WEB, por MCP, aplicar como cuatro migraciones separadas, en orden:
   `crm-b0-identidad.sql` → `crm-b1-prospeccion.sql` → `crm-b2-seguimiento.sql` →
   `crm-b3-ventas.sql`. Ningún otro archivo de `db/`: los fixtures de pruebas jamás van a
   Producción.
7. Correr `db/crm-poscontrol.sql` en SIM WEB y exigir lo esperado de §3, con P11 en cero.

**Código**

8. Fusionar la rama en `main` y hacer push. **Un push a `main` despliega a Producción**, así que
   recién va después del paso 7.

**Acceso y navegación**

9. Sin sesión:
   - `/admin/crm/seguimiento` lleva al login del panel;
   - `/api/admin/crm/seguimiento` responde 401;
   - `/comercial` lleva a `/comercial/ingresar`.
10. Con staff, `/admin/crm` no entra.
11. Con admin cargan Seguimiento (vacío), Negocios, Ventas, Métricas («Sin datos» o ceros) y
    Configuración.
12. En `/comercial`: no carga GTM y no aparece el aviso de cookies; `robots.txt` excluye
    `/comercial`.

**Usuario real**

13. Crear el usuario de Tobías (§3) e ingresar con él **en su teléfono real**: el QA fue con
    emulación. Debe ver su inicio vacío. Probar «Salir» y volver a entrar.

**Poschequeos (sin cobros ni ventas reales)**
14. No cargar datos de prueba en Producción: un negocio, una visita o una jornada «de prueba»
    contaría en las métricas, y archivarla no la saca. El primer registro real es la primera
    jornada real de Tobías.
15. `db/crm-poscontrol.sql` otra vez: P11 con `usuarios=1` y el resto en cero.
16. Repetir la foto de Finanzas y Empresas: tiene que ser idéntica a la del paso 4.
17. Revisar los logs de Vercel:
    - sin 500 en `/admin/crm` ni `/comercial`;
    - sin el evento `crm_limite_respaldo_memoria`, que indicaría que Upstash no responde.

## 5. Vuelta atrás del código, conservando los datos del CRM

La vuelta atrás es **del código**. Las tablas `crm_*` no se borran ni se vacían: el código
anterior no las lee, RLS sin políticas las deja cerradas a la clave pública, y `service_role` solo
puede leerlas.

| Situación | Qué hacer |
|---|---|
| Cerrar el acceso de Tobías sin tocar el código | `/admin/crm/configuracion` → **Desactivar**: revoca sus sesiones al instante. También se puede quitar o rotar `CRM_SESSION_SECRET` y redesplegar: el ingreso comercial queda cerrado (503) y caen todas las sesiones. |
| Volver al código anterior | En Vercel, **promover el despliegue de Producción anterior** (vuelta atrás inmediata). Después, `git revert -m 1 <merge>` en `main`, para que el próximo push no vuelva a desplegar el CRM. |
| SQL aplicado pero código sin publicar | Nada: las tablas y funciones quedan inertes. |
| Volver a publicar más adelante | El mismo código sobre los mismos datos, sin migrar de nuevo, salvo que cambie el SQL. |
| Registros mal cargados | No es una vuelta atrás: se **anulan** desde la aplicación, con motivo y auditoría, sin borrar nada. |

Nunca se usa como vuelta atrás `drop table`, `truncate`, borrar filas ni reaplicar un SQL
anterior a la cadena. Los datos del CRM se conservan para cuando se vuelva a publicar.

## 6. Recorrido integral del cierre (local, ambos roles)

Servidor de producción local (`next start`, puerto 3130) contra la instancia aislada. El rol
comercial es un usuario de QA propio (`qa.cierre`), cuya contraseña quedó fuera del repositorio.
Escritorio y **emulación de Chrome** de 375×812 (no un teléfono real). Fecha de negocio:
31/10/2026.

| Paso | Resultado comprobado |
|---|---|
| 1. Administración prepara y asigna un negocio | Sin actividad ficticia: 0 visitas, 0 oportunidades, 0 tareas; solo la auditoría de creación. |
| 2. Jornada | El comercial la abre desde el celular. |
| 3. Visita con contacto útil | Gimnasio: habló con el responsable, interés tibio → lead «Interesado». |
| — Empleado que da el teléfono del dueño | Kiosco: atendió un empleado y el responsable no estaba. Contacto obtenido con el teléfono del dueño, sin hablar con él; decisor «no sabe»; interés sin evaluar. Resultado: lead «Contacto», sin decisor ni interés inventados. |
| 4. Lead en Seguimiento | Los dos en «Leads nuevos sin gestionar». |
| 5. Gestión, próxima acción y negociación | Llamada con próxima acción al 01/11; el inicio de negociación la resuelve: Interesado → Negociación. |
| — Visita posterior | Interés «frío» con el decisor ya marcado: sigue en Negociación, con `negociacion_en` intacta y sin despausar ni retroceder. El decisor lo corrigió Administración en la ficha, no la visita. |
| 6. Venta | Pack 10, $150.000, comisión $40.000 al comercial que **originó** el lead. Ganado con venta vigente. |
| 7. Anticipo y saldo | Con el anticipo, la comisión queda «Prevista» y sin botón de pago. Al cargar el saldo aparece el aviso de posible duplicado y luego la comisión pasa a «Generada». |
| 8. Comisión | Pagada → «Pagada». |
| 9. Entrega de tarjetas | «Cobrada, entregada y sin comisión pendiente». |
| 10. Ficha | Compras: 1, cobrada, $150.000, 1 × Pack 10. |
| 11. Recompra | La crea Administración con el contacto existente. La venta anterior queda intacta (versión 2, $150.000, entregada) y la ganada sigue ganada. El formulario propone «Recompra espontánea (sin comisión)». «Trabajada» se deshabilita sin una visita del comercial en esa oportunidad: «No tiene visitas en esta oportunidad». |
| 12. Cierre de jornada y métricas | 38 km, combustible $3.500, estacionamiento $800, peajes $0, otros $0. Diferencias en las métricas: tabla siguiente. |

**Métricas del 31/10/2026, antes → después.** El «antes» ya tenía datos de bloques anteriores en
esa fecha.

| Métrica | Antes | Después | | Métrica | Antes | Después |
|---|---|---|---|---|---|---|
| Negocios visitados | 0 | 2 | | Ventas | 1 | 2 |
| Visitas | 0 | 3 | | Importe acordado | $360.000 | $510.000 |
| Leads | 0 | 2 | | Cobrado según CRM | $360.000 | $510.000 |
| Con responsable / decisor / interesados | 0 / 0 / 0 | 1 / 1 / 1 | | Comisión generada | $90.000 | $130.000 |
| Visitas que generaron un lead | 0/0 | 2/3 | | Comisión pagada | $90.000 | $130.000 |
| Cohorte (leads → compradores) | 0/0 | 1/2 | | Cobros menos comisiones pagadas | $270.000 | $380.000 |
| Negocios visitados → compradores | 0/0 | 1/2 | | Experiencias vendidas | 25 | 35 |
| Jornadas / km / movilidad | 0 / Sin datos / Sin datos | 1 / 38 / $4.300 | | Recompras de Administración | 2 | 3 |
| Ventas atribuidas a jornadas | 0 | 1 | | | | |

Sin cambio: perdidas, saldo, comisión prevista y comisión a pagar. «Cobros menos comisiones
pagadas» es un flujo del período, **no ganancia neta**: no descuenta movilidad, experiencias,
impuestos ni gastos.

**Reglas confirmadas en el recorrido**

| Regla | Comprobación |
|---|---|
| La reasignación no cambia el origen ni deja acceso al creador | Kiosco pasó a `qa.tobias`. Para `qa.cierre`: 200 antes, 404 después, y fuera de su lista. Origen, `lead_en` y `creada_por_usuario` siguen siendo de `qa.cierre`. |
| Contacto ≠ decisor | El teléfono del dueño vía un empleado no lo marca decisor. `decisor_contactado` recién fue verdadero al hablar con quien Administración marcó como decisor. |
| Una visita posterior no retrocede ni saca de pausa | Visita «frío» sobre Negociación: sigue en Negociación. Además, cubierto por la verificación de B2 y su integración. |
| Ganado tiene venta vigente | La oportunidad pasa a ganada solo con la venta, en la misma RPC. |
| El anticipo no genera comisión | «Prevista» y sin pago posible hasta completar el cobro. |
| Una gestión genérica de Administración no acredita a Tobías en una recompra | «Trabajada» exige una visita del beneficiario en esa oportunidad. |
| La recompra espontánea no hereda comisión | Propuesta por defecto y sin comisión. |
| Leer métricas no escribe | Conteo de todas las tablas `crm_*` idéntico antes y después de abrir Métricas. |
| Archivar conserva la historia | Gimnasio archivado: las métricas no cambian (1 venta, $150.000, 3 visitas, 2 leads) y el detalle lo marca «(archivado)». Después se desarchivó. |
| Lo económico y las notas privadas no llegan al área comercial | Las respuestas de la API comercial (ficha, inicio, negocios) no contienen ganada, importe, comisión, cobrado, 150000, 40000, las notas de Administración, la recompra, la negociación ni sus fechas. El comercial ve solo la recompra abierta, con origen «Administración». |
| El CRM no escribe Finanzas ni Empresas | Conteos de `fin_*` y huellas de `empresa_campanias` y `empresa_codigos` idénticos antes y después. |

**Hallazgos.** No hubo defectos del producto en el recorrido principal. Dos tropiezos fueron de la
automatización, no del producto, y se rehicieron por la vía real:
- un clic cayó en «¿Tiene WhatsApp?» en lugar de «¿Decide la compra?»;
- en el cierre de jornada, «Sin gasto» quedó en el campo equivocado.

Mejoras opcionales, **no hechas** porque no son defectos:
- recordatorios o avisos de próximas acciones;
- identidad individual dentro de Administración;
- cola sin conexión en el celular;
- comparación contra el período anterior y exportación en Métricas.

## 7. Condiciones comerciales

### 7.1 Definidas (vigentes desde el 31/10/2026)

Las fijó el owner y están en la guía comercial vigente. Ya **no** son decisiones pendientes. Que
estén documentadas acá **no significa que el sistema las ejecute**: la tabla del final de esta
sección dice qué hace cada parte y qué queda a cargo del personal.

**Packs**

| Pack | Experiencias | Precio |
|---|---|---|
| Pack 10 | 10 de 20 minutos | $ 150.000 |
| Pack 25 | 25 de 20 minutos | $ 360.000 |
| Más de 25 | cantidad a medida | cotización personalizada de Administración |

Son los importes aprobados. El CRM no les agrega IVA: el tratamiento fiscal sigue pendiente (§7.3).

**Pago, activación y vigencia**
- 50% al confirmar.
- 50% contra entrega de las tarjetas.
- El pack se activa al entregar las tarjetas, con el 100% cobrado.
- La vigencia es de 60 días desde la activación.

**Tarjetas y código**
- **Un código común por pack (campaña)**, compartido por las tarjetas de ese pack. No es un mismo
  código para todas las empresas: cada pack tiene el suyo.
- Cada tarjeta representa una experiencia de 20 minutos.
- Para usar la experiencia hay que presentar la tarjeta física.
- El cupo total corresponde a las experiencias compradas.

**Transferencia, promociones y prohibición de reventa**
- Las experiencias son transferibles para que la empresa las entregue como:
  - regalos;
  - beneficios para clientes o empleados;
  - premios por compra;
  - sorteos;
  - incentivos;
  - parte de acciones promocionales y comerciales.
- **No está permitida la reventa.** La empresa no puede vender las experiencias por separado ni
  comercializarlas como turnos propios de SIM.
- Incluir una experiencia como premio o beneficio dentro de una promoción está permitido. Venderla
  como producto independiente, no.
- La frase de la guía comercial **«No pueden revenderse» es correcta y se conserva**.
- Este repositorio nunca registró una autorización de reventa: se revisó entero el 31/10/2026.
  Cualquier «reventa permitida» de un mensaje o material anterior queda reemplazada por esta
  condición (ver §10).

**Qué ejecuta el sistema y qué queda a mano**

| Condición | El CRM (registra y consulta) | Empresas (ejecuta) | A cargo del personal |
|---|---|---|---|
| Precios | Catálogo con Pack 10 y Pack 25 a esos importes y su comisión de lista; el personalizado (desde 26) se carga a mano. | La campaña tiene su propio precio neto más IVA (21% por defecto) y no toma el del CRM. | Cargar el precio de la campaña según el tratamiento fiscal que se defina. |
| 50% y 50% | El anticipo esperado (50%) es una referencia. El estado de cobro se deriva de los cobros cargados. La comisión queda «Prevista» hasta el 100%. | El estado de pago es binario (pendiente o pagado), sin parciales. | Cargar cada cobro en el CRM. Marcar la campaña pagada en Empresas **solo** con el 100% cobrado. |
| Activación al entregar, con el 100% | La entrega es una marca manual con fecha: no activa nada y no exige el 100%. Si Empresas y el CRM no coinciden en el cobro, lo avisa. | El código es canjeable solo con la campaña pagada y `fecha_inicio` ≤ hoy. | Al entregar: confirmar el 100%, marcar la entrega en el CRM, marcar pagada la campaña y poner `fecha_inicio` = día de entrega. |
| Vigencia de 60 días | Muestra el vencimiento de la campaña vinculada (o «Sin definir»); no lo calcula. | Compra única: vencimiento = `fecha_inicio` + 60 días (la mensual daría 30). | Elegir «Compra única». |
| Código común, cupo y tarjeta física | Solo lee la campaña. | Hoy no tiene una configuración correcta para el código común (§9). | Revisar la tarjeta en el stand. |
| Transferencia y no reventa | No registra a quién se entregan las experiencias. | Guarda nombre y contacto de quien reserva, sin relación con la empresa compradora. | Comunicar la condición a la empresa. Detectar una reventa es tarea del personal. |

Ninguna activación es automática: no la dispara ni la entrega de las tarjetas ni el cobro del
saldo.

### 7.2 Movilidad

La guía comercial vigente establece:
- SIM cubre la movilidad comercial.
- La estimación inicial es de hasta dos tanques mensuales, ajustable según el auto y los recorridos.
- Los estacionamientos y peajes comerciales se registran aparte.
- Las multas y los gastos personales no corresponden a SIM.

Eso es la **condición**. El **procedimiento de liquidación** todavía no está definido:
- quién aprueba;
- cada cuánto se liquida;
- con qué comprobantes;
- por qué medio se paga;
- cómo se ajusta la estimación;
- qué admite el campo «otros».

En el CRM, hoy:
- **Registro:** cada jornada guarda por separado km, combustible (cantidad e importe),
  estacionamiento, peajes y otros. El tablero muestra la «movilidad registrada» sin restarla de
  nada.
- **La estimación de dos tanques es solo una referencia:** no es un importe fijo, ni un cupo
  automático, ni una autorización ilimitada de gastos.
- **No hay efectos en otros módulos:** no se generan reintegros ni movimientos en Finanzas, y las
  fórmulas del tablero no cambian.
- **Multas y gastos personales:** no se cargan en «otros». Es una indicación para Tobías; el CRM
  no lo valida.

### 7.3 Siguen pendientes

| Pendiente | Qué afecta | Qué hace hoy el sistema |
|---|---|---|
| **Tratamiento fiscal e IVA** | Si los importes incluyen IVA; el comprobante; la base de la comisión; el precio de la campaña en Empresas; la futura integración con Finanzas. | El CRM guarda el importe como acuerdo comercial, sin IVA. Empresas propone 21% de IVA sobre su propio precio. No se agrega IVA automáticamente ni se cambian los importes aprobados. |
| **Devoluciones reales de dinero** | La posventa, una comisión ya pagada, las métricas y Finanzas. | Fuera de alcance. Anular un cobro o una venta corrige una carga; no devuelve dinero. Tampoco lo devuelve **cancelar o reprogramar una reserva** de Empresas, con o sin liberar el uso: eso mueve o libera una experiencia, y la compra corporativa sigue igual. |
| **Procedimiento de liquidación de la movilidad** | El pago a Tobías y la futura contribución comercial. | Ver §7.2. |

También siguen pendientes la caja y la contribución comercial (diseno.md, corrección 6) y la
integración con Finanzas, que no se empezó.

## 8. Qué resolver y cuándo

**Antes de publicar el CRM**
1. Autorización del owner y los pasos de §4: variable en Vercel, los cuatro SQL, el control de
   solo lectura y el merge.
2. Si `main` avanzó, volver a comparar y repetir las pruebas (§4, puntos 1–3).
3. Después de publicar y antes de la primera jornada: crear el usuario real de Tobías y probarlo
   en su teléfono real. El QA fue con emulación.

Ninguna condición comercial bloquea la publicación. Prospección, seguimiento y métricas funcionan
con lo definido en §7.1 y con los pendientes de §7.3 abiertos. El código común tampoco la bloquea:
el CRM solo lee la campaña vinculada.

**Antes de ofrecer y vender experiencias reales**
1. **Tratamiento fiscal e IVA.** Tobías tiene que poder responder si $150.000 y $360.000 incluyen
   IVA y qué comprobante recibe la empresa.
2. **Qué se le dice al cliente sobre devoluciones.** La forma de registrarlas en el sistema puede
   esperar a la primera devolución real; la respuesta al cliente, no.
3. **Las tarjetas se imprimen antes de la entrega** (definido el 31/10). Con B8, el código común se
   genera antes del pago (§9).

**Antes de entregar experiencias reales (la primera entrega de un pack)**
1. **Publicar Empresas B8** (§9 y el documento de B8). Sin B8, con un código común el cupo se
   multiplica o se muestra mal, y una reserva de varios simuladores consume un solo uso.
2. **El procedimiento de entrega del personal (§7.1):**
   - cobrar el saldo;
   - marcar la entrega en el CRM;
   - en Empresas, marcar pagada la campaña y cargar `fecha_inicio` = ese día;
   - revisar la tarjeta en el stand.

**Orden de publicación con B8:** primero Empresas B8 (su SQL y después su código, en `main`);
después el CRM desde `integracion-crm-b8`, siguiendo §4. El CRM de esta rama lee `codigo_comun` y
`experiencias`, así que necesita B8 aplicado antes.

**Antes de la primera liquidación con Tobías**
1. El procedimiento de liquidación de la movilidad (§7.2).

## 9. Código común: Empresas B8 y el vínculo del CRM

**Antes de B8** ninguna configuración de Empresas daba a la vez un solo código, el cupo correcto
y pantallas correctas:
- 1 código × 10 usos se mostraba como «1 turno»;
- 10 × 10 multiplicaba el cupo;
- además, un canje de varios simuladores consumía un solo uso.

**Empresas B8** lo resuelve en la rama `empresas-codigo-comun` (`719c6e2`, `86f5e8b`, `15406f9`).
Está sin publicar; el detalle, en `docs/empresas-b8-codigo-comun.md` de esa rama. Esta rama de
integración (`integracion-crm-b8`) la combina con el CRM.

| Requisito | Estado con B8 | Cómo |
|---|---|---|
| Un código común por pack (10, 25 o personalizado), experiencias de 20 min | **Soportado** | Marca «Código común»: un código con `usos_maximos = cantidad_contratada`. 20 minutos: modalidad `v2_10`. |
| Una reserva de varios simuladores consume esa cantidad | **Soportado** | Un uso por simulador (`empresa_codigo_usos.experiencias`); si no alcanza el cupo, se rechaza sin consumir. |
| Reservas simultáneas sin pasar el cupo | **Soportado** | Código `FOR UPDATE` + CHECK `usos_actuales <= usos_maximos`. Probado: 12 de 1 simulador sobre 10 → 10; mezcla de 4 y de 1 ≤ 10. |
| Cancelaciones y reintentos sin duplicar | **Soportado** | La reserva se toma `FOR UPDATE`; una ya cancelada no toca nada. Con «liberar» vuelve lo de esa reserva una vez; sin «liberar», nada. |
| Código generado antes del pago, bloqueado hasta el 100% y la entrega | **Soportado, con dos registros manuales** | Se genera sin pago y sin fechas. Canjea solo con la campaña pagada (100%) y `fecha_inicio` (entrega) ≤ hoy, y en un pack esa fecha se carga recién pagada. |
| 60 días desde la activación | **Soportado** | Vencimiento = `fecha_inicio` + 60; generar no fija fechas. |
| Campañas existentes | **Sin cambios** | La marca nace en falso y sus usos valen 1. La única campaña de Producción (1 uso por código, cancelada) no cambia. |
| Pantallas, informes y CRM | **Corregidos** | Experiencias compradas, usadas (descontadas del cupo: reservas vigentes y canceladas sin liberar) y disponibles. Las canceladas sin liberar se muestran además como **retenidas**; una cancelada liberando no cuenta. Verificado: Pack 10, reserva de 2 cancelada sin liberar → 2 usadas (2 retenidas), 8 disponibles, igual tras reintentar con «liberar». El CRM las lee sin beneficiarios ni códigos. |
| Tarjeta física | **Manual** | El sistema no la valida: la revisa el personal en el stand. |

**Permisos:** en la cadena del repositorio, `cancelar_reserva_empresa` (SECURITY DEFINER) era
ejecutable por `anon` y `authenticated`. **En Producción no**: la consulta de solo lectura del
31/10/2026 da que solo `postgres` y `service_role` ejecutan las cinco funciones de canje. B8 deja
la réplica igual a Producción.

**Quién hace qué**
1. **El CRM registra y consulta:**
   - la venta, sus cobros 50/50, la comisión y la entrega con fecha;
   - la campaña vinculada, en solo lectura: estado, pago en Empresas, tipo de código, experiencias
     y vencimiento;
   - avisos de cantidad, duración y cobro. Por ejemplo, avisa si el CRM ya tiene el 100% y Empresas
     sigue pendiente.

   No crea campañas ni códigos, no activa nada y no valida tarjetas.
2. **Empresas ejecuta:** la campaña, el código, el canje atómico, el vencimiento, la cancelación y
   la reprogramación, y los informes.
3. **Queda a cargo del personal:**
   - crear la campaña con «Código común», compra única y 20 minutos;
   - generar el código e imprimir las tarjetas;
   - al entregar con el 100%, marcar pagada y cargar `fecha_inicio`;
   - registrar cobros y entrega en el CRM y vincular la campaña;
   - revisar la tarjeta física;
   - decidir si una cancelación libera la experiencia.

## 10. Materiales fuera del repositorio

Estas actualizaciones quedan pendientes; no se tocaron:
- **Guía comercial vigente** (no está en el repositorio):
  - conservar «No pueden revenderse»;
  - si alguna lista de supuestos errores de la guía la incluye, retirarla de esa lista (en el
    repositorio no hay ninguna);
  - quitar cualquier «reventa permitida» de mensajes o materiales anteriores.
- **Material para la empresa cliente y las tarjetas**, si existe: tiene que coincidir con §7.1.
  Es decir: código común del pack, tarjeta física para usar la experiencia, 60 días desde la
  entrega, transferencia permitida y reventa prohibida.

En el repositorio no hay páginas públicas ni textos con condiciones de los packs corporativos,
fuera de esta documentación.
