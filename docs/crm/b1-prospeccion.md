# CRM B2B · B1 — Prospección y visitas

La administración carga y asigna negocios; Tobías abre su jornada, busca o crea el negocio,
registra la visita desde el celular y, si consigue un contacto útil, queda una oportunidad
para el seguimiento. Puede dejar una revisita y cierra la jornada con km y gastos, que pueden
quedar pendientes.

Estado: **B1 implementado y verificado solo en el entorno local aislado del CRM. Sin migrar,
sin publicar y sin cambios en Vercel.** Diseño general: [diseno.md](diseno.md). Identidad y
sesión comercial: [b0-identidad.md](b0-identidad.md).

B1 **no** incluye bandeja de seguimiento, negociación, ventas, cobros, comisiones, campañas o
códigos de Empresas ni tablero (B2–B4). No cambia reglas ni datos de Turnero, Reservas, Gift
Cards, Empresas, Mensualidades, Colectivo, Finanzas, Marketing ni Cupones.

## Pantallas

### Interfaz comercial (`/comercial`, celular primero)

| Pantalla | Qué hace |
|---|---|
| `/comercial` (inicio) | Jornada activa (abrir, km y gastos, cierre), botón grande **+ Registrar visita**, revisitas pendientes, visitas de hoy, accesos a Mis negocios y Mis jornadas. Avisa si quedó abierta una jornada de ayer o anterior. |
| `/comercial/visitas/nueva` (`?negocio=` opcional) | Formulario de visita. Se habilita con una jornada abierta de hoy o de ayer; con una más vieja pide cerrarla. |
| `/comercial/negocios`, `/comercial/negocios/nuevo`, `/comercial/negocios/[id]` | Sus negocios (asignados o creados por él), alta con aviso de duplicados, ficha con contactos, oportunidad, revisita y visitas (puede agregar notas). |
| `/comercial/jornadas`, `/comercial/jornadas/[id]` | Sus jornadas, km y gastos pendientes, visitas de cada jornada. |

### Administración (`/admin/crm`, solo admin)

| Pantalla | Qué hace |
|---|---|
| `/admin/crm/negocios` | Lista con búsqueda y filtros (responsable o sin asignar, rubro o «sin rubro de la lista», zona, prioridad, estado, archivados, posibles duplicados) y alta con responsable y cliente previo. |
| `/admin/crm/negocios/[id]` | Ficha: edición (incluye responsable y cliente previo), archivo con motivo, contactos, oportunidad con su origen, revisita, visitas con notas, corrección y anulación, y «Registrar visita realizada por un comercial». |
| `/admin/crm/jornadas`, `/admin/crm/jornadas/[id]` | Jornadas de todos (filtros por comercial, fechas, estado y pendientes), carga de una jornada ya realizada, completar km/gastos y cerrar. |
| `/admin/crm/configuracion` | Usuarios comerciales (B0) y rubros y zonas (alta, renombrar, activar/desactivar). |

El menú del panel lleva a `/admin/crm/negocios`. Dentro de `/comercial` se navega con
`<Link>` solo hacia el área; se sale con navegación de documento (`lib/crmAuth.test.ts` lo
controla).

### Formulario de visita

Negocio (buscar entre los suyos o «Nuevo negocio: «…»» con nombre, rubro o rubro no listado,
dirección y zona —la de la jornada por defecto—) → **¿Qué pasó?** (hechos que conviven:
*cerrado / no atendieron*, *habló con empleado*, *habló con responsable*, *el responsable no
estaba*; «cerrado» excluye los demás) → **Contacto** opcional (uno existente o uno nuevo; en
un negocio nuevo se abre directo el alta) con *contacto útil para seguimiento* y *hablé con
esta persona* → **Interés** (sin elegir = no evaluado; *sin interés*, *frío*, *tibio*,
*caliente*) → **Necesidades y pack** (varias necesidades, *Otra* con texto; pack 10, 25,
personalizado o no determinado) → **Volver otro día** (mañana, en 3 días, en una semana, una
fecha o sin fecha) → observación → **Guardar visita** (barra fija abajo).

Al guardar se muestra «Visita guardada» con lo que pasó (negocio creado, contacto guardado,
lead creado o actualizado, revisita) y el formulario queda vacío para la siguiente.

## Base de datos

`db/crm-b1-prospeccion.sql`, en `db/orden.txt` sección 13h, **después de**
`crm-b0-identidad.sql` (usa `crm_usuarios` y `crm_auditoria`). Idempotente: se puede aplicar
de nuevo sin efectos. Verificación: `db/crm-b1-prospeccion.verificacion.sql` (corre en un
bloque que se deshace entero; resultado `RESULTADO CRM-B1|OK 110`).

