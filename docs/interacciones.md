# Interacciones del stand

Registro de lo que pasó con cada **visita espontánea** al stand, para medir cuántas
terminan en consultas y en personas que se suben. Se carga **después** de atender: nunca es
un paso previo para vender, cobrar, cargar un turno ni subir a nadie. El Turnero sigue
funcionando igual.

Estado:

- Versión local completa: base de datos (Bloque 1), servidor y API (Bloque 2), pantalla del personal (Bloque 3), métricas (Bloque 4) y dashboard de admin (Bloque 5).
- Verificada en el stack local de pruebas.
- **Nada está aplicado en Producción, ni migrado, ni desplegado.**
- Para lanzarla, ver [Lanzamiento](#lanzamiento-guía-no-ejecutada).

Archivos y pruebas:

- Esquema, vistas y RPCs: `db/interacciones-bloque1.sql` (un solo archivo; está en `db/orden.txt`)
- Verificación sin huella: `db/interacciones-bloque1.verificacion.sql`
- Concurrencia y permisos reales (solo local): `node scripts/pruebas/interacciones-bloque1.mjs`
- Contrato puro (validación, ventanas, errores): `lib/interacciones.ts` · pruebas: `npx tsx lib/interacciones.test.ts`
- Acceso de servidor: `lib/interaccionesServer.ts` · piezas HTTP: `lib/interaccionesHttp.ts`
- Rutas reales contra el stack local: `node scripts/pruebas/correr-mutantes.mjs lib/interacciones.integration.ts`
- Métricas puras: `lib/interaccionesMetricas.ts` · pruebas: `npx tsx lib/interaccionesMetricas.test.ts`
- Carga paginada de métricas: `lib/interaccionesMetricasServer.ts` · integración: `node scripts/pruebas/correr-mutantes.mjs lib/interaccionesMetricas.integration.ts`
- Pantalla del personal: `app/admin/(panel)/interacciones/` · dashboard: `app/admin/(panel)/interacciones/analisis/`

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Atribución | "Atendió" es **opcional y declarado**: se elige entre empleados activos y se muestra como declarado. El cronograma puede sugerir candidatos, nunca asignarlos. No hay PIN ni cambio de login. Registrador (solo su rol), atendió e iniciador (cliente/empleado) son tres datos distintos. |
| 2 | Reservas web | Fuera del embudo del stand: no se vinculan ni se cierran como conversión. El embudo mide visitas espontáneas registradas, no toda la actividad del Turnero. |
| 3 | Varios turnos | Sí, hasta **4** por interacción (límite de esta versión). Un turno pertenece a una sola interacción. |
| 4 | Ventanas del staff | Carga desde el **día calendario anterior** (Córdoba) al del alta. Edita, anula y desvincula hasta **48 h exactas** después del alta. Vincular una pendiente no tiene ventana. Admin corrige siempre, desde el inicio del registro. |
| 5 | Turnos gratis | Cuentan en la cobertura y se distinguen de los pagos. "Se subió" es una experiencia, no una venta. **Venta verificada** = al menos un turno **pago** vinculado; una pendiente nunca la verifica. |
| 6 | Inicio del registro | El lanzamiento real en Producción. Se configura (`interacciones_definir_inicio`) en hora de Córdoba. Nunca se infiere de la migración, de una prueba ni de la primera fila. Sin inicio no se puede registrar. Nada se reconstruye desde ventas. |
| 7 | Cerrar sin vínculo | Solo admin, con motivo obligatorio (`sin_turno_en_turnero`, `turno_no_identificable`, `otro` + nota). Sigue siendo una subida **declarada**. Vincular después retira el cierre. |
| 8 | Turnero | No cambia. "Interacciones" va debajo de "Turnero" en el menú; desde Interacciones puede haber "Ir al Turnero". |

## Modelo

- **`interacciones_stand`**: una fila por visita o grupo. No guarda nombre, teléfono ni otro dato del visitante: la validación rechaza cualquier campo desconocido.
  - **Obligatorios:** resultado máximo (`miro` | `pregunto` | `subio`) y `personas_grupo` (1–50).
  - **Opcionales:**
    - hombres/mujeres: los dos vacíos, o los dos cargados y sumando el total;
    - rango etario del grupo: `menos_14`, `14_17`, `18_24`, `25_34`, `35_49`, `50_mas`;
    - conocía SIM y ya se había subido: `si` / `no` / `no_sabe`;
    - iniciador, atendió y observaciones;
    - motivo: `precio`, `tiempo`, `espera`, `vuelve_despues`, `no_interesa`, `requisitos`, `acompanantes`, `otro`. Nunca con `subio`.
  - `ocurrida_en` deriva `fecha_negocio` y `hora_negocio` en Córdoba.
  - Las bajas son lógicas (anulada).
- **`interaccion_turnos`**: el vínculo.
  - Es una FK real a `turnos_stand(id)` con `ON DELETE CASCADE` y `UNIQUE(turno_stand_id)`.
  - Guarda los datos mínimos del turno **al vincular**, sin nombre ni teléfono, para detectar cambios posteriores. Las métricas usan siempre el turno vivo.
- **`interacciones_stand_eventos`**: historial al que solo se agregan filas. Registra altas, ediciones, vínculos, desvínculos, cierres, anulaciones y turnos borrados en el Turnero.
- **`interacciones_config`**: una fila con el inicio del registro.

### Estado del vínculo (derivado, vista `interacciones_stand_estado`)

| Estado | Significa |
|---|---|
| `no_aplica` | resultado `miro` o `pregunto` |
| `con_turno` | `subio` con **al menos un** turno activo vinculado. No garantiza que todos los turnos de la visita estén registrados. |
| `pendiente` | `subio` sin turno y sin cierre |
| `cerrada_sin_turno` | `subio` cerrada por admin: sigue declarada, no verificada |
| `turno_no_activo` | sus turnos vinculados dejaron de estar activos (hoy el Turnero no cancela; es defensivo) |
| `anulada` | baja lógica: no cuenta en nada y libera sus turnos |

### Correcciones

- **Edición:** reemplaza en el lugar y sube la versión, sin duplicar. Una versión vieja recibe `version_desactualizada`.
- **Cambio de resultado o anulación:** si pasa de `subio` a `miro`/`pregunto` o se anula, los turnos se liberan en la misma transacción y quedan en el historial. Pasar a `subio` exige quitar el motivo explícitamente.
- **Turno borrado en el Turnero:**
  - El vínculo se borra solo. Si era el último, la interacción vuelve a `pendiente`; un cierre anterior ya se había retirado al vincular, así que no la oculta.
  - Queda el evento `turno_eliminado` con el ID y los datos mínimos.
  - **Esos datos son una captura tomada al vincular**, no necesariamente el último estado del turno antes de borrarlo. Si el Turnero lo corrigió en el medio, el evento muestra lo que valía al vincularse. Para capturar el último estado habría que poner un trigger sobre `turnos_stand`, y el Turnero no se toca.
- **Turno corregido en el Turnero:** nada se bloquea. La vista `interacciones_vinculos_control` marca `turno_modificado` y `fuera_de_tolerancia` (más de ±1 día entre turno e interacción).
- **Fecha de la interacción corregida:** si es una `subio` con turnos y cambia de día, todos sus turnos tienen que seguir dentro de la tolerancia. Si no, la base rechaza con `turno_fuera_de_tolerancia:<id>`.

## Métricas (Bloques 4 y 5)

Unidades: **interacciones** (grupos), **personas** (tamaño declarado del grupo), **participaciones** y **turnos**. No se mezclan.

- **Embudo acumulativo por interacción:** Miraron = miro + pregunto + subio; Preguntaron = pregunto + subio; Se subieron = subio. Ejemplo: 10/5/3 da 18/8/3.
- **Distribución exclusiva:** 10/5/3. Se muestra aparte, nunca mezclada con las etapas.
- **Tasas:** Miró→Preguntó = Preguntaron/Miraron; Preguntó→Se subió = Se subieron/Preguntaron; Miró→Se subió = Se subieron/Miraron.
  - Siempre con su denominador. Con denominador 0 se muestra "Sin datos".
  - Ninguna se llama "conversión a venta".
- **Estado del vínculo:** las subidas pendientes y las cerradas sin turno son declaraciones sin verificación del Turnero. Se muestran aparte.
- **Venta verificada:** existe al menos un turno vinculado elegible (activo) con **total positivo**, según la regla actual del Turnero.
  - **No** verifica acreditación, cobro ni conciliación financiera: eso es de Finanzas.
  - Si un turno trae datos contradictorios, la interpretación no cambia en silencio. Puede ser total positivo con método `gratis`, o total 0 con otro método (`interacciones_pago_contradictorio()`). En ese caso se **señala** con `pago_contradictorio` en cada turno, `turnos_pago_contradictorio` en el estado y la advertencia `pago_contradictorio` en la API.
- **Participaciones:** Σ `cantidad_personas` de los turnos vinculados (valor vivo).
  - **No** son personas únicas: un grupo de 2 que juega dos veces suma 4.
  - No se calcula ningún % contra el tamaño del grupo y no hay restricción entre ambos.
- **Cobertura del registro** (vista `interacciones_cobertura_turnos`):
  - Denominador: turnos activos cuya **fecha actual** cae en el período.
  - Numerador: esos turnos con vínculo a una interacción no anulada.
  - Se calcula por la fecha del turno, así que un vínculo que cruza la medianoche no se pierde.
  - Pagos y gratis se distinguen.
  - No es conversión ni garantiza que se registraron todas las miradas o consultas.
- **Sin fuente, no se muestra:** no hay tránsito del pasillo. Un período anterior al inicio del registro figura "Sin datos".
- **Variaciones:** en % para cantidades y en puntos porcentuales para tasas.

Cómo se calcula (`lib/interaccionesMetricas.ts`, todo con numerador y denominador):

- **Base:** vista `interacciones_analisis`, una fila por interacción **no anulada**. Las anuladas no cuentan en nada.
- **Agrupación:** por `fecha_negocio` y `hora_negocio` de la interacción (Córdoba). La cobertura, en cambio, va por la fecha del turno.
- **Período e inicio del registro:**
  - Las fechas son inclusivas.
  - Lo que se analiza es `[máx(desde, día del inicio), mín(hasta, hoy)]`.
  - Antes del inicio: "Sin datos de registro", y no se reconstruye nada con ventas.
  - Si el período cruza el inicio, se marca **parcial** y se muestran las fechas cubiertas.
  - La cobertura usa esos mismos días.
- **Días sin cargas:** valen 0 interacciones registradas en la serie diaria. Eso no prueba que no hubo público.
- **Franjas:** intervalos `[desde, hasta)` de 10–12 a 20–22 (las 12:00 son de 12–14). Lo que cae fuera de 10–22 va a "Otros horarios": nada se duplica ni se pierde.
- **Distribuciones del perfil** (rango, conocía, ya se subió, iniciador):
  - n por valor y % sobre los registros **con dato**.
  - "Sin dato" aparte, con la cobertura del dato. "No sabe" es un valor, no un "Sin dato".
  - Tasa Miró→Se subió dentro de cada valor.
- **Género:** sumas de hombres y mujeres solo entre grupos con desglose, más la cobertura (personas con desglose / personas observadas).
- **Motivos:**
  - Base: las que preguntaron y no se subieron. El % es sobre las que tienen motivo; "sin motivo" y su cobertura van aparte.
  - Los motivos de "Solo miró" se muestran separados y no se suman.
- **Atendió (declarado):** volumen y tasas con denominador por empleado (incluye inactivos con su nombre histórico) y "Sin asignar". No es quien registró ni una evaluación de desempeño.
- **Vínculos:**
  - Se reportan subidas declaradas, con turno, con turno pago, pendientes, cerradas sin turno y con pago contradictorio.
  - **No son una partición**: no se suman entre sí.
  - En pantalla, `venta_verificada` se llama "Con turno pago": es una venta registrada en el Turnero, no una acreditación.
- **Comparación:**
  - Los filtros se aplican a los dos períodos; la cobertura general solo sigue al período.
  - Si los períodos cubren distinta cantidad de días, se avisa que las cantidades no son directamente comparables.
- **Carga completa:**
  - PostgREST corta en 1000 filas, así que se pagina por clave y se contrasta con un conteo exacto.
  - Si no coincide se reintenta; si sigue sin coincidir, la respuesta lo dice (`consistente: false`).
  - Nunca se calcula sobre la primera página.

## Límites (fuente única: `interacciones_limites()`)

| Límite | Valor |
|---|---|
| Zona | `America/Argentina/Cordoba` |
| Turnos por interacción | 4 |
| Tolerancia turno ↔ interacción | ±1 día |
| Staff: carga hacia atrás | desde el día calendario anterior al alta |
| Staff: corrección | 48 h desde el alta (inclusive) |
| Margen de reloj hacia el futuro | 2 min |
| Personas por grupo | 1–50 |
| Observaciones / nota de cierre / motivo de anulación | 500 / 300 / 200 caracteres |

Los CHECK de la tabla repiten 50 personas y los largos; si cambian, cambian juntos. La API
del Bloque 2 debe leer o replicar estos valores con una prueba de contrato.

## Permisos y RPCs

- **Lectura:** RLS sin policies. `anon` y `authenticated` no tienen nada. `service_role` **solo lee** tablas y vistas.
- **Escritura:** toda escritura pasa por las RPCs (`SECURITY DEFINER`, `search_path = public`). La API pasa el rol de la sesión firmada.
- **RPCs:**
  - `interaccion_registrar(clave, datos, turnos, rol)`: idempotente por clave. Mismo contenido devuelve el alta original; otro contenido da conflicto.
  - `interaccion_editar(id, version, cambios, rol)`: parcial; null borra.
  - `interaccion_vincular` / `interaccion_desvincular(id, version, turno(s), rol)`.
  - `interaccion_anular(id, version, motivo, rol)`.
  - `interaccion_cerrar_sin_vinculo(id, version, motivo, nota, rol)`: solo admin.
  - `interacciones_definir_inicio(inicio_local, rol)`: solo admin.
  - `interaccion_detalle(id)` e `interacciones_limites()`.
- **Integridad por triggers** (vale en cualquier camino, no solo por las RPCs):
  - solo una interacción viva con `subio` y sin cierre puede tener vínculos;
  - el máximo de vínculos se respeta con bloqueo de fila, aun con vinculaciones simultáneas;
  - los campos del alta son inmutables;
  - toda escritura sube la versión;
  - una anulada no se modifica.
- **Errores:** `22023 campo_invalido:<campo>`, `42501 fuera_de_ventana | solo_admin`,
  `55000 version_desactualizada | interaccion_anulada | registro_no_iniciado`,
  `23505 turno_ya_vinculado:<id> | idempotency_key_con_otro_payload`,
  `23514 maximo_turnos_por_interaccion`.

## Contrato HTTP (Bloque 2)

Todas las rutas están bajo `/api/admin/interacciones` y responden con `Cache-Control: no-store`.

**Reglas generales:**

- **Autorización:**
  - Las rutas usan los guards reales del panel: sin sesión válida responden 401.
  - Las escrituras validan además `isAllowedOrigin`: un origen ajeno recibe 403.
  - El **rol sale solo de la sesión firmada** y es lo que reciben las RPCs.
  - Si el cuerpo trae rol, registrador o algún campo de auditoría, la respuesta es 400 `campo_no_permitido`; nunca se ignora en silencio.
  - Nombre y teléfono también se rechazan con 400.
- **IDs de turnos:** viajan siempre como **cadenas decimales**, en las entradas y en las respuestas. Un número de JSON se rechaza con 400, porque por encima de 2^53 ya llega redondeado.

### Rutas

| Método y ruta | Rol | Qué hace |
|---|---|---|
| `GET /` | staff, admin | Listado paginado más el estado del módulo |
| `POST /` | staff, admin | Alta idempotente |
| `GET /[id]` | staff, admin | Detalle (`interaccion_detalle`) |
| `PATCH /[id]` | staff, admin | Edición parcial con versión |
| `POST /[id]/anular` | staff, admin | Baja lógica |
| `POST /[id]/turnos` | staff, admin | Vincular turnos; también completa pendientes viejas, sin ventana |
| `DELETE /[id]/turnos?turno=<id>&version=<n>` | staff, admin | Desvincular un turno |
| `POST /[id]/cierre` | **solo admin** | Cerrar sin vínculo |
| `GET /turnos-vinculables` | staff, admin | Turnos del Turnero sugeridos |
| `GET /empleados` | staff, admin | Opciones de "Atendió" |

### Cuerpos

- **Alta:** `{ idempotency_key: uuid, datos: {…}, turnos?: ["<id>", …] }`.
  - El cliente genera la clave al abrir el formulario y la reusa en cada reintento.
  - En `datos`, obligatorios: `resultado` y `personas_grupo`.
  - Opcionales y anulables: `ocurrida_en` (ISO con zona; `null` u omitido = ahora), `hombres` y `mujeres` (juntos), `rango_etario`, `conocia_sim`, `se_subio_antes`, `iniciador`, `atendio_empleado_id`, `motivo` y `observaciones`.
  - Turnos: hasta 4, y solo con `resultado = "subio"`.
- **Edición:** `{ version, cambios: {…}, confirmar_liberacion?: boolean }`.
  - **Lo omitido no cambia; `null` vacía.** El desglose hombres/mujeres se envía de a par.
  - Pasar a `subio` con un motivo cargado exige mandar `motivo: null` explícitamente; si no, 400 `motivo_no_aplica`.
  - Dejar de ser `subio` cuando hay turnos vinculados o un cierre exige `confirmar_liberacion: true`. Sin eso, la respuesta es 409 `confirmar_liberacion` con la lista de turnos que se liberarían. Nada se borra sin pedirlo.
- **Vínculo:** `{ version, turnos: ["<id>"] }`.
- **Anulación:** `{ version, motivo? }`, hasta 200 caracteres.
- **Cierre:** `{ version, motivo, nota? }`. `motivo` es `sin_turno_en_turnero`, `turno_no_identificable` u `otro`; con `otro`, la nota es obligatoria.

### Respuestas

**Escrituras:**

- **Alta:** 201 `{ interaccion, repetida: false }`. Un reintento con la misma clave y el mismo contenido devuelve 200 `{ interaccion, repetida: true }`, con la fila original. La misma clave con otro contenido da 409.
- **Edición, vínculo, anulación y cierre:** 200 `{ interaccion, sin_cambios? }`. `sin_cambios: true` significa que no había nada para cambiar y la versión no subió.

**La interacción (`interaccion`) incluye:**

- `id` y `version`, que se reenvía en cada escritura.
- `ocurrida_en`, `fecha_negocio`, `hora_negocio` (Córdoba), `registrada_en` y `registrada_por_rol`.
- Los datos del grupo.
- `atendio`: `{ empleado_id, nombre, activo, declarado: true }`.
- `cierre` y `anulacion`.
- `vinculo`: `{ estado, turnos_vinculados, turnos_activos, turnos_pagos, turnos_gratis, turnos_pago_contradictorio, participaciones, venta_verificada }`.
- `turnos`: cada vínculo con su fecha, hora, personas, minutos, total, `es_pago`, `pago_contradictorio`, `fuera_de_tolerancia` y `turno_modificado`.
- `permisos`: qué puede hacer este rol ahora, para la pantalla. La base lo vuelve a exigir al escribir.
- `advertencias`: `pendiente_de_vinculo`, `subida_declarada_sin_turno`, `turno_no_activo`, `turno_fuera_de_tolerancia`, `turno_modificado`, `pago_contradictorio`, `turnos_liberados` y `cierre_retirado`.

**Errores:**

- Forma: `{ error, codigo, campo?, turno_stand_id?, turnos? }`. `error` es un texto para personas: nunca se devuelve SQL ni detalle interno.

| Código HTTP | Cuándo |
|---|---|
| 400 | Entrada inválida (`campo_invalido`, `campo_desconocido`, `campo_no_permitido`, `desglose_*`, `motivo_no_aplica`, `turno_fuera_de_tolerancia`, `ocurrida_en_futura`, `empleado_no_disponible`…) |
| 401 | Sin sesión válida |
| 403 | Rol (`solo_admin`), ventana (`fuera_de_ventana`) u origen |
| 404 | `interaccion_inexistente`, `turno_inexistente`, `vinculo_inexistente` |
| 409 | `version_desactualizada`, `idempotency_key_con_otro_payload`, `turno_ya_vinculado`, `maximo_turnos_por_interaccion`, `interaccion_anulada`, `tiene_turnos_vinculados`, `confirmar_liberacion`… |
| 503 | `modulo_no_habilitado` (sin inicio del registro) o `modulo_no_instalado` (migración ausente) |
| 500 | Error inesperado: genérico, con `requestId`; el detalle queda solo en el log |

### Listado: `GET /`

- **Filtros:** `desde`, `hasta` (fechas de Córdoba, YYYY-MM-DD; sin fechas, hoy), `resultado`, `estado` (estado del vínculo), `incluir_anuladas=1` y `limite` (1–100, por defecto 20).
- **Orden y paginación:** orden **estable** por `ocurrida_en` desc y luego `id` desc. Se pagina con un cursor opaco: `siguiente` es `null` en la última página. No hay offset.
- **Staff:**
  - Solo puede pedir desde hoy − 2 hasta hoy; fuera de eso, 403 `fuera_de_ventana`.
  - Excepción: con `estado=pendiente` ve pendientes de **cualquier** fecha, para completarlas.
- **Respuesta:** `{ items, siguiente, filtros, modulo: { instalado, habilitado, inicio_registro, limites } }`.
- **Módulo sin habilitar:** con `habilitado: false` las altas responden 503 `modulo_no_habilitado`. El inicio lo fija un admin al lanzar (`interacciones_definir_inicio`); nunca se infiere.

### Turnos vinculables: `GET /turnos-vinculables`

- **Ancla:** `?interaccion=<uuid>` (su `ocurrida_en`), `?ocurrida_en=<ISO con zona>` o, sin nada, ahora.
- **Alcance:**
  - `2h` (por defecto): las dos horas previas, por hora de toma.
  - `dia`: todo el día de la interacción.
  - `tolerancia`: ±1 día. Nunca sale de lo que la base acepta.
- **Búsqueda:** `hora` (prefijo de HH:MM), `personas`, `minutos`.
- **Turnos ya vinculados:** `incluir_vinculados=0` los oculta.
- **Origen de los datos:**
  - Solo `turnos_stand` activos; reservas web, históricos y Colectivo ni se consultan.
  - Cada turno trae `{ id, fecha, hora, hora_subida, personas, minutos, modalidad, total, es_pago, pago_contradictorio, vinculacion: libre|esta|otra, disponible }`.
  - **Nunca** devuelve nombre, teléfono, observaciones ni cabina.
- La consulta orienta la pantalla; la RPC vuelve a validar al vincular.

### Empleados: `GET /empleados?ocurrida_en=`

- **Respuesta:** `{ empleados: [{ id, nombre }], sugeridos: [ids], cronograma: { estado, fuente, oficial } | null, ancla }`.
- **Empleados:** solo los activos, con id y nombre.
- **Sugeridos:** quiénes figuran en el cronograma a esa hora. Es solo una sugerencia: no se asigna nada. Si el cronograma no se puede leer, no hay sugerencias y el resto sigue.
- El endpoint general `/api/admin/empleados` no se amplía.

## Pantalla del personal (Bloque 3): `/admin/interacciones`

Staff y admin. En el menú va debajo de "Turnero". "Ir al Turnero" está siempre a mano y el Turnero no cambió.

- **Accesos y formulario:**
  - Tres accesos grandes: Solo miró, Miró y preguntó, Se subió. Cada uno abre **una sola pantalla**.
  - Obligatorios: personas (arranca en 1) y cuándo pasó (por defecto "ahora"). Staff puede cargar desde ayer a las 00:00.
  - El resto es opcional, en chips de un toque; tocar de nuevo vacía el campo. "Sin dato" no es "No sabe".
  - Hombres y mujeres arrancan vacíos y se cargan de a par. Si no suman el total se avisa y no se puede guardar; nada se completa ni se borra solo.
  - Motivo: visible en "preguntó", plegado en "miró", inexistente en "se subió".
- **"Se subió":**
  - Muestra los turnos del Turnero de las 2 h previas a la hora de la interacción.
  - Se puede ampliar al día o a ±1 día y buscar por hora o personas. Se eligen hasta 4.
  - Los ya vinculados aparecen como no disponibles, y los IDs viajan siempre como cadena.
  - "No encuentro el turno" guarda la interacción como pendiente.
- **Idempotencia:**
  - Hay una clave por carga y un doble clic no duplica.
  - Si no se sabe si se guardó (sin respuesta o error 5xx), el contenido queda bloqueado y "Reintentar" usa la misma clave. Si ya había llegado, avisa "no se duplicó".
- **Borradores** en `sessionStorage` (alta y edición por separado, sin tokens): se puede ir al Turnero y volver; "Descartar" los borra.
- **Correcciones:**
  - El detalle muestra las acciones según `permisos` de la API: editar, vincular o desvincular, anular, y cerrar sin turno (solo admin, con motivo).
  - Las pendientes viejas se completan buscando alrededor de **su** hora.
  - Liberar turnos o retirar un cierre pide confirmación explícita.
  - Si otro dispositivo cambió la interacción, se conserva la edición, se recarga y se vuelven a aplicar solo los cambios del usuario sobre la versión nueva.
- **Módulo no habilitado:** "La carga de Interacciones todavía no está habilitada", y el Turnero sigue disponible.

## Dashboard (Bloque 5): `/admin/interacciones/analisis`

Solo admin, con tres cerraduras: `middleware.ts` (`ADMIN_ONLY`, manda a staff a `/admin/calendario` como el resto de las páginas solo admin), la página redirige a staff a `/admin/interacciones` si llegara a renderizarse y `GET /api/admin/interacciones/metricas` exige `requireAdmin` (403 para staff). Sin caché.

- **Controles:** período (hoy, 7 días, 30 días, personalizado), comparación (período anterior u otro rango) y filtros (resultado, franja, rango, tamaño, conocía, ya se subió, iniciador, motivo, atendió).
- **Secciones:** tarjetas, embudo acumulativo, distribución exclusiva, evolución diaria (gráfico y tabla), día y franja, motivos, perfil, conocimiento previo y repetición, atribución declarada, y cobertura con vínculos y advertencias.
- **Lo que no muestra:** cifras de ejemplo, importes en las tarjetas y "personas que pasaron".
- **Estados:** cargando, sin registros, antes del inicio, período parcial, filtros sin resultados, módulo no disponible y error con reintento.
- **Consultas superpuestas:** si se cambian filtros rápido, solo cuenta la respuesta de la consulta más reciente.

## Probar en local (sin Producción)

1. Stack local y esquema:

   ```bash
   npm run pruebas:iniciar
   ```

   ```bash
   npm run pruebas:reset
   ```

2. Datos de demostración (opcional). Turnos de hoy, una pendiente vieja, unas interacciones y el inicio local fijo `2026-10-02 00:00`:

   ```bash
   node scripts/pruebas/interacciones-demo-local.mjs
   ```

3. Fixtures deterministas de métricas (opcional, marzo de 2025). Dejan el inicio local en `2025-03-10 00:00`:

   ```bash
   INTERACCIONES_DEJAR_FIXTURES=1 npx tsx --env-file=.env.test.local lib/interaccionesMetricas.integration.ts
   ```

4. Next contra el Supabase local:
   - En Claude Code, la configuración "interacciones-local" de `.claude/launch.json` hace lo mismo.
   - No uses `npm run dev`: carga `.env.local` (Producción).
   - El script corre con `NODE_ENV=test`, que carga `.env.test.local` y nunca `.env.local`. Al arrancar, Next lo confirma con `Environments: .env.test.local`.

   ```bash
   node scripts/pruebas/next-local.mjs dev --port 3100
   ```

   Para probar el build de producción contra el mismo stack local (configuración "interacciones-local-build" en `.claude/launch.json` para el segundo paso):

   ```bash
   node scripts/pruebas/next-local.mjs build
   ```

   ```bash
   node scripts/pruebas/next-local.mjs start --port 3100
   ```

   Ese build deja `.next` compilado con las URL públicas del stack local. No se despliega (Vercel compila de nuevo), pero no hay que servirlo con `npm start` creyendo que es Producción: volvé a compilar o borrá `.next` al terminar.

5. Ingresar en `http://localhost:3100/admin/login`:
   - Las contraseñas locales (`ADMIN_PASSWORD` y `STAFF_PASSWORD`) están en `.env.test.local`.
   - Las genera el script la primera vez, al azar, y son solo de esta máquina.

6. Antes de `npm run pruebas:mutantes`, borrar los datos de demostración. El escenario histórico de IA se niega a cargar si hay turnos fuera de agosto y septiembre de 2026, a propósito:

   ```bash
   node scripts/pruebas/interacciones-demo-local.mjs --limpiar
   ```

   ```bash
   INTERACCIONES_SOLO_LIMPIAR=1 npx tsx --env-file=.env.test.local lib/interaccionesMetricas.integration.ts
   ```

   También sirve `npm run pruebas:reset`.

7. Fechas en las pruebas del módulo: ninguna usa el 01/10/2026. La guarda de `lib/modalidadComercial.test.ts` exige que la fecha del corte comercial viva en una sola fuente y falla si aparece en otro archivo de `app`, `lib`, `components`, `data`, `db` o `tests`. Por eso el inicio de demo local es el 02/10 y los casos de períodos usan noviembre.

## Lanzamiento (guía, NO ejecutada)

Esta guía no autoriza nada por sí misma. Los tres pasos son distintos y van en este orden; cada uno necesita una decisión explícita.

**1. Migrar (la base primero).** Un push a `main` despliega solo, y el código nuevo sin la migración respondería 503 `modulo_no_instalado`. No rompe nada, pero no hay que llegar a eso.

- Aplicar `db/interacciones-bloque1.sql` en SIM WEB (`bcmoewwhsyxsiyvroarj`), por el MCP (`apply_migration`) o pegándolo en el SQL Editor.
- Es aditivo e idempotente:
  - crea 4 tablas, 4 vistas, funciones y triggers solo del módulo;
  - agrega una FK `ON DELETE CASCADE` desde `interaccion_turnos` hacia `turnos_stand`;
  - no modifica ni borra datos existentes.
- Comprobaciones de solo lectura después de aplicarlo:
  - RLS activo, sin policies y nada para `anon`/`authenticated` en las tablas y vistas `interacc*`;
  - `service_role` solo con SELECT;
  - RPCs `SECURITY DEFINER` con EXECUTE solo para `service_role`;
  - `interacciones_config.inicio_registro` en NULL (módulo instalado pero **no habilitado**).
- Correr `db/interacciones-bloque1.verificacion.sql`: se revierte entera, usa turnos con id negativo y uuids, así que no deja huella. Tiene que terminar con `RESULTADO INTERACCIONES-B1|…` sin `FALLA`.
- Compatibilidad del Turnero: borrar un turno sigue funcionando (el cascade corre como dueño de la tabla) y editarlo no se bloquea. Se probó en local; en Producción no hace falta borrar nada para confirmarlo.

**2. Desplegar el código.**

- Merge de `feat/interacciones-bloque1` a `main` (despliega).
- Verificar el deployment servido con `get_deployment("simexperience.com.ar")`.
- Pruebas sin sesión: `/api/admin/interacciones` y `/api/admin/interacciones/metricas` deben responder 401.
- Con sesión staff, `/admin/interacciones` muestra "todavía no está habilitada".
- Con sesión admin, `/admin/interacciones/analisis` muestra "todavía no disponible".
- Con el inicio en NULL, las altas responden 503 `modulo_no_habilitado`: el código está, pero nadie puede cargar todavía.

**3. Habilitar el registro (el día real del lanzamiento).**

- Un admin fija el inicio real en hora de Córdoba:

  ```sql
  select public.interacciones_definir_inicio('AAAA-MM-DD HH:MM', 'admin');
  ```

  No se inventa ahora ni se infiere de la migración ni de la primera fila.
- Verificar una carga real desde el stand y que aparezca en el análisis.

**Retirar u ocultar si hay un problema** (conservando lo registrado):

- **Frenar nuevas cargas sin redeploy:** volver `inicio_registro` a NULL por SQL. Las altas responden 503 y la pantalla avisa que no está habilitada. Las interacciones ya cargadas no se tocan.
  - `interacciones_definir_inicio` no admite NULL a propósito: esta es una acción de emergencia, por SQL directo.
- **Ocultar del menú:** revertir el commit del Bloque 3 o quitar el ítem de `AdminSidebar`. Las rutas siguen protegidas por rol.
- **No es un rollback normal:** borrar tablas o interacciones de clientes.
  - Si alguna vez hiciera falta desinstalar, primero respaldar las 4 tablas.
  - La FK hacia `turnos_stand` se puede eliminar sin tocar el Turnero.
