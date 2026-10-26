# Campañas de recuperación del stand: panel y ejecución SIMULADA

El panel está en **Admin → Marketing → Campañas (simulación)** (`/admin/marketing?vista=campanias`). El recorrido completo es:

1. Configurar la campaña.
2. Calcular la audiencia.
3. Preparar los beneficios ficticios.
4. Ejecutar por lotes.
5. Consultar los resultados.

Esta etapa **no** envía WhatsApp, **no** crea códigos de descuento y **no** cobra nada. Envíos, entregas y costos son simulados, y la interfaz lo dice en cada pantalla.

- **Base:** `db/marketing-campanias.sql` (en `db/orden.txt`, sección 13e), verificada por `db/marketing-campanias.verificacion.sql`.
- **Reglas puras:** `lib/marketing/campanias.ts` (validación, mensaje, beneficio, capacidades, topes y errores) y `lib/marketing/entornoCampanias.ts` (dónde se puede escribir).
- **Servidor:** `lib/marketing/campaniasServer.ts` (audiencia, vista previa, preparación, transiciones y ejecutor).
- **Proveedor simulado:** `crearProveedorSimulado` en `lib/marketing/proveedorWhatsapp.ts`.
- **API:** `app/api/admin/marketing/campanias/` (lista y vista previa), `[id]/` (detalle y acciones) y `ejecutar/` (disparador con secreto).
- **Panel:** `app/admin/(panel)/marketing/` (`Campanias.tsx`, `FormCampania.tsx`, `ui.tsx`).
- **Estado:** en la rama `marketing-etapa1-simulacion`. La migración **no** está aplicada en Producción, y no hay despliegue.

## Permisos

Son los mismos del panel de Marketing:

| Rol | Puede |
|---|---|
| **Admin** | Calcular la audiencia, crear, editar, preparar, iniciar, pausar, reanudar, cancelar, ejecutar lotes y resolver envíos inciertos. |
| **Staff** | Mirar campañas y resultados, solo lectura (captura 11). |
| **Sin sesión** | Nada: 401. |
| **Origen ajeno** | Nada: 403. |

Ningún dato del cuerpo del pedido decide la autoridad: el rol sale de la sesión firmada.

## Configuración

| Campo | Reglas |
|---|---|
| Nombre y objetivo | De 3 a 80 y de 3 a 300 caracteres. |
| Ventana de audiencia | **14 o 21 días**, por fecha de negocio de Argentina. Hoy no cuenta como día de la ventana. |
| Segmentación y filtros | Los de `audiencia.ts`: solo pagos (sí por defecto), excluir a quien ya volvió, excluir titulares de mensualidad e indicativos **oficiales y completos**. |
| Mensaje | Hasta 1024 caracteres (el cuerpo de una plantilla de WhatsApp). Variables admitidas: `{nombre}` `{beneficio}` `{codigo}` `{vence}` `{productos}` `{baja}`. Cualquier otra, o una llave mal formada, se rechaza. Si falta `{codigo}` o `{baja}`, se avisa. |
| Productos alcanzados | Reservas web y/o Gift Cards. |
| Beneficio | Porcentaje (1–100) o monto fijo, más el vencimiento en días desde el envío (1–60). **Arranca vacío.** |
| Topes y costo | Límite de destinatarios, tarifa de referencia por mensaje entregado (siempre un parámetro), moneda y presupuesto máximo. |
| Proveedor simulado | Porcentaje de errores definitivos, transitorios, sin respuesta y no entregados. |

**Condiciones comerciales sin aprobar.** El 15 % durante 7 días es una **propuesta**. El formulario la ofrece con un botón "Cargar la propuesta para simular" y la rotula "propuesta sin aprobar"; nunca es un valor por defecto. Cada pantalla de campañas recuerda las dos decisiones pendientes.

### Qué hace cumplir hoy el módulo de Códigos

El panel muestra esta tabla en el formulario y en el detalle, y la arma según los productos elegidos:

| Restricción | Estado | Detalle |
|---|---|---|
| Tipo y valor del descuento | Se hace cumplir | Lo calcula el servidor, en Reservas y en Gift Cards. |
| Vencimiento | Se hace cumplir | `fecha_fin` por día de Argentina. |
| Un solo uso, exclusivo entre productos | Se hace cumplir | `usos_maximos = 1` con retención atómica; exige `db/cupones-retencion.sql`. |
| Productos alcanzados | **Solo si se eligen los dos** | El módulo no restringe por producto. Si se elige uno solo, se marca "no se hace cumplir": el código también descontaría en el otro. |
| Días, duraciones o días hábiles | Parcial | Solo en Reservas. |
| Cantidad de Gift Cards por compra | **No se hace cumplir** | No se valida al comprar: un cupón cubre hasta 10 tarjetas con un uso. |
| Tope del descuento en pesos | No se hace cumplir | No existe. |
| Atado al teléfono del destinatario | No se hace cumplir | Se puede reenviar. |
| Canje en el stand | No se hace cumplir | El Turnero no tiene campo de código. |

## Audiencia y vista previa

**Reutiliza `calcularAudiencia`**: normalización (espejo de `mensualidad_normalizar_telefono`), un destinatario por teléfono canónico, fecha argentina e indicativos oficiales de ENACOM. A eso le suma dos exclusiones:
- las personas que ya están en otra campaña en curso;
- opcionalmente, los titulares de mensualidad.

**Lectura:**
- Pagina de a 1000 y la contrasta con un conteo exacto. Si no coinciden, no usa los números (`lectura_inconsistente`).
- Lee el consentimiento de la vista `mkt_consentimiento_estado`. **No se omite nunca**: sin consentimiento no hay destinatario.

**Qué muestra:**
- candidatos, elegibles y exclusiones por motivo (de teléfono y de turno);
- filtros usados y fecha y hora del cálculo;
- seleccionados después de los topes, recortados por límite o presupuesto;
- el mensaje y las condiciones que recibiría un destinatario, con datos de ejemplo (nunca el nombre de una persona);
- el costo estimado con la tarifa usada;
- una muestra de teléfonos **enmascarados** (`351*****00`);
- con 0 elegibles, el motivo y cuántos pasarían si registraran su consentimiento (captura 03).

**Consentimiento registrado no es control del teléfono verificado.** El panel cuenta los consentimientos por fuente y muestra "Control del teléfono verificado: 0". Ninguna fuente de hoy verifica que la persona controle ese número, y esa confirmación sigue siendo una decisión pendiente antes de una campaña real.

**La vista previa es solo lectura.** Puede correr contra cualquier base, porque calcula conteos y no escribe. Para contar contra Producción sin desplegar existe `scripts/marketing/simular.ts` (cliente de solo lectura, transporte GET/HEAD y teléfonos enmascarados).

## Dónde se escribe

`evaluarEntornoCampanias` permite guardar, preparar y ejecutar **solo** si se cumplen las tres condiciones:
- la base es **loopback** (el Supabase local de pruebas);
- no se está en Vercel;
- `MARKETING_WHATSAPP_PROVIDER=fake`.

En cualquier otro caso responde `403 solo_simulacion_local` y el panel lo explica.

Además, `modo = 'simulacion'` es el único valor que admite la tabla: no existe un modo real.

## Beneficios ficticios

Al preparar, cada destinatario recibe un código `SIMU-XXXXXXXX`, único y **estable**: se genera una vez y no cambia.

- **No existen** en `codigos_descuento`, así que no se pueden canjear en ninguna base. La integración lo comprueba con `validarCodigoDescuento`.
- La migración **reserva el prefijo**: la base rechaza cualquier código real que empiece con `SIMU-` (constraint `codigos_descuento_prefijo_simulacion`), y el alta de Códigos lo rechaza con un mensaje.
- La columna `codigo_id` queda lista para la etapa real, cuando cada beneficio sea un código de uso único de `codigos_descuento`. En esta etapa siempre es `null`.

## Estados

```
Campaña:       borrador → preparada → ejecutando ⇄ pausada → completada
                              └─────────┴───────────┴→ cancelada (pendientes → 'cancelado'; no se borra nada)

Destinatario:  pendiente → enviando → aceptado → entregado | no_entregado
                              ├→ pendiente (transitorio, con espera; máx. 3 intentos) → fallido (reintentos_agotados)
                              ├→ fallido (error definitivo)
                              └→ incierto (sin respuesta / ejecutor cortado) → admin: reintentar | dar por fallido
               pendiente → excluido (baja posterior, sin consentimiento o sin cupo, revisado al tomarlo)
```