| Tabla | Contenido |
|---|---|
| `crm_rubros`, `crm_zonas` | Catálogos con nombre normalizado único, `activo`, `orden`, `version`. 14 rubros iniciales (incluye Peluquerías). No se borran: se desactivan. |
| `crm_empresas` | Negocio: nombre comercial (obligatorio) y normalizado, rubro **o** descripción libre de un rubro no listado, dirección (y normalizada), zona, Instagram, web, prioridad A/B/C, responsable, `cliente_previo`, `origen` (`manual`, `visita`, `importacion`) con `origen_ref` único para una importación futura, `similar_a` (duplicados confirmados como distintos), archivo con motivo, versión y autor. |
| `crm_contactos` | Varios por negocio: nombre, cargo, **un** teléfono tal como se escribió más su forma normalizada (6–15 dígitos), `tiene_whatsapp` (nulo = no sabemos), `es_decisor` (`si`/`no`/`no_sabe`), archivo. Sin unicidad por teléfono. |
| `crm_jornadas` | Jornada del comercial: fecha de negocio (Córdoba), nombre, zona, km inicial/final y `km_recorridos` calculado, combustible (cantidad + unidad `litros`/`m3`) e importes de combustible, estacionamiento, peajes y otros. Una sola abierta por comercial; varias por día. |
| `crm_visitas` | Hechos de la visita, contacto, interés, necesidades, pack, revisita, autor real (`realizada_por_usuario`) y quién la cargó (`registrada_por_*`), `ocurrida_en` y `fecha`, clave de idempotencia y huella, anulación. |
| `crm_oportunidades` | Lead del negocio: estado `contacto`/`interesado`, visita y comercial de origen, contacto, `lead_en`, `interesado_en`, cierre (solo `origen_anulado` en B1). Una abierta por negocio (índice único parcial). |
| `crm_visita_notas` | Observaciones posteriores sobre una visita. |
| `crm_tareas` | Revisitas: una pendiente por negocio (índice único parcial), vencimiento opcional, estado `pendiente`/`hecha`/`cancelada`. |

Todo lo escribe **solo** el servidor por RPCs `SECURITY DEFINER` con `search_path = public`;
RLS activa sin políticas; `service_role` solo tiene `SELECT` sobre las tablas y `EXECUTE` sobre
las RPCs públicas; `anon` y `authenticated`, nada. Las funciones internas (normalización,
lectores de JSON, bloqueo del negocio, inserciones) no tienen `EXECUTE` para nadie.

RPCs: `crm_catalogo_guardar`, `crm_empresa_crear`, `crm_empresa_actualizar`,
`crm_empresa_archivar`, `crm_contacto_crear`, `crm_contacto_actualizar`, `crm_jornada_crear`,
`crm_jornada_actualizar`, `crm_visita_registrar`, `crm_visita_corregir`, `crm_visita_anular`,
`crm_visita_nota_agregar`, `crm_tarea_actualizar`. Todas reciben el actor verificado por el
servidor (`p_actor_rol`, `p_actor_usuario`), validan claves permitidas, versión (concurrencia
optimista) y dejan auditoría con campos explícitos en `crm_auditoria` (sin teléfonos).

### Aplicación futura (no ejecutada)

1. `crm-b0-identidad.sql` (si todavía no está) y luego `crm-b1-prospeccion.sql`, en ese orden.
2. Correr `crm-b1-prospeccion.verificacion.sql` y exigir `OK`.
3. Recién entonces publicar la aplicación. B1 no necesita variables nuevas además de las de B0.

## Permisos

| Acción | Comercial | Admin |
|---|---|---|
| Ver y editar negocios | Solo los asignados a él (incluye los que creó), no archivados | Todos |
| Asignar responsable, marcar cliente previo, archivar | No (403) | Sí, con motivo para archivar |
| Contactos | En sus negocios | En todos |
| Jornadas | Abrir la suya (fecha = hoy), completar km/gastos y cerrar las suyas | Ver todas, cargar una ya realizada para un comercial, completar y cerrar |
| Registrar visitas | En su jornada abierta, en sus negocios; autor y hora los pone el servidor | Para un comercial, en una jornada de ese comercial, con hora indicada |
| Notas sobre visitas | Sobre sus visitas en sus negocios, **sin ventana de tiempo** | Sobre cualquiera |
| Corregir y anular visitas | No | Sí, con motivo y auditoría |
| Revisitas | Reprogramar o cancelar (con motivo) las suyas | Todas |
| Catálogo de rubros y zonas | Solo lee los activos | Administra |

