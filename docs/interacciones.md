# Interacciones del stand

Registro de lo que pasó con cada **visita espontánea** al stand, para medir cuántas
terminan en consultas y en personas que se suben. Se carga **después** de atender: nunca es
un paso previo para vender, cobrar, cargar un turno ni subir a nadie. El Turnero sigue
funcionando igual.

Estado:

- Versión local completa: base de datos (Bloque 1), servidor y API (Bloque 2), pantalla del personal (Bloque 3), métricas (Bloque 4) y dashboard de admin (Bloque 5).
- Cierre previo al lanzamiento: borrador sin avisos falsos, pausa de altas separada del inicio histórico y borrado administrativo de cualquier interacción.
- Verificada en el stack local de pruebas.
- **En Producción desde el 18/10/2026:** migración aplicada en SIM WEB, código desplegado (commit `5a7c52d`) y registro activo desde las 12:00:33 de Córdoba (15:00:33 UTC). Detalle y punto de retorno en [Lanzamiento](#lanzamiento).
- **Perfil v2 (18/10/2026):** rangos etarios de selección múltiple, tipo de grupo, "Solo miró" simplificado y motivo "Paseando". Migración incremental y compatibilidad con la pantalla anterior en [Perfil v2](#perfil-v2-edades-múltiples-tipo-de-grupo-y-paseando).

Archivos y pruebas:

- Esquema, vistas y RPCs: `db/interacciones-bloque1.sql` (un solo archivo; está en `db/orden.txt`)
- Verificación SQL (solo en el stack local: escribe dentro de una transacción que se revierte): `db/interacciones-bloque1.verificacion.sql`
- Concurrencia y permisos reales (solo local): `node scripts/pruebas/interacciones-bloque1.mjs`
- Migración del perfil v2 sobre el esquema anterior (solo local, se revierte): `node scripts/pruebas/interacciones-migracion-rangos.mjs`
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
| 6 | Inicio del registro | El lanzamiento real en Producción, y un **dato histórico**. Se configura una vez (`interacciones_definir_inicio`) en hora de Córdoba; antes de la primera carga se puede corregir, después ya no. Nunca se infiere de la migración, de una prueba ni de la primera fila. Sin inicio no se puede registrar. Nada se reconstruye desde ventas. |
| 7 | Cerrar sin vínculo | Solo admin, con motivo obligatorio (`sin_turno_en_turnero`, `turno_no_identificable`, `otro` + nota). Sigue siendo una subida **declarada**. Vincular después retira el cierre. |
| 8 | Turnero | No cambia. "Interacciones" va debajo de "Turnero" en el menú; desde Interacciones puede haber "Ir al Turnero". |
| 9 | Pausa de altas | Separada del inicio: `altas_pausadas_en` en `interacciones_config`, con `interacciones_pausar_altas` / `interacciones_reanudar_altas` (solo admin, por SQL; sin pantalla de configuración). Pausar solo rechaza cargas **nuevas**; consultar, analizar, corregir, vincular, anular y borrar siguen. Reanudar no toca el inicio. |
| 10 | Borrado administrativo | Solo admin, cualquier interacción en cualquier estado y fecha. Borrado **lógico**: desaparece de listas (también de "ver anuladas"), detalle y métricas; libera todos sus turnos; queda la auditoría mínima. Distinto de anular, que sigue igual para staff y admin. Sin restauración ni borrado masivo. |

## Modelo

- **`interacciones_stand`**: una fila por visita o grupo. No guarda nombre, teléfono ni otro dato del visitante: la validación rechaza cualquier campo desconocido.
  - **Obligatorios:** resultado máximo (`miro` | `pregunto` | `subio`) y `personas_grupo` (1–50).
  - **Opcionales:**
    - hombres/mujeres: los dos vacíos, o los dos cargados y sumando el total;
    - **rangos etarios presentes** (`rangos_etarios`, selección múltiple): `menos_14`, `14_17`, `18_24`, `25_34`, `35_49`, `50_mas`. Dice qué edades hay en el grupo, no cuántas personas de cada una: no hay cantidades por rango ni repartos inferidos. Se guarda en el orden de las opciones, sin repetidos, nunca más rangos distintos que personas y sin un rango "mixto". Lista vacía = sin dato;
    - **tipo de grupo** (`tipo_grupo`, uno o ninguno): `familia`, `amigos`, `pareja` (Pareja/s), `solo` (Solo/a), `companeros` (de trabajo o estudio), `otro`. Sin completar = "Sin dato", que no es "Otro". Se carga en "Miró y preguntó" y "Se subió";
    - conocía SIM y ya se había subido: `si` / `no` / `no_sabe`;
    - iniciador, atendió y observaciones;
    - motivo: `precio`, `tiempo`, `espera`, `vuelve_despues`, `no_interesa`, `requisitos`, `acompanantes`, `paseando`, `otro`. Nunca con `subio`.
  - `rango_etario` (un solo valor) es la columna de la versión anterior. Queda **sincronizada** por un CHECK: tiene el rango cuando hay exactamente uno y NULL con cero o varios. La conserva la pantalla anterior durante la transición y no se escribe a mano.
  - `ocurrida_en` deriva `fecha_negocio` y `hora_negocio` en Córdoba.
  - Dos bajas lógicas:
    - **anulada** (`anulada_*`, staff o admin): no cuenta en nada, libera sus turnos y se puede ver con "ver anuladas";
    - **eliminada** (`eliminada_en`, `eliminada_por_rol = 'admin'`, `eliminada_motivo` opcional): no aparece en ninguna vista operativa ni en las métricas, no se modifica más y no se restaura. La fila queda solo como auditoría.
- **`interaccion_turnos`**: el vínculo.
  - Es una FK real a `turnos_stand(id)` con `ON DELETE CASCADE` y `UNIQUE(turno_stand_id)`.
  - Guarda los datos mínimos del turno **al vincular**, sin nombre ni teléfono, para detectar cambios posteriores. Las métricas usan siempre el turno vivo.
- **`interacciones_stand_eventos`**: historial al que solo se agregan filas. Registra altas, ediciones, vínculos, desvínculos, cierres, anulaciones, eliminaciones (`eliminacion`: rol, instante, turnos liberados, motivo) y turnos borrados en el Turnero. Es auditoría: ninguna vista operativa ni métrica lo lee.
- **`interacciones_config`**: una fila.
  - `inicio_registro`: el lanzamiento real (histórico).
  - `altas_pausadas_en`: desde cuándo están pausadas las altas; NULL = se aceptan. No puede haber pausa sin inicio.

Estados del módulo:

| Estado | Cómo se ve en la base | Qué pasa |
|---|---|---|
| No instalado | no existen las tablas | la API responde 503 `modulo_no_instalado`; la pantalla dice "todavía no está habilitada" |
| Instalado, sin activar | `inicio_registro` NULL | altas → 503 `modulo_no_habilitado`; "todavía no está habilitada" |
| Activo | inicio definido, `altas_pausadas_en` NULL | todo habilitado |
| Pausado | inicio definido, `altas_pausadas_en` con fecha | altas → 503 `altas_pausadas`; "La carga de nuevas interacciones está pausada"; lo demás sigue |

### Estado del vínculo (derivado, vista `interacciones_stand_estado`)

| Estado | Significa |
|---|---|
| `no_aplica` | resultado `miro` o `pregunto` |
| `con_turno` | `subio` con **al menos un** turno activo vinculado. No garantiza que todos los turnos de la visita estén registrados. |
| `pendiente` | `subio` sin turno y sin cierre |
| `cerrada_sin_turno` | `subio` cerrada por admin: sigue declarada, no verificada |
| `turno_no_activo` | sus turnos vinculados dejaron de estar activos (hoy el Turnero no cancela; es defensivo) |
| `anulada` | baja lógica: no cuenta en nada y libera sus turnos |

Las **eliminadas** no tienen estado: no aparecen en esta vista ni en `interacciones_vinculos_control`, `interacciones_cobertura_turnos` ni `interacciones_analisis`.

### Correcciones

- **Edición:** reemplaza en el lugar y sube la versión, sin duplicar. Una versión vieja recibe `version_desactualizada`.
- **Edades al editar:** la lista viaja completa cuando cambia (`[]` = limpiar); omitida no cambia. Si al bajar las personas quedan más rangos que personas, se rechaza (`rangos_superan_personas`) y no se borra ningún rango: hay que quitar rangos o sumar personas.
- **"Solo miró" con datos de antes:** si una interacción pasa a "Solo miró" o ya tenía tipo de grupo, conocía, se había subido, iniciador o atendió, esos datos se conservan aunque la pantalla no los muestre; una edición nunca los vacía por omitirlos (el detalle los sigue mostrando).
- **Cambio de resultado o anulación:** si pasa de `subio` a `miro`/`pregunto` o se anula, los turnos se liberan en la misma transacción y quedan en el historial. Pasar a `subio` exige quitar el motivo explícitamente.
- **Turno borrado en el Turnero:**
  - El vínculo se borra solo. Si era el último, la interacción vuelve a `pendiente`; un cierre anterior ya se había retirado al vincular, así que no la oculta.
  - Queda el evento `turno_eliminado` con el ID y los datos mínimos.
  - **Esos datos son una captura tomada al vincular**, no necesariamente el último estado del turno antes de borrarlo. Si el Turnero lo corrigió en el medio, el evento muestra lo que valía al vincularse. Para capturar el último estado habría que poner un trigger sobre `turnos_stand`, y el Turnero no se toca.
- **Turno corregido en el Turnero:** nada se bloquea. La vista `interacciones_vinculos_control` marca `turno_modificado` y `fuera_de_tolerancia` (más de ±1 día entre turno e interacción).
- **Fecha de la interacción corregida:** si es una `subio` con turnos y cambia de día, todos sus turnos tienen que seguir dentro de la tolerancia. Si no, la base rechaza con `turno_fuera_de_tolerancia:<id>`.
- **Borrado administrativo** (`interaccion_eliminar`, solo admin):
  - En una sola transacción: libera **todos** los vínculos (los turnos siguen en el Turnero, sin cambios), marca la fila como eliminada y deja un evento `eliminacion`.
  - Vale para cualquier estado (viva, pendiente, con turnos, cerrada, anulada) y cualquier fecha, también con las altas pausadas.
  - Control optimista: con una versión vieja responde `version_desactualizada` y no borra nada. Repetirlo sobre una ya eliminada devuelve `sin_cambios: true` sin otro evento.
  - Después, editar, vincular, desvincular, anular o cerrar responde `interaccion_eliminada`. Un trigger impide modificarla por cualquier camino, y el de vínculos impide asociarle turnos aun con escrituras simultáneas.
  - El reintento del alta original (misma clave) responde `interaccion_eliminada`: no se vuelve a crear.

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
  - Numerador: esos turnos con vínculo a una interacción no anulada ni eliminada.
  - Anular o borrar una interacción libera sus turnos: el denominador no cambia y el numerador baja. Los turnos no se tocan.
  - Se calcula por la fecha del turno, así que un vínculo que cruza la medianoche no se pierde.
  - Pagos y gratis se distinguen.
  - No es conversión ni garantiza que se registraron todas las miradas o consultas.
- **Sin fuente, no se muestra:** no hay tránsito del pasillo. Un período anterior al inicio del registro figura "Sin datos".
- **Variaciones:** en % para cantidades y en puntos porcentuales para tasas.

Cómo se calcula (`lib/interaccionesMetricas.ts`, todo con numerador y denominador):

- **Base:** vista `interacciones_analisis`, una fila por interacción **no anulada ni eliminada**. Ninguna de las dos cuenta en nada (embudo, distribución, serie, días, franjas, perfil, motivos, conocimiento previo, atribución ni vínculos).
- **Agrupación:** por `fecha_negocio` y `hora_negocio` de la interacción (Córdoba). La cobertura, en cambio, va por la fecha del turno.
- **Período e inicio del registro:**
  - Las fechas son inclusivas.
  - Lo que se analiza es `[máx(desde, día del inicio), mín(hasta, hoy)]`.
  - Antes del inicio: "Sin datos de registro", y no se reconstruye nada con ventas.
  - Si el período cruza el inicio, se marca **parcial** y se muestran las fechas cubiertas.
  - La cobertura usa esos mismos días.
- **Días sin cargas:** valen 0 interacciones registradas en la serie diaria. Eso no prueba que no hubo público. Con las altas pausadas, el dashboard lo avisa desde la fecha de la pausa.
- **Franjas:** intervalos `[desde, hasta)` de 10–12 a 20–22 (las 12:00 son de 12–14). Lo que cae fuera de 10–22 va a "Otros horarios": nada se duplica ni se pierde.
- **Distribuciones del perfil** (conocía, ya se subió, iniciador):
  - n por valor y % sobre los registros **con dato**.
  - "Sin dato" aparte, con la cobertura del dato. "No sabe" es un valor, no un "Sin dato".
  - Tasa Miró→Se subió dentro de cada valor.
- **Rangos etarios: "grupos que incluyen cada rango".**
  - Una interacción cuenta una vez en cada rango que tiene, pero **una sola vez** en el total y en el embudo.
  - Base de los %: interacciones con al menos un rango. Como se superponen, los % pueden sumar más de 100 %; la pantalla lo explica, muestra la cobertura y cuántas tienen más de un rango. Son grupos, no personas por edad. Sin donut.
- **Tipo de grupo:**
  - No se releva en "Solo miró": la base son las interacciones que **preguntaron o se subieron**, con "Sin dato" aparte (no es "Otro") y la cobertura del dato.
  - Por tipo se muestra Preguntó → Se subió con numerador y denominador. Una "Solo miró" que conserva un tipo de antes queda fuera de la base y se informa aparte.
  - Filtrar por un tipo concreto deja solo consultas y subidas: el dashboard lo avisa, marca Miró→Preguntó y Miró→Se subió como "No aplica" y destaca Preguntó → Se subió (un 100 % Miró→Preguntó sería un artefacto del filtro).
- **Género:** sumas de hombres y mujeres solo entre grupos con desglose, más la cobertura (personas con desglose / personas observadas).
- **Motivos:**
  - Base: las que preguntaron y no se subieron. El % es sobre las que tienen motivo; "sin motivo" y su cobertura van aparte.
  - Los motivos de "Solo miró" se muestran separados y no se suman. "Paseando" aparece en los dos grupos.
- **Atendió (declarado):** volumen y tasas con denominador por empleado (incluye inactivos con su nombre histórico) y "Sin asignar". No es quien registró ni una evaluación de desempeño.
- **Vínculos:**
  - Se reportan subidas declaradas, con turno, con turno pago, pendientes, cerradas sin turno y con pago contradictorio.
  - **No son una partición**: no se suman entre sí.
  - En pantalla, `venta_verificada` se llama "Con turno pago": es una venta registrada en el Turnero, no una acreditación.
- **Filtros:** rangos etarios de selección múltiple = "incluye al menos uno" (cada interacción una sola vez aunque coincidan varios; "Sin dato" combinable); tipo de grupo con "Sin dato". En la API: `rango_etario=18_24,50_mas` (una sola vez, sin repetidos) y `tipo_grupo=familia|…|sin_dato`.
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
| Observaciones / nota de cierre / motivo de anulación / motivo de eliminación | 500 / 300 / 200 / 200 caracteres |

Los CHECK de la tabla repiten 50 personas y los largos; si cambian, cambian juntos. La API
del Bloque 2 debe leer o replicar estos valores con una prueba de contrato.

## Permisos y RPCs

- **Lectura:** RLS sin policies. `anon` y `authenticated` no tienen nada. `service_role` **solo lee** tablas y vistas.
- **Escritura:** toda escritura pasa por las RPCs (`SECURITY DEFINER`, `search_path = public`). La API pasa el rol de la sesión firmada.
- **RPCs:**
  - `interaccion_registrar(clave, datos, turnos, rol)`: idempotente por clave. Mismo contenido devuelve el alta original; otro contenido da conflicto. Los intentos con la misma clave se serializan (lock de transacción por clave), así que un rechazo previo al guardado (pausa, inicio, ventana) es definitivo: nada quedó guardado con esa clave. Con las altas pausadas, una clave nueva recibe `altas_pausadas` y una ya guardada sigue devolviendo la original.
  - `interaccion_editar(id, version, cambios, rol)`: parcial; null borra.
  - `interaccion_vincular` / `interaccion_desvincular(id, version, turno(s), rol)`.
  - `interaccion_anular(id, version, motivo, rol)`.
  - `interaccion_cerrar_sin_vinculo(id, version, motivo, nota, rol)`: solo admin.
  - `interaccion_eliminar(id, version, motivo, rol)`: solo admin; borrado lógico (ver Correcciones).
  - `interacciones_definir_inicio(inicio_local, rol)`: solo admin. Primera activación. Con interacciones registradas responde `inicio_ya_definido`.
  - `interacciones_pausar_altas(rol)` / `interacciones_reanudar_altas(rol)`: solo admin. No tocan el inicio ni los registros; repetirlas no cambia nada.
  - `interaccion_detalle(id)` e `interacciones_limites()`.
- **Integridad por triggers** (vale en cualquier camino, no solo por las RPCs):
  - solo una interacción viva con `subio` y sin cierre puede tener vínculos;
  - el máximo de vínculos se respeta con bloqueo de fila, aun con vinculaciones simultáneas;
  - los campos del alta son inmutables;
  - toda escritura sube la versión;
  - una anulada no se modifica (salvo para eliminarla, sin cambiar ningún otro dato);
  - una eliminada no se modifica ni recibe vínculos, y para eliminar hay que haber liberado los vínculos en la misma transacción.
- **Orden de bloqueo con el Turnero:**
  - Borrar un turno bloquea turno → vínculo (CASCADE) → interacción (el trigger sube la versión).
  - Las RPCs que liberan vínculos (editar cuando cambia el resultado, desvincular, anular, eliminar) bloquean en el mismo orden: primero los vínculos y después la interacción.
  - Si coinciden, una espera a la otra durante lo que dura la transacción y no se cruzan. El Turnero termina siempre. Si el turno se borró primero, la RPC responde 409 `version_desactualizada` sin escribir nada; la pantalla recarga la versión actual y se puede repetir la acción.
  - Antes de este ajuste, con la interacción bloqueada primero, el cruce terminaba en `40P01 deadlock_detected`: el borrado del Turnero se abortaba con un 500 genérico, sin escrituras parciales (reproducido en local el 18/10/2026).
  - Lo cubren `scripts/pruebas/interacciones-bloque1.mjs` (sonda del orden de bloqueo y cruce Turnero-primero para las cuatro RPCs) y la sección 17 de `lib/interacciones.integration.ts` (rutas reales del Turnero y de Interacciones, en los dos órdenes).
- **Errores:** `22023 campo_invalido:<campo> | rangos_repetidos | rangos_superan_personas`, `42501 fuera_de_ventana | solo_admin`,
  `P0002 interaccion_inexistente | interaccion_eliminada`,
  `55000 version_desactualizada | interaccion_anulada | registro_no_iniciado | altas_pausadas | inicio_ya_definido | cliente_desactualizado`,
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
| `POST /[id]/eliminar` | **solo admin** | Borrado administrativo (lógico) |
| `GET /turnos-vinculables` | staff, admin | Turnos del Turnero sugeridos |
| `GET /empleados` | staff, admin | Opciones de "Atendió" |

### Cuerpos

- **Alta:** `{ idempotency_key: uuid, datos: {…}, turnos?: ["<id>", …] }`.
  - El cliente genera la clave al abrir el formulario y la reusa en cada reintento.
  - En `datos`, obligatorios: `resultado` y `personas_grupo`.
  - Opcionales y anulables: `ocurrida_en` (ISO con zona; `null` u omitido = ahora), `hombres` y `mujeres` (juntos), `rangos_etarios` (lista; `[]` o `null` = sin dato), `tipo_grupo`, `conocia_sim`, `se_subio_antes`, `iniciador`, `atendio_empleado_id`, `motivo` y `observaciones`.
  - Forma anterior: `rango_etario` (un valor) se sigue aceptando y se guarda como lista de uno; nunca junto con `rangos_etarios` (400).
  - Turnos: hasta 4, y solo con `resultado = "subio"`.
- **Edición:** `{ version, cambios: {…}, confirmar_liberacion?: boolean }`.
  - **Lo omitido no cambia; `null` vacía.** El desglose hombres/mujeres se envía de a par. `rangos_etarios` viaja completa; `[]` la limpia.
  - Una pantalla anterior que manda `rango_etario` sobre una interacción con **varios** rangos recibe 409 `cliente_desactualizado` ("recargá la página"): no puede truncar la selección.
  - Pasar a `subio` con un motivo cargado exige mandar `motivo: null` explícitamente; si no, 400 `motivo_no_aplica`.
  - Dejar de ser `subio` cuando hay turnos vinculados o un cierre exige `confirmar_liberacion: true`. Sin eso, la respuesta es 409 `confirmar_liberacion` con la lista de turnos que se liberarían. Nada se borra sin pedirlo.
- **Vínculo:** `{ version, turnos: ["<id>"] }`.
- **Anulación:** `{ version, motivo? }`, hasta 200 caracteres.
- **Cierre:** `{ version, motivo, nota? }`. `motivo` es `sin_turno_en_turnero`, `turno_no_identificable` u `otro`; con `otro`, la nota es obligatoria.
- **Borrado:** `{ version, motivo? }`. El motivo es opcional (hasta 200 caracteres). Rol y auditoría nunca viajan en el cuerpo.

### Respuestas

**Escrituras:**

- **Alta:** 201 `{ interaccion, repetida: false }`. Un reintento con la misma clave y el mismo contenido devuelve 200 `{ interaccion, repetida: true }`, con la fila original. La misma clave con otro contenido da 409.
- **Edición, vínculo, anulación y cierre:** 200 `{ interaccion, sin_cambios? }`. `sin_cambios: true` significa que no había nada para cambiar y la versión no subió.
- **Borrado:** 200 `{ interaccion_id, eliminada: true, sin_cambios, turnos_liberados: ["<id>", …] }`. No devuelve la interacción: ya no existe para el panel. Repetido, `sin_cambios: true`.

**La interacción (`interaccion`) incluye:**

- `id` y `version`, que se reenvía en cada escritura.
- `ocurrida_en`, `fecha_negocio`, `hora_negocio` (Córdoba), `registrada_en` y `registrada_por_rol`.
- Los datos del grupo.
- `atendio`: `{ empleado_id, nombre, activo, declarado: true }`.
- `cierre` y `anulacion`.
- `vinculo`: `{ estado, turnos_vinculados, turnos_activos, turnos_pagos, turnos_gratis, turnos_pago_contradictorio, participaciones, venta_verificada }`.
- `turnos`: cada vínculo con su fecha, hora, personas, minutos, total, `es_pago`, `pago_contradictorio`, `fuera_de_tolerancia` y `turno_modificado`.
- `permisos`: qué puede hacer este rol ahora, para la pantalla: `editar`, `anular`, `vincular`, `desvincular`, `cerrar_sin_vinculo` y `eliminar` (solo admin). La base lo vuelve a exigir al escribir.
- `advertencias`: `pendiente_de_vinculo`, `subida_declarada_sin_turno`, `turno_no_activo`, `turno_fuera_de_tolerancia`, `turno_modificado`, `pago_contradictorio`, `turnos_liberados` y `cierre_retirado`.

**Errores:**

- Forma: `{ error, codigo, campo?, turno_stand_id?, turnos? }`. `error` es un texto para personas: nunca se devuelve SQL ni detalle interno.

| Código HTTP | Cuándo |
|---|---|
| 400 | Entrada inválida (`campo_invalido`, `campo_desconocido`, `campo_no_permitido`, `desglose_*`, `rangos_repetidos`, `rangos_superan_personas`, `motivo_no_aplica`, `turno_fuera_de_tolerancia`, `ocurrida_en_futura`, `empleado_no_disponible`…) |
| 401 | Sin sesión válida |
| 403 | Rol (`solo_admin`), ventana (`fuera_de_ventana`) u origen |
| 404 | `interaccion_inexistente`, `interaccion_eliminada` (la borró un admin), `turno_inexistente`, `vinculo_inexistente` |
| 409 | `version_desactualizada`, `cliente_desactualizado`, `idempotency_key_con_otro_payload`, `turno_ya_vinculado`, `maximo_turnos_por_interaccion`, `interaccion_anulada`, `tiene_turnos_vinculados`, `confirmar_liberacion`… |
| 503 | `modulo_no_habilitado` (sin inicio del registro), `altas_pausadas` (solo altas nuevas) o `modulo_no_instalado` (migración ausente) |
| 500 | Error inesperado: genérico, con `requestId`; el detalle queda solo en el log |

### Listado: `GET /`

- **Filtros:** `desde`, `hasta` (fechas de Córdoba, YYYY-MM-DD; sin fechas, hoy), `resultado`, `estado` (estado del vínculo), `incluir_anuladas=1` y `limite` (1–100, por defecto 20).
- **Orden y paginación:** orden **estable** por `ocurrida_en` desc y luego `id` desc. Se pagina con un cursor opaco: `siguiente` es `null` en la última página. No hay offset.
- **Staff:**
  - Solo puede pedir desde hoy − 2 hasta hoy; fuera de eso, 403 `fuera_de_ventana`.
  - Excepción: con `estado=pendiente` ve pendientes de **cualquier** fecha, para completarlas.
- **Respuesta:** `{ items, siguiente, filtros, modulo: { instalado, habilitado, inicio_registro, altas_pausadas, altas_pausadas_en, limites } }`.
- **Módulo sin habilitar:** con `habilitado: false` las altas responden 503 `modulo_no_habilitado`. El inicio lo fija un admin al lanzar (`interacciones_definir_inicio`); nunca se infiere.
- **Altas pausadas:** con `altas_pausadas: true` las altas nuevas responden 503 `altas_pausadas`; el listado, el detalle, las correcciones y el análisis siguen.
- Las **eliminadas** no aparecen nunca, ni con `incluir_anuladas=1`.

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
  - **"Solo miró"** es corto: personas (arranca en 1, lo único obligatorio), hombres/mujeres, rangos etarios, motivo y observaciones. La fecha y hora es la del guardado. No muestra conocía, se había subido, iniciador, atendió, tipo de grupo, selector de turnos ni "Más datos".
  - **"Miró y preguntó" y "Se subió":** personas y cuándo pasó (por defecto "ahora"; staff puede cargar desde ayer a las 00:00). El perfil opcional incluye tipo de grupo, hombres/mujeres, rangos etarios, conocía, se había subido, iniciador y atendió.
  - Lo opcional va en chips de un toque; tocar de nuevo vacía el campo. "Sin dato" no es "No sabe". Nada viene marcado (tampoco "Paseando").
  - **Rangos etarios presentes:** chips de selección múltiple con casilla (`aria-pressed`), "Podés marcar más de uno". Si hay más rangos que personas (por ejemplo al bajar las personas) se avisa y no se puede guardar, sin desmarcar nada.
  - Hombres y mujeres arrancan vacíos y se cargan de a par. Si no suman el total se avisa y no se puede guardar; nada se completa ni se borra solo.
  - Motivo: visible en "miró" y "preguntó", inexistente en "se subió".
  - Cambiar de resultado dentro de una carga nueva no arrastra a "Solo miró" lo completado en otro formulario: el alta manda solo lo visible. En una edición lo oculto conserva su valor.
- **"Se subió":**
  - Muestra los turnos del Turnero de las 2 h previas a la hora de la interacción.
  - Se puede ampliar al día o a ±1 día y buscar por hora o personas. Se eligen hasta 4.
  - Los ya vinculados aparecen como no disponibles, y los IDs viajan siempre como cadena.
  - "No encuentro el turno" guarda la interacción como pendiente.
- **Idempotencia:**
  - Hay una clave por carga y un doble clic no duplica.
  - Si no se sabe si se guardó (sin respuesta o error 5xx), el contenido queda bloqueado y "Reintentar" usa la misma clave. Si ya había llegado, avisa "no se duplicó".
- **Borradores** en `sessionStorage` (alta y edición por separado, sin tokens):
  - Se recuerdan solo si tienen algo propio: un dato distinto del formulario recién abierto o un turno elegido (el resultado del acceso no cuenta). Abrir y cerrar sin tocar nada, o volver todo a como estaba, no deja "Tenés una carga sin guardar".
  - Un envío **incierto** se recuerda siempre, aunque sus datos sean los iniciales: misma clave y mismo contenido para reintentar sin duplicar.
  - Se puede ir al Turnero y volver; el guardado confirmado y "Descartar" los borran. La edición solo se recuerda si difiere de la versión cargada.
  - Un borrador de la pantalla **anterior** (un rango) se convierte sin perder el rango. Si había quedado incierto, el reintento manda exactamente lo que se había enviado (misma clave, misma huella) antes de transformarlo: si ya había llegado, devuelve la original y no crea otra.
- **Correcciones:**
  - El detalle muestra todos los rangos etarios y, en "Solo miró", solo los datos de perfil que tengan valor.
  - El detalle muestra las acciones según `permisos` de la API: editar, vincular o desvincular, anular, cerrar sin turno (solo admin, con motivo) y **"Borrar interacción"** (solo admin).
  - Borrar pide confirmación con fecha y hora, resultado, personas y los turnos que se desvinculan; explica que deja de aparecer en listas y métricas y que los turnos siguen en el Turnero. El motivo es opcional. Al confirmar se cierra el detalle, se actualizan listas y contadores y se avisa el resultado. Si la versión cambió, no borra y muestra la versión actual; si la respuesta se pierde, consulta si la interacción sigue antes de avisar.
  - Las pendientes viejas se completan buscando alrededor de **su** hora.
  - Liberar turnos o retirar un cierre pide confirmación explícita.
  - Si otro dispositivo cambió la interacción, se conserva la edición, se recarga y se vuelven a aplicar solo los cambios del usuario sobre la versión nueva.
- **Módulo no habilitado:** "La carga de Interacciones todavía no está habilitada", y el Turnero sigue disponible.
- **Altas pausadas:** "La carga de nuevas interacciones está pausada", con los tres accesos deshabilitados. Se puede consultar, completar pendientes y corregir; un envío incierto se puede reintentar. No se muestra SQL ni instrucciones de infraestructura.

## Dashboard (Bloque 5): `/admin/interacciones/analisis`

Solo admin, con tres cerraduras: `middleware.ts` (`ADMIN_ONLY`, manda a staff a `/admin/calendario` como el resto de las páginas solo admin), la página redirige a staff a `/admin/interacciones` si llegara a renderizarse y `GET /api/admin/interacciones/metricas` exige `requireAdmin` (403 para staff). Sin caché.

- **Controles:** período (hoy, 7 días, 30 días, personalizado), comparación (período anterior u otro rango) y filtros (resultado, franja, tipo de grupo, tamaño, conocía, ya se subió, iniciador, motivo, atendió y rangos etarios con chips "incluye al menos uno").
- **Secciones:** tarjetas, embudo acumulativo, distribución exclusiva, evolución diaria (gráfico y tabla), día y franja, motivos, perfil (con "grupos que incluyen cada rango"), conocimiento previo y repetición, atribución declarada, tipo de grupo, y cobertura con vínculos y advertencias.
- **Lo que no muestra:** cifras de ejemplo, importes en las tarjetas y "personas que pasaron".
- **Estados:** cargando, sin registros, antes del inicio, período parcial, filtros sin resultados, módulo no disponible, **altas pausadas** (desde cuándo) y error con reintento.
- **Consultas superpuestas:** si se cambian filtros rápido, solo cuenta la respuesta de la consulta más reciente.

## Probar en local (sin Producción)

Todo corre contra el Supabase **local** de pruebas (`supabase_db_sim-web-pruebas`, API en `127.0.0.1:55321`). Ningún paso usa `.env.local`.

1. Stack local y esquema. Si el stack ya está levantado y con el esquema aplicado, este paso se saltea.

   ```bash
   npm run pruebas:iniciar
   ```

   Para aplicar el esquema sin vaciar la base:

   ```bash
   npm run pruebas:esquema
   ```

   Para reconstruirla desde cero (borra todo lo local y vuelve a aplicar `db/orden.txt`):

   ```bash
   npm run pruebas:reset
   ```

2. Demo del personal: turnos del Turnero de hoy alrededor de la hora actual, una "Se subió" pendiente cargada hace 49 h y unas interacciones de hoy, todo marcado "DEMO LOCAL". Si no había inicio, lo fija en `2026-10-02 00:00` (valor local de prueba).

   ```bash
   node scripts/pruebas/interacciones-demo-local.mjs
   ```

3. Fixtures del dashboard (semana del 10 al 16 de marzo de 2025). Dejan el inicio local en `2025-03-10 00:00`, **antes** de la demo, así que la semana de marzo y el día de hoy se ven los dos. El orden de los pasos 2 y 3 da igual.

   ```bash
   INTERACCIONES_DEJAR_FIXTURES=1 npx tsx --env-file=.env.test.local lib/interaccionesMetricas.integration.ts
   ```

4. Next contra el Supabase local. Corre con `NODE_ENV=test`, que carga `.env.test.local` y nunca `.env.local`; al arrancar tiene que decir `Next dev contra http://127.0.0.1:55321` y `Environments: .env.test.local`. En Claude Code, la configuración "interacciones-local" de `.claude/launch.json` es lo mismo. **No uses `npm run dev`: carga `.env.local` (Producción).**

   ```bash
   node scripts/pruebas/next-local.mjs dev --port 3100
   ```

5. Ingresar en `http://localhost:3100/admin/login` con las contraseñas locales (`ADMIN_PASSWORD` y `STAFF_PASSWORD` de `.env.test.local`; las genera el script al azar la primera vez y son solo de esta máquina).
   - **Personal:** `http://localhost:3100/admin/interacciones` muestra la demo de hoy. En "Pendientes" están la de hoy y la vieja de 49 h (y, si se cargaron los fixtures del dashboard, dos de marzo de 2025).
   - **Dashboard (admin):** `http://localhost:3100/admin/interacciones/analisis` → "Personalizado" → desde 10/03/2025 hasta 16/03/2025. Tiene que mostrar 253 interacciones, 269 personas y una cobertura de 62,5 % (5 de 8 turnos). "Hoy" muestra la demo.
   - **Pausa (opcional):** con esto la pantalla del personal pasa a "La carga de nuevas interacciones está pausada" (recargar la página):

     ```bash
     docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -c "select public.interacciones_pausar_altas('admin');"
     ```

     Y para reanudar (el inicio no cambia):

     ```bash
     docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -c "select public.interacciones_reanudar_altas('admin');"
     ```

   - **Borrar (admin):** abrir cualquier interacción → "Borrar interacción" → confirmar. Desaparece de Recientes, Pendientes, "Ver anuladas" y del análisis; sus turnos vuelven a estar libres.

6. Limpiar la demo y los fixtures. Hace falta antes de `npm run pruebas:mutantes`: el escenario histórico de IA se niega a cargar si hay turnos fuera de agosto y septiembre de 2026, a propósito.

   ```bash
   node scripts/pruebas/interacciones-demo-local.mjs --limpiar
   ```

   ```bash
   INTERACCIONES_SOLO_LIMPIAR=1 npx tsx --env-file=.env.test.local lib/interaccionesMetricas.integration.ts
   ```

   El segundo deja el inicio local en `2026-10-02 00:00`. También sirve `npm run pruebas:reset`.

7. Detener: cortar Next con Ctrl+C en su terminal y, si no se va a seguir probando, detener el stack (conserva los datos locales):

   ```bash
   npm run pruebas:detener
   ```

Build de producción contra el mismo stack local (configuración "interacciones-local-build" en `.claude/launch.json` para el segundo paso):

```bash
node scripts/pruebas/next-local.mjs build
```

```bash
node scripts/pruebas/next-local.mjs start --port 3100
```

Ese build deja `.next` compilado con las URL públicas del stack local. No se despliega (Vercel compila de nuevo), pero no hay que servirlo con `npm start` creyendo que es Producción: volvé a compilar o borrá `.next` al terminar.

Fechas en las pruebas del módulo: ninguna usa el 01/10/2026. La guarda de `lib/modalidadComercial.test.ts` exige que la fecha del corte comercial viva en una sola fuente y falla si aparece en otro archivo de `app`, `lib`, `components`, `data`, `db` o `tests`. Por eso el inicio de demo local es el 02/10 y los casos de períodos usan noviembre.

## Lanzamiento

### Registro del lanzamiento (18/10/2026)

- **Punto de retorno:** antes del lanzamiento, Producción servía el commit `0ac82cb` (despliegue `dpl_AE78Y7DFyKm1Cdq5R8jUG1wuxFGQ`) y SIM WEB no tenía ningún objeto del módulo.
- **Concurrencia resuelta antes de migrar:** orden de bloqueo coherente con el Turnero (commit `5a7c52d`, ver [Permisos y RPCs](#permisos-y-rpcs)).
- **Migración:** `interacciones_stand_modulo`, aplicada en SIM WEB (`bcmoewwhsyxsiyvroarj`) en una sola transacción con `lock_timeout` de 5 s. Es `db/interacciones-bloque1.sql` sin las líneas de comentario. La huella de funciones, columnas, restricciones, vistas, índices y triggers coincide con la del stack local probado. Verificación de solo lectura: RLS sin policies, `service_role` solo SELECT, RPCs `SECURITY DEFINER` sin EXECUTE para `anon`/`authenticated`, FK en cascada hacia `turnos_stand`.
- **Despliegue:** `main` en `5a7c52d`, despliegue `dpl_DqUC2hARuARJabtdsUtdadEPiE3X` servido por `simexperience.com.ar`. Sin sesión, las APIs del módulo responden 401 y el panel redirige al login; sin errores de runtime.
- **Activación:** `interacciones_definir_inicio` con el instante efectivo: `2026-10-18 15:00:33.403811 UTC` = `12:00:33` en Córdoba. Sin pausa.

### Perfil v2: edades múltiples, tipo de grupo y Paseando

- **Qué cambia en la base** (`db/interacciones-bloque1.sql`, re-aplicable):
  - columnas nuevas `rangos_etarios text[] not null default '{}'` y `tipo_grupo text`, con sus CHECK; la vista `interacciones_analisis` las agrega al final;
  - `interacciones_stand_motivo_chk` suma `paseando`; la función `interacciones_rangos_canonicos` (sin EXECUTE para nadie) fija el orden;
  - `interaccion_normalizar`, `interaccion_registrar` e `interaccion_editar` aceptan las dos formas; el trigger de protección suma una única excepción para el backfill.
- **Registros previos:** un rango único pasa a ser un conjunto de uno; uno vacío sigue sin dato; el tipo queda "Sin dato". No se clasifica nada retroactivamente. El backfill pasa por el trigger de protección (su excepción solo admite copiar el rango anterior, sin tocar nada más), así que no cambia versión, tiempos, vínculos, anulación, borrado ni auditoría, y no se deshabilita ningún trigger, RLS ni permiso. Después, un CHECK ata la columna anterior a la nueva.
- **Huella de idempotencia:** con un rango (o ninguno) y sin tipo, la huella es la misma que calculaba la versión anterior. Un reintento de la pantalla anterior con su clave devuelve la fila original, también en la forma nueva.
- **Orden:** migración → despliegue. El código anterior funciona con la base nueva (las columnas de antes siguen, la vista solo agrega al final y la forma de un rango se sigue aceptando); el código nuevo necesita la base nueva.
- **Volver al código anterior** es seguro para los datos: la base rechaza que la pantalla anterior trunque una selección múltiple (409 `cliente_desactualizado`) o deje más rangos que personas. Pero esa pantalla mostraría como "Sin dato" los grupos con varios rangos y su análisis los contaría así: conviene corregir hacia adelante y, si hiciera falta, pausar altas. No se borran columnas ni datos.

#### Registro de la publicación del perfil v2 (18/10/2026)

- **Antes:** SIM WEB con el esquema del commit `5a7c52d` (huella de 7 partes idéntica a la local), **0 interacciones**, inicio `2026-10-18 15:00:33.403811 UTC` y sin pausa. Despliegue servido: `dpl_45y2cka2xVfeKSJY1UxkkWuGyXQZ` (`839afb8`), que queda como retorno de código.
- **Migración:** `interacciones_perfil_v2`, aplicada por MCP a las 22:19 UTC aprox. con `lock_timeout` de 5 s. Es el extracto de `db/interacciones-bloque1.sql` (sin líneas de comentario) con solo las sentencias que cambian. Antes de aplicarla se comprobó en el stack local que esquema publicado + extracto da la misma huella que el archivo completo, y que re-aplicarlo no cambia nada. Después, la huella de Producción coincide con la esperada. Backfill: 0 filas (no había registros). Inicio, pausa, RLS (sin policies), `service_role` solo lectura y RPCs sin EXECUTE para `anon` quedaron iguales.
- **Despliegue:** `main` en `596fd14` (código en `ea6fbc8`), despliegue `dpl_8Q2RkQ7Yp5PhBT8LzTTJmXy3LULY` servido por `simexperience.com.ar` desde las 22:22 UTC. Sin sesión, las APIs del módulo responden 401 y el panel y el análisis redirigen al login; sin errores de runtime.
- **Pendiente:** validar con una sesión real del personal y de admin (formularios, detalle y análisis) y la primera carga real con rangos o tipo de grupo.

### Guía (A/B/C)

Esta guía prepara acciones; no las ejecuta ni las autoriza. Cada paso de B y C necesita una decisión explícita.

### A. Verificación local (solo en el stack local protegido)

Todo lo que escribe datos —fixtures, suites mutantes, concurrencia, navegador— corre **solo** acá.

1. Reconstrucción y migraciones locales:

   ```bash
   npm run pruebas:reset
   ```

2. Suites de escritura del módulo: verificación SQL (T0–T38, se revierte entera), concurrencia real con dos conexiones (incluido el orden de bloqueo frente al Turnero y la pantalla anterior contra la nueva) y permisos por REST.

   ```bash
   node scripts/pruebas/interacciones-bloque1.mjs
   ```

   Migración del perfil v2 sobre el esquema publicado antes (filas creadas con las RPCs anteriores, backfill, preservación, huella e idempotencia; todo en una transacción que se revierte):

   ```bash
   node scripts/pruebas/interacciones-migracion-rangos.mjs
   ```

   ```bash
   node scripts/pruebas/correr-mutantes.mjs lib/interacciones.integration.ts lib/interaccionesMetricas.integration.ts
   ```

   Regresión completa (las 7 fallas previas de Disponibilidad, Empresas y Mensualidades son ajenas al módulo):

   ```bash
   npm run pruebas:mutantes
   ```

3. Contratos puros, tipos y lint:

   ```bash
   npx tsx lib/interacciones.test.ts
   ```

   ```bash
   npx tsx lib/interaccionesMetricas.test.ts
   ```

   ```bash
   npx tsx lib/modalidadComercial.test.ts
   ```

   ```bash
   npx tsc --noEmit
   ```

   ```bash
   npx eslint "app/admin/(panel)/interacciones" app/api/admin/interacciones lib/interacciones.ts lib/interaccionesServer.ts lib/interaccionesMetricas.ts lib/interaccionesMetricasServer.ts
   ```

4. Navegador con staff y admin, en celular y escritorio: ver [Probar en local](#probar-en-local-sin-producción).

5. Build aislado (`next-local.mjs build`) y revisión de que `.next/static` no tenga claves de servidor.

### B. Instalación y lanzamiento futuros

**Nunca** se corren en Producción `db/interacciones-bloque1.verificacion.sql`, `scripts/pruebas/*` ni ninguna suite: aunque terminen en ROLLBACK, crean datos de prueba. En Producción solo se aplica la migración y se consulta con SELECT.

**1. Aplicar la migración** (cuando esté autorizado). Un push a `main` despliega solo, así que la base va primero: el código sin la migración respondería 503 `modulo_no_instalado`.

- Aplicar `db/interacciones-bloque1.sql` en SIM WEB (`bcmoewwhsyxsiyvroarj`), por el MCP (`apply_migration`) o pegándolo en el SQL Editor.
- Es aditivo e idempotente:
  - crea 4 tablas, 4 vistas, funciones y triggers solo del módulo;
  - agrega una FK `ON DELETE CASCADE` desde `interaccion_turnos` hacia `turnos_stand`;
  - no modifica ni borra datos existentes, y deja el módulo **instalado pero no habilitado** (sin inicio, sin pausa).

**2. Verificaciones de solo lectura** (todas son SELECT):

```sql
-- Objetos: 4 tablas con RLS (relkind r) y 4 vistas (relkind v).
select c.relname, c.relkind, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'interacciones_config', 'interacciones_stand', 'interaccion_turnos', 'interacciones_stand_eventos',
  'interacciones_stand_estado', 'interacciones_vinculos_control', 'interacciones_cobertura_turnos', 'interacciones_analisis')
order by 1;
```

```sql
-- Sin policies (0) y, entre anon/authenticated/service_role, solo SELECT de service_role.
select count(*) as policies from pg_policies where schemaname = 'public' and tablename like 'interacc%';
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'interacc%' and grantee in ('anon', 'authenticated', 'service_role')
order by 1, 2, 3;
```

```sql
-- Funciones: anon y authenticated sin EXECUTE en ninguna; las RPCs con SECURITY DEFINER.
select p.proname, p.prosecdef,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
from pg_proc p
where p.pronamespace = 'public'::regnamespace and (p.proname like 'interaccion%' or p.proname like 'interacciones%')
order by 1;
```

```sql
-- Vínculo con el Turnero (c = cascade), estado inicial (inicio y pausa en NULL) y tablas vacías.
select confdeltype from pg_constraint
 where conrelid = 'public.interaccion_turnos'::regclass and confrelid = 'public.turnos_stand'::regclass;
select inicio_registro, altas_pausadas_en from public.interacciones_config;
select (select count(*) from public.interacciones_stand) as interacciones,
       (select count(*) from public.interaccion_turnos) as vinculos;
```

La compatibilidad con el Turnero (borrar un turno vinculado sigue funcionando; editarlo no se bloquea) se probó en local. En Producción no se borra ni se edita nada para confirmarla.

**3. Desplegar el código, todavía sin admitir altas.**

- Merge de `feat/interacciones-bloque1` a `main` (despliega).
- Verificar el deployment servido con `get_deployment("simexperience.com.ar")`.
- Sin sesión, `/api/admin/interacciones` y `/api/admin/interacciones/metricas` responden 401.
- Con sesión staff, `/admin/interacciones` muestra "La carga de Interacciones todavía no está habilitada" y `/admin/interacciones/analisis` lo devuelve a otra página.
- Con sesión admin, `/admin/interacciones/analisis` muestra "El registro todavía no empezó".
- No se carga ninguna interacción de prueba: sin inicio, las altas responden 503 `modulo_no_habilitado`.

**4. Primera activación (el día real del lanzamiento).**

- Un admin fija el inicio real en hora de Córdoba:

  ```sql
  select public.interacciones_definir_inicio('AAAA-MM-DD HH:MM', 'admin');
  ```

  No se inventa antes ni se infiere de la migración ni de la primera fila. Se puede corregir mientras no haya ninguna carga; después responde `inicio_ya_definido`.

- Comprobar con `select inicio_registro, altas_pausadas_en from public.interacciones_config;`.

**5. Observar la primera carga operativa real del stand.** La hace el personal después de atender; un admin la ve en Recientes y en el análisis del día. Si quedó mal cargada, se corrige o se borra desde el panel (borrar es solo de admin).

### C. Contingencia (conservando lo registrado)

- **Pausar nuevas altas**, sin redeploy y sin tocar la fecha de inicio:

  ```sql
  select public.interacciones_pausar_altas('admin');
  ```

  El personal ve "La carga de nuevas interacciones está pausada". Siguen el historial, las consultas, el análisis (con el aviso de pausa), las correcciones, los vínculos, las anulaciones y el borrado administrativo. Un reintento de una carga que ya había llegado devuelve la original; una clave nueva se rechaza sin guardar nada.

- **Reanudar** (el inicio no cambia):

  ```sql
  select public.interacciones_reanudar_altas('admin');
  ```

- **Retirar el código** si hiciera falta: revertir en `main` el merge de esta rama (despliega). Conviene pausar antes. La base es compatible con el código anterior: las tablas del módulo son aditivas, nadie más las usa y el Turnero sigue funcionando con o sin este código (la FK y los triggers viven en la base). Los registros quedan; volver a desplegar retoma desde ahí. Para ocultar solo el menú, alcanza con revertir el ítem de `components/AdminSidebar.tsx` (las rutas siguen protegidas por rol).

- **Lo que no se hace:**
  - Borrar interacciones de clientes como rollback.
  - Volver `inicio_registro` a NULL para pausar: es un dato histórico y la pausa existe para eso. Con la pausa activa, la base ni siquiera lo permite.
  - Borrar las tablas. Si alguna vez hubiera que desinstalar, es una decisión aparte: primero se respaldan las 4 tablas. La FK hacia `turnos_stand` se puede eliminar sin tocar el Turnero.