## Cola persistente e idempotencia

Todo vive en la base (`mkt_campanias`, `mkt_campania_destinatarios`, `mkt_campania_eventos`). Nada depende de la memoria, de una pestaña abierta ni de esta sesión. Las tres tablas son **sin borrado**: un trigger impide `DELETE` y `TRUNCATE`, y el historial de eventos es solo de alta.

| Garantía | Cómo |
|---|---|
| Un destinatario por teléfono y campaña | `unique (campania_id, telefono)`. Al preparar, la base rechaza duplicados y salta los teléfonos en curso en otra campaña; las preparaciones se serializan con un lock. |
| Un beneficio estable por destinatario | Se genera una vez al preparar, `unique`. Preparar otra vez no lo cambia: la versión ya avanzó y responde "repetida". |
| Doble clic al crear | Clave de creación, con un lock por clave (la prueba concurrente encontró y cerró la carrera). |
| Doble clic al editar o preparar | Versión optimista; la segunda llamada recibe "repetida" o `409 version_desactualizada`. |
| Procesos concurrentes | `mkt_campania_tomar_lote` bloquea la fila de la campaña y toma con `FOR UPDATE SKIP LOCKED`. Cada destinatario lo tiene un solo ejecutor, con turno y vencimiento. |
| Reinicios | El progreso está en la base y el próximo lote sigue. Si un ejecutor se cortó con un envío tomado, ese envío pasa a `incierto` (`ejecutor_interrumpido`) y **no se reenvía a ciegas**. Su respuesta tardía lo resuelve. |
| Reintentos limitados | Un error transitorio vuelve a la cola con espera (en la simulación, 5 s); al tercer intento queda `fallido`. Un error definitivo falla sin reintentar. |
| Definitivo o incierto | Una respuesta incierta (sin respuesta o tiempo agotado) no se reintenta sola: la Cloud API no tiene clave de idempotencia y reenviar podría duplicar el mensaje. Lo decide un admin, con la advertencia del posible duplicado. |
| Topes | Al preparar: cantidad ≤ límite y cantidad × tarifa ≤ presupuesto (la base lo controla otra vez). Al tomar cada lote, se vuelven a aplicar sobre lo ya comprometido. |
| Consentimiento y bajas | Se revisan al preparar y **otra vez al tomar cada destinatario**. Una baja posterior lo deja `excluido` (`baja_posterior`) sin enviar. |
| Pausa y cancelación | En pausa no se toma nada. Cancelar pasa los pendientes a `cancelado`. Las entregas de lo ya aceptado se registran igual, porque en la realidad llegan por webhook. |

**Ejecutor por lotes** (`ejecutarLote`). Cada llamada es breve y reanudable:
1. Registra las entregas de lo aceptado en lotes anteriores.
2. Toma hasta N destinatarios: 5 desde el panel, 10 por defecto y 50 como máximo.
3. Envía con el proveedor simulado, con 10 s de tiempo máximo por envío. Pasado ese tiempo, el envío queda incierto.
4. Informa cada resultado a la base.
5. Si no queda nada por enviar, cierra la campaña.

El panel ofrece "Ejecutar un lote" y "Ejecutar hasta terminar". Este último es un bucle del navegador que se puede detener: cerrar la pestaña no pierde nada.

**El proveedor simulado no tiene estado y es determinístico.**
- El resultado de cada envío depende de un hash de `campaña:teléfono`, así que la misma campaña da siempre el mismo resultado.
- El `wamid` es estable por clave.
- Un envío "sin respuesta" se simula lanzando un error, que el ejecutor registra como incierto.

## Resultados y atribución

**Conteos** (con su rótulo de simulación):
- preparados, pendientes, excluidos por motivo, aceptados, entregados y no entregados;
- fallidos por motivo, inciertos y cancelados;
- costo simulado, que es entregados × tarifa.

**Vista `mkt_campania_atribucion`:** campaña → destinatario → cupón → compra.
- **Compra pagada:** con el cupón del destinatario, por separado para la reserva web y para la Gift Card (con la cantidad de tarjetas).
- **Regreso efectivo al stand:** un turno no cancelado en `turnos_stand` con el mismo teléfono canónico desde el día del envío, por día.