La ventana de 48 h propuesta en el diseño **no** se adoptó: Tobías no edita ni anula visitas;
agrega notas cuando quiera, y lo que esté mal lo corrige o anula la administración.

Cada lectura y escritura aplica el alcance con el actor de la sesión: un ID ajeno (negocio,
contacto, jornada, visita, revisita) responde 404, igual que uno inexistente. A un comercial
nunca se le devuelve el nombre ni el ID de otro comercial («Otro comercial»), ni contactos,
direcciones o IDs de negocios ajenos. Rutas: `/comercial/api/*` (solo comercial; admin y staff
reciben 403) y `/api/admin/crm/*` (solo admin; staff 403, cookie comercial 401). Mutaciones
con control de origen, límite por IP y tamaño máximo.

## Contacto útil y oportunidad

- **Persona contactada** (`hablo_con_contacto`): hablaste con esa persona en la visita.
- **Contacto obtenido** (`contacto_obtenido`): conseguiste cómo contactarla para el
  seguimiento, aunque no hayas hablado con ella (por ejemplo, el empleado te dio el teléfono
  del dueño). No hace falta que sea quien decide.
- **Contacto útil** (`contacto_util`, calculado): contacto obtenido **y** teléfono con canal
  utilizable (8 a 15 dígitos una vez normalizado). Si se marca «contacto útil» sin teléfono, la
  visita se rechaza (`contacto_sin_canal`) y no se guarda nada.
- **Decisor contactado** (`decisor_contactado`, calculado): hablaste con un contacto marcado
  como decisor. Ambos se guardan como foto del momento de la visita.

Una oportunidad se crea **solo** cuando una visita deja un contacto útil y el negocio no tiene
otra abierta. Cargar un negocio, una visita sin contacto, «cerrado» o un interés sin contacto
útil no crean lead ni interés.

- Estado inicial: `interesado` si el interés de esa visita es tibio o caliente; si no,
  `contacto` (también con interés no evaluado o «sin interés»).
- Visitas posteriores **no** crean otra oportunidad: se ligan a la abierta y solo la hacen
  avanzar (`contacto` → `interesado` con tibio/caliente). Un «sin interés» posterior no la
  hace retroceder.
- **Atribución del lead**: `origen_visita_id` y `origen_usuario_id` quedan fijos al crearla.
  No cambian por visitas posteriores (de él o de otro comercial) ni por reasignar el negocio.
  Solo una anulación administrativa del origen la mueve, de forma explícita y auditada.
- Si la administración carga la visita, el origen es quien la **realizó**, no quien la cargó.

## Reintentos, concurrencia y respuestas inciertas

- Cada visita lleva una **clave** (UUID generado al empezar el borrador) y una **huella**
  SHA-256 que calcula el servidor sobre el contenido normalizado (nunca la manda el
  navegador). Con la misma clave: mismo contenido y mismo actor → devuelve la misma visita
  (`repetida`, 200); otro contenido u otro actor → `clave_reutilizada` (409). Un aviso de
  posible duplicado no escribe nada ni consume la clave.
- `crm_visita_registrar` es atómica: negocio nuevo, contacto nuevo, visita, oportunidad,
  revisita y auditoría se guardan juntos o no se guarda nada. Toma un candado consultivo por
  clave, bloquea la jornada y **bloquea la fila del negocio** (`FOR UPDATE`) antes de buscar la
  oportunidad abierta; el índice único parcial es la segunda barrera.
- **Respuesta incierta** (sin conexión o error 5xx): el formulario queda bloqueado con el aviso
  «No sabemos si se guardó», conserva el borrador con la misma clave y ofrece **Reintentar
  guardado** (si había llegado: «Este envío ya había llegado: no se duplicó») o **Descartar**.
  No hay cola sin conexión.
- **Borradores**: en `localStorage` del dispositivo, por usuario autenticado
  (`crm-borrador-visita:<id>`); se recuperan al volver al formulario y se borran al guardar, al
  descartar y al cerrar sesión. La administración no guarda borradores.
- Concurrencia demostrada (ver Pruebas): 8 visitas simultáneas con contacto útil al mismo
  negocio dejan **una** oportunidad; la misma carrera sin el bloqueo ni el índice deja 8.

## Jornadas, medianoche y pendientes

- Fecha de negocio en Córdoba (`crm_fecha_sim`, nunca la fecha UTC). La jornada nunca se
  cierra sola. Una visita entra en una jornada si su fecha es la de la jornada o el día
  siguiente (una salida que pasa la medianoche).
