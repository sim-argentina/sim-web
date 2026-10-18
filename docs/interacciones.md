# Interacciones del stand

Registro de lo que pasó con cada **visita espontánea** al stand, para medir cuántas
terminan en consultas y en personas que se suben. Se carga **después** de atender: nunca es
un paso previo para vender, cobrar, cargar un turno ni subir a nadie. El Turnero sigue
funcionando igual.

Estado:

- **Bloque 1** (base de datos) y **Bloque 2** (lógica de servidor y API) hechos y verificados en el stack local.
- Todavía no hay pantallas ni dashboard, y nada está aplicado en Producción.

Archivos y pruebas:

- Esquema y RPCs: `db/interacciones-bloque1.sql`
- Verificación sin huella: `db/interacciones-bloque1.verificacion.sql`
- Concurrencia y permisos reales (solo local): `node scripts/pruebas/interacciones-bloque1.mjs`
- Contrato puro (validación, ventanas, errores): `lib/interacciones.ts` · pruebas: `npx tsx lib/interacciones.test.ts`
- Acceso de servidor: `lib/interaccionesServer.ts` · piezas HTTP: `lib/interaccionesHttp.ts`
- Rutas reales contra el stack local: `node scripts/pruebas/correr-mutantes.mjs lib/interacciones.integration.ts`

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

## Métricas (definiciones para los Bloques 4 y 5)

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