**Límites de la atribución:**
- Pagar una Gift Card no es volver al stand.
- El canje de una Gift Card en el stand no se vincula a un teléfono, así que no cuenta como regreso.
- Con beneficios ficticios no puede haber compras.

La verificación K13 prueba la relación con un código real sintético, y la integración prueba el regreso al stand.

## Ejecución desde el servidor (etapa real): qué hace falta

Hoy los lotes se disparan con acciones autenticadas del panel, más `POST /api/admin/marketing/campanias/ejecutar`, con `Authorization: Bearer ${CRON_SECRET}`, que corre un lote de cada campaña en ejecución. **No está programado.**

Para que una campaña real avance sola, sin una pestaña abierta, hace falta un disparador periódico de servidor que llame a ese endpoint cada pocos minutos.

| Opción | Qué permite (documentación oficial) | Veredicto |
|---|---|---|
| Cron de Vercel, plan **Hobby** (el actual) | 100 crons por proyecto, **una vez por día** y precisión de ±59 min ([Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Una expresión más frecuente hace fallar el despliegue; `lib/vercelCrons.test.ts` lo vigila. | No sirve para una campaña. **No se agregó ningún cron.** |
| Cron de Vercel, plan Pro | Una vez por minuto. | Es un servicio pago: no se usa. |
| **Supabase Cron** (`pg_cron` + `pg_net`) | Programa desde cada segundo hasta una vez al año y puede hacer un pedido HTTP ([Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)). Recomiendan no más de 8 jobs simultáneos y menos de 10 minutos por job. | Es el candidato: un job cada 1–5 min llama al endpoint con el secreto. Hay que confirmar que el plan del proyecto lo incluye y guardar el secreto en Vault, no en el SQL. |
| Bucle desde el panel | Lo que existe hoy. | Solo para la simulación: depende de una pestaña abierta. |

En Hobby, una función dura como máximo **300 s** ([Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration)). Por eso el ejecutor trabaja por lotes breves: un lote de 10 con 10 s por envío entra con holgura, y el turno de cada lote cubre su duración.

**La etapa real necesita además:**
- un proveedor de la Cloud API con una plantilla de marketing aprobada;
- el webhook de estados de entrega, que reemplaza a la entrega simulada;
- registrar como baja el error 131050 (la persona frenó el marketing);
- códigos reales de uso único por destinatario, con `codigo_id`;
- las decisiones pendientes.

## Pruebas

| Comando | Qué prueba | Resultado |
|---|---|---|
| `node scripts/pruebas/marketing-campanias.mjs` | 14 casos SQL (K1–K14): creación idempotente, versión, rangos, topes, duplicados, consentimiento al preparar, beneficios únicos y estables, exclusividad entre campañas, transiciones, baja posterior, ejecutor ajeno, reintentos, turno vencido → incierto → respuesta tardía, resolución por admin, pausa y cancelación, historial inmutable, prefijo reservado, atribución y permisos. La transacción se deshace. | 14/14 |
| `npx tsx lib/marketing/campanias.test.ts` | Validación (lo comercial arranca vacío), variables y render, capacidades, topes, proveedor simulado (bandas, determinismo, sin respuesta), guardián del entorno y mapeo de errores. Sin base y sin red. | OK |
| `node scripts/pruebas/correr-mutantes.mjs lib/marketing/campanias.integration.ts` | Rutas reales con **concurrencia real** y datos sintéticos (secciones 1–11, detalle abajo). | OK |

Secciones de la integración:
1. Audiencia vacía.
2. Vista previa con conteos exactos, sin teléfonos completos ni nombres.
3. Permisos y entorno.
4. Tres clics al crear.
5. Tres clics al preparar, con límite y beneficios no canjeables.
6. Presupuesto y exclusividad.
7. **Tres lotes simultáneos que envían cada destinatario una vez**, con costo = entregados × tarifa.
8. **Ejecutor cortado → incierto sin reenvío**, con baja posterior, respuesta tardía y reintento del admin.
9. Pausa, reanudación y cancelación sin borrar.
10. Errores transitorios, definitivos, reintentos agotados y tiempo agotado.
11. Regreso al stand.

La prueba concurrente del punto 4 encontró una carrera real al crear con la misma clave (dos `insert`, uno con 500). Se corrigió con un lock por clave en `mkt_campania_guardar`.

## Repetir la demostración

1. Levantar el stack local:
   ```bash
   npm run pruebas:iniciar
   ```
2. Cargar los datos sintéticos (aplica la migración):
   ```bash
   node scripts/pruebas/marketing-campanias-demo.mjs
   ```
   Carga 30 turnos inventados en la ventana, 15 teléfonos con consentimiento y 2 con baja.
3. Levantar el Next local con el proveedor falso: la configuración `marketing-local` de `.claude/launch.json`, o
   ```bash
   node scripts/pruebas/next-local.mjs dev --port 3120 --marketing-simulado
   ```
4. Entrar a `http://localhost:3120/admin/login` con la clave de admin de `.env.test.local` (local, generada al azar) y abrir **Marketing → Campañas (simulación)**.
5. Nueva campaña → completar los datos (la propuesta solo con "Cargar la propuesta para simular") → **Calcular audiencia** → **Guardar borrador** → **Preparar** → **Iniciar simulación** → **Ejecutar un lote** / **Pausar** / **Reanudar** / **Ejecutar hasta terminar** → resolver los inciertos → **Cancelar pendientes** en otra campaña.
6. Para probar la baja posterior: con la campaña preparada, en **Consentimiento** consultar uno de sus teléfonos sintéticos (`35180010xx`) y registrar la baja. Al ejecutar, ese destinatario queda "Pidió la baja después de preparar".
7. Al terminar, borrar la demo (las suites de integración necesitan el registro limpio):
   ```bash
   node scripts/pruebas/marketing-campanias-demo.mjs --limpiar
   ```

### Capturas (`docs/marketing/capturas-campanias/`, datos sintéticos)

| # | Pantalla |
|---|---|
| 01 | Escritorio: pestaña Campañas, avisos de simulación y decisiones pendientes. |
| 02 | Escritorio: formulario completo (con la propuesta rotulada "sin aprobar"), capacidades del módulo de Códigos y vista previa (24 candidatos, 15 elegibles, 8 seleccionados por límite y presupuesto, USD 0,48). |
| 03 | Escritorio: audiencia vacía (indicativo sin visitas): 0 elegibles explicado. |
| 04 | Escritorio: campaña preparada con la audiencia fijada y 8 beneficios SIMU-. |
| 05 | Escritorio: después del primer lote y de un **reinicio del servidor**: 1 aceptado, 3 a reintentar, 1 incierto, cola intacta. |
| 06 | Celular: campaña pausada. |
| 07a / 07b | Escritorio: completada con un incierto a decidir, y final: 5 entregados, 2 no entregados, 1 excluido por baja posterior, USD 0,30. |
| 08 | Celular: resultados finales. |
| 09 | Escritorio: cancelación: 5 entregados y 8 cancelados, con el historial completo. |
| 10 | Escritorio: lista de campañas. |
| 11 | Celular: vista de staff, solo lectura. |
| 12 | Celular: formulario y vista previa. |

## Despliegue (cuando corresponda; hoy NO)

- **Base:** la migración va después de `marketing-consentimiento.sql` y de `cupones-retencion.sql`. Es aditiva e idempotente.
- **Producción:** aplicarla allí no habilita escrituras, porque el guardián exige la base loopback. Agregaría las tablas vacías, el prefijo reservado y las RPCs, que solo `service_role` puede ejecutar. Por eso no hay apuro: puede esperar a la etapa real.
- **Antes de una campaña real:**
  - las decisiones pendientes;
  - el proveedor real y su webhook;
  - los códigos reales;
  - el disparador de servidor.

## Decisiones pendientes

1. **Condiciones comerciales de la campaña:** tipo, valor y vigencia del beneficio (el 15 % y los 7 días son una propuesta), y si un cupón puede cubrir varias Gift Cards. Hoy no se limita al comprar.
2. **Confirmación del control del teléfono:** si antes de una campaña real se exige verificar que la persona controla el número (por ejemplo, un código por WhatsApp). Hoy el consentimiento se registra, pero no se verifica.