- La jornada de ayer que quedó abierta se puede seguir usando (con aviso) o cerrar; una más
  vieja no recibe visitas: se cierra (sin inventar km) y se abre la de hoy. Sus visitas no se
  reasignan solas; si una quedó en la jornada equivocada, la administración la corrige.
- **Kilómetros y gastos**: `NULL` = sin cargar, `0` = cero confirmado («Sin gasto (0)»). No se
  aceptan negativos ni km finales menores que los iniciales; el combustible exige unidad.
  Se pueden completar con la jornada abierta o cerrada; la lista de jornadas muestra qué falta
  y la administración filtra por pendientes.

## Correcciones, anulaciones y archivo

- **Corregir** (admin, con motivo): interés, necesidades, «Otra», pack, observación y jornada
  (de la misma persona y fecha compatible). La oportunidad se recalcula a partir de sus visitas
  vigentes (acá sí puede bajar a `contacto`). Lo que cambia el resultado o quién obtuvo el
  contacto no se corrige: se anula y se registra de nuevo.
- **Anular** (admin, con motivo): la visita deja de contar y desaparece de la vista comercial;
  la administración la sigue viendo anulada. Si era el origen de una oportunidad abierta hay
  que elegir en la misma operación: **cerrar la oportunidad** (`origen_anulado`, no se borra) o
  **reasignar el origen** a otra visita vigente con contacto útil de esa oportunidad. Las
  revisitas que creó se cancelan y la que había resuelto vuelve a pendiente. Si la visita había
  creado el negocio o el contacto, estos quedan (se archivan aparte si hace falta).
- **Archivar** un negocio (admin, con motivo): sale de las listas y de la interfaz comercial;
  su historia (visitas, contactos, oportunidad) se conserva y no recibe visitas nuevas.
  Desarchivar lo devuelve.
- **Duplicados**: al crear (desde la ficha o desde la visita) se avisa si hay negocios con el
  mismo nombre normalizado, uno prefijo del otro (4+ letras) o la misma dirección. Del propio
  se muestra todo y se puede elegir; del ajeno, solo nombre, zona, rubro y «asignado a otra
  persona». Se puede crear igual («es otro negocio»); nunca se fusiona y la administración lo ve
  en «posibles duplicados».

## Pruebas

| Prueba | Qué cubre | Resultado |
|---|---|---|
| `db/crm-b1-prospeccion.verificacion.sql` | Privilegios, funciones internas sin `EXECUTE`, catálogo y normalización (incluye mayúsculas acentuadas), medianoche, negocios y duplicados, contactos, jornadas, visitas, idempotencia, IDs cruzados, anulación, corrección y auditoría | OK 110 |
| `lib/crmB1.test.ts` (puro) | Armado de la visita (claves permitidas, autor/hora solo admin), huella canónica, normalización, errores sin detalles de Postgres, pendientes de jornada, borradores por usuario | OK |
| `lib/crmB1.integration.ts` | Por las rutas reales: privilegios, actores, alcance e IDs cruzados, negocios sin lead, rubro no listado, duplicados sin fugas, teléfono compartido, jornadas (NULL ≠ 0, varias por día, la de ayer), visitas (hechos, interés no evaluado ≠ sin interés, empleado que da el teléfono del dueño, estados hacia adelante, revisitas, atomicidad), idempotencia y reintentos simultáneos, **carrera real con control negativo**, medianoche, visita cargada por admin, reasignación con atribución intacta, corrección, anulación, archivo, auditoría sin teléfonos y ninguna respuesta con datos de otro comercial | OK |
| `lib/crmAuth.test.ts`, `crmRegresionPanel.test.ts`, pruebas puras de B0 y `crmB0.integration.ts` | Regresión de B0 y navegación del área | OK |

Las suites que escriben corren solo en la instancia aislada:
`node scripts/pruebas/crm-local.mjs suite lib/crmB1.integration.ts` (guardián como primera
importación). La carrera abre una ventana de 1 s antes del commit de la oportunidad (dentro
de la auditoría) para que las transacciones compitan de verdad; el control quita el bloqueo y
el índice, comprueba que aparecen duplicados y **restaura todo reaplicando la migración**
(la suite verifica después el índice, el `FOR UPDATE` y que no quede ninguna espera).

## QA móvil (375×812, emulación de Chrome)

