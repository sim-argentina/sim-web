# Interacciones del stand

Registro de lo que pasó con cada **visita espontánea** al stand, para medir cuántas
terminan en consultas y en personas que se suben. Se carga **después** de atender: nunca es
un paso previo para vender, cobrar, cargar un turno ni subir a nadie. El Turnero sigue
funcionando igual.

Estado: **Bloque 1** (base de datos) hecho y verificado en el stack local. Todavía no hay
API, pantallas ni dashboard, y no está aplicado en Producción.

- Esquema y RPCs: `db/interacciones-bloque1.sql`
- Verificación sin huella: `db/interacciones-bloque1.verificacion.sql`
- Concurrencia y permisos reales (solo local): `node scripts/pruebas/interacciones-bloque1.mjs`

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
- **Turno corregido en el Turnero:** nada se bloquea. La vista `interacciones_vinculos_control` marca `turno_modificado` y `fuera_de_tolerancia` (más de ±1 día entre turno e interacción).

## Métricas (definiciones para los Bloques 4 y 5)

Unidades: **interacciones** (grupos), **personas** (tamaño declarado del grupo), **participaciones** y **turnos**. No se mezclan.

- **Embudo acumulativo por interacción:** Miraron = miro + pregunto + subio; Preguntaron = pregunto + subio; Se subieron = subio. Ejemplo: 10/5/3 da 18/8/3.
- **Distribución exclusiva:** 10/5/3. Se muestra aparte, nunca mezclada con las etapas.
- **Tasas:** Miró→Preguntó = Preguntaron/Miraron; Preguntó→Se subió = Se subieron/Preguntaron; Miró→Se subió = Se subieron/Miraron.
  - Siempre con su denominador. Con denominador 0 se muestra "Sin datos".
  - Ninguna se llama "conversión a venta".
- **Estado del vínculo:** las subidas pendientes y las cerradas sin turno son declaraciones sin verificación del Turnero. Se muestran aparte.
- **Venta verificada:** al menos un turno pago vinculado.
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