Servidor de producción local (`crm-local.mjs next start`) contra la instancia aislada, con un
comercial de prueba. Los tiempos «técnicos» son mediciones en la página; los totales de la
automatización incluyen la demora de cada paso de la herramienta (≈ 4–10 s entre pasos que no
van en el mismo lote) y **no** representan a una persona. Ninguna cifra mide a un usuario real.

| | Recorrido 1: negocio existente, «cerrado» | Recorrido 2: negocio nuevo + contacto + interés + 2 necesidades + pack |
|---|---|---|
| Toques | 4 | 18 (era 19 antes de la corrección del contacto) |
| Campos con escritura | 0 | 3: nombre del negocio, nombre del contacto, teléfono (33 caracteres) |
| Guardar → «Visita guardada» (medido) | 62 ms (POST 45 ms) | 174 ms (POST 166 ms) |
| Total observado de la automatización | 19,2 s | 47,2 s (la primera corrida, 111,5 s, incluyó pausas de inspección) |
| Uso humano (**estimación**) | ≈ 8–12 s | ≈ 40–55 s |

La estimación supone ≈ 1,2–1,5 s por toque, ≈ 2–3 caracteres/s en el teclado del celular y
≈ 10 s de lectura, decisiones y 2–3 desplazamientos. Queda bajo el minuto, pero el recorrido 2
está cerca del límite: el teléfono y los nombres son lo que más tiempo lleva.

Comprobado además:
- Confirmación clara (qué se creó: negocio, contacto, lead y su estado) y formulario vacío al
  volver a registrar (sin selecciones, sin texto, sin borrador).
- En la base: un negocio (origen visita, asignado al comercial), un contacto con teléfono
  original y normalizado, una visita ligada a la jornada, al contacto y a la oportunidad, y una
  oportunidad `interesado` con origen y atribución correctos.
- Reenviar el mismo POST → 200 «repetida» con la misma visita; con el contenido cambiado → 409;
  respuesta perdida tras guardar → «Reintentar» → «no se duplicó» y una sola visita.
- Borrador recuperado tras recargar; una sección de contacto abierta y vacía se guarda como
  «sin contacto».
- Controles de 44 px o más (36 de 36); campos de 16 px (sin zoom al enfocar en iOS); textos de
  14–16 px, ayudas secundarias de 12 px; sin desborde horizontal.

Fricciones encontradas y corregidas:
1. **La barra fija de Guardar tapaba el campo enfocado** cuando el teclado achica la pantalla
   (simulado con 375×480 y alineando el campo al borde inferior: 7 de 8 campos tapados). Ahora
   los controles tienen margen de desplazamiento: 8 de 8 campos y 18 de 18 chips quedan
   visibles.
2. **Un toque de más en el contacto de un negocio nuevo** («Nuevo contacto» cuando no hay
   contactos para elegir). Ahora abrir «Contacto» en un negocio nuevo arranca el alta con el
   foco en «Nombre», y una alta vacía no bloquea el guardado.

Límites del QA: emulación en Chrome de escritorio (no un teléfono real, sin teclado virtual
real; el teclado se simuló reduciendo el alto), red local (en 4G cada guardado suma cientos de
ms) y capturas poco fiables con el panel oculto (el diseño se verificó por geometría del DOM).

## Datos en el entorno local del CRM

La instancia aislada (`sim-web-crm-local`) conserva, para seguir desarrollando, un comercial de
prueba, tres zonas, seis negocios (tres sembrados y tres creados en el QA), sus contactos,
visitas, una jornada abierta y dos oportunidades. Son datos ficticios y solo existen ahí; la
contraseña del comercial de prueba no se guardó (se restablece desde Configuración). Las
suites automáticas limpian sus propios datos. Para empezar de cero:
`node scripts/pruebas/crm-local.mjs esquema --reset` (vacía solo esa instancia).

## Limitaciones y alcance reservado

- Sin cola sin conexión: sin red no se guarda; el borrador y el reintento evitan pérdidas y
  duplicados, pero hace falta volver a tener conexión.
- La administración sigue siendo la credencial compartida del panel («Administración»).
- La jornada de una visita la elige el comercial implícitamente (la abierta); si quedó mal, la
  corrige la administración.
- El aviso de duplicados es heurístico (nombre, prefijo, dirección); puede dejar pasar
  duplicados escritos muy distinto.
- No hay importador (el modelo lo admite con `origen = 'importacion'` y `origen_ref`).
- **B2**: bandeja de seguimiento, transiciones de la oportunidad más allá de `interesado`
  (negociación, ganada, perdida), tareas generales y recordatorios. **B3**: ventas, cobros y
  comisiones. **B4**: métricas y tablero.
