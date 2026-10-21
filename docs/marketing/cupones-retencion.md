# Cupones de uso limitado: retención, consumo, conciliación y despliegue

Garantiza que un cupón con `usos_maximos` no se use más veces que su límite entre **Reservas** y **Gift Cards**, aunque haya compras simultáneas, reintentos, notificaciones repetidas, operaciones a medias o una transición de versión. El caso típico es el cupón individual de la campaña del stand, con `usos_maximos = 1`.

- **Base:** `db/cupones-retencion.sql` (en `db/orden.txt`, sección 13d), con su rollback en `db/cupones-retencion.rollback.sql`.
- **Aplicación:** `lib/cuponesRetencion.ts`, con la lectura del panel en `lib/cuponesRetencionPanel.ts` y el acceso a Mercado Pago en `lib/mercadoPagoApi.ts`.
- **Estado:** en la rama `marketing-etapa1-simulacion`. La migración **no** está aplicada en Producción.

El cupón de campaña (`codigos_descuento`) no es el `codigo_unico` de una Gift Card. Ese otro código es el voucher que se canjea en el local, y este módulo no lo toca. Empresas (`empresa_codigos`) y Mensualidades (`MEN-…`) siguen con sus tablas y reglas; la suite de compatibilidad verifica que Empresas no cambie.

## El ciclo

| Paso | Qué pasa | Dónde |
|---|---|---|
| **1. Retener** | Se hace antes de crear la compra y de habilitar cualquier pago con descuento. La base bloquea la fila del código (`FOR UPDATE`), cubre las compras anteriores sin retención (ver *Compatibilidad*), cuenta usos y retenciones activas, y crea una retención para el intento. Si no hay cupo, responde `409 en_uso`. | `codigo_retener` |
| **2. Recalcular** | El descuento se vuelve a calcular sobre la fila bloqueada. Si no coincide con lo validado (porque alguien editó el código en el medio), se libera y no se cobra nada. | `evaluarCodigoDescuento` |
| **3a. Con pago** | Un solo pedido a la vez toma el **turno de preparación** de la retención. Antes de llamar a Mercado Pago quedan anotados la oportunidad de pago y su vencimiento. La preferencia se crea con `expires` + `expiration_date_to` (30 minutos), y su link se guarda en la retención con el turno, que así se devuelve. | `prepararPagoConRetencion` |
| **3b. Sin pago** (100 % bonificada) | Se consume en el mismo pedido. Si falla, se deshace la compra y la retención se libera. | `codigo_retencion_consumir` |
| **4. Consumir** | Ocurre con un pago **aprobado** en el webhook, aunque la reserva termine en `conflicto_pago`, porque el descuento ya se cobró. Es idempotente: las notificaciones repetidas o simultáneas cuentan un solo uso. Si el camino anterior ya había contado ese pago o esa reserva, no lo suma otra vez (`ya_contado`). | webhooks |
| **5. Liberar** | Ver *Cuándo se libera*. | `resolverRetencion` |

Un **rechazo** o una **cancelación** no liberan nada. Mientras la preferencia no vence, la persona puede volver a intentar con otro medio de pago.

## Cuándo se libera (y cuándo no)

Hay solo dos caminos para liberar, y ninguno depende de un temporizador local.

1. **Nunca existió una oportunidad de pago** (`sin_oportunidad_de_pago`). El pedido falló antes de anotarla: turno ocupado, error al crear la compra o pedido inválido. La base rechaza este motivo si la oportunidad ya estaba anotada.
2. **`sin_pago_tras_vencer`**, solo si se cumple **todo** lo siguiente:
   - Ya pasó `vence_en`: el vencimiento de la preferencia más **15 minutos**. Mercado Pago no documenta cuánto tarda un pago en aparecer en la búsqueda, y el margen es deliberadamente amplio. La base impide liberar antes, y también mientras otro pedido tiene el turno de preparación.
   - La compra no quedó paga.
   - **Pagos:** "Buscar en pagos" devuelve **todas** las páginas (máximo 50 por página, según la documentación) y coinciden con `paging.total`, sin ningún pago que pueda aprobarse ni que se haya aprobado:
     - `pending`, `in_process`, `authorized` o un estado desconocido mantienen la retención.
     - `approved`, `refunded`, `charged_back` o `in_mediation` la consumen.
   - **Preferencias:** todas las de esa compra (la búsqueda completa, más la guardada en la retención) tienen `expires = true` y `expiration_date_to` vencida, con el margen. Si a una le falta `expires` en la búsqueda, se confirma con "Obtener preferencia".

**Ante cualquier incertidumbre, la retención se conserva y queda anotado el motivo:**

| Situación | Motivo anotado |
|---|---|
| La consulta de pagos falló o quedó incompleta (paginación pendiente o total que no cierra) | `consulta_de_pagos_incompleta` |
| La búsqueda de preferencias falló o quedó incompleta | `consulta_de_preferencias_incompleta` |
| Mercado Pago no respondió | `mercado_pago_no_responde:…` |
| Hay un link que todavía puede pagarse | `preferencia_vigente` |
| Hay un link que no vence (compras anteriores a esta versión) | `preferencia_sin_vencimiento` |
| La compra es demasiado vieja para buscarla (más de 85 días, sin preferencia guardada) | `fuera_de_ventana_de_busqueda` |

Las garantías en las que se apoya la regla son estas:

- **`expiration_date_to`** es el "límite máximo de pago" de la preferencia.
- **Pagos offline:** uno hecho después de su `date_of_expiration` se devuelve. Mientras siga pendiente aparece en la búsqueda como `pending` y mantiene la retención.
- **Cobertura de las búsquedas:** la de pagos abarca 12 meses y la de preferencias 90 días.

Si igual llega un pago aprobado de una retención ya liberada:

- **Si queda cupo:** se consume (`consumida_tras_liberar`).
- **Si no queda cupo:** no se supera el límite. Queda anotada como `aprobado_sin_cupo`, el panel la marca **para revisar**, y la compra pagada **no** se bloquea.

## Conciliación operativa: quién la ejecuta

La misma función (`resolverRetencion`) la disparan tres caminos. Repetirla es seguro, porque cada transición la vuelve a validar la base.

| Quién | Cómo | Autenticación |
|---|---|---|
| La compra siguiente | Cuando encuentra el cupón ocupado por retenciones ya vencidas, las verifica y reintenta una vez. | — |
| El panel | **Códigos → Ver / Revisar → "Revisar estado"** (una retención) o **"Revisar las vencidas en Mercado Pago"** (las del código). | Sesión de **admin**, origen propio. `POST /api/admin/cupones/conciliar` |
| El cron diario | Revisa hasta 50 retenciones vencidas, empezando por las más viejas. Corre a las 05:20 UTC (`vercel.json`). | `Authorization: Bearer ${CRON_SECRET}`, comparado en tiempo constante. `GET /api/admin/cupones/conciliar` |

**Registro:** cada revisión queda en la retención (`revisiones`, `revisada_en`, `revision_resultado`, `revision_motivo`) y en el registro de seguridad (`cupon_conciliacion`, `cupones_conciliacion`). No existe ningún botón que libere ignorando Mercado Pago.

**Retenciones abandonadas:** una compra que nadie paga se libera en la primera conciliación que pase después de su `vence_en`. Puede ser la compra siguiente, el panel o el cron diario. Hasta entonces el cupón figura **apartado**.

## Recuperación de operaciones incompletas

Para entregar un link de pago, el camino es siempre este:

1. Tomar el turno de preparación.
2. Si es un reintento, **buscar primero** la preferencia que pudo quedar creada (búsqueda por `external_reference` y, para el link, "Obtener preferencia").
3. Si no hay ninguna pagable, crear una para la **misma** compra.

Mercado Pago no documenta `X-Idempotency-Key` para preferencias (solo para crear pagos), así que la deduplicación se hace con esta búsqueda.

| Caso | Qué pasa | Probado en |
|---|---|---|
| Mercado Pago creó la preferencia y SIM perdió la respuesta | 500 sin link. El reintento la encuentra y entrega **ese** link, sin crear otra. | integración 16a · navegador (Gift Cards) |
| SIM recibió la preferencia y falló al guardarla | No se entrega un link que no quedó guardado. El reintento la recupera. | integración 16b |
| El navegador reintenta mientras el primer pedido sigue en Mercado Pago | `409 intento_en_curso`, porque el turno lo frena aunque ya haya pasado la gracia. Después recibe el mismo link. | integración 16c · navegador (doble clic) |
| El servidor se cae después de que Mercado Pago creó la preferencia | El turno vence (45 s). El reintento recupera la preferencia del pedido muerto. | integración 16d |
| El servidor se cae antes de crear nada | Vencido el turno, el reintento no encuentra ninguna y crea una sola. | integración 16d |
| Mercado Pago falla y no crea nada | La compra queda `error_pago` y la retención con la oportunidad anotada. El reintento revive **la misma** reserva (verificando el turno de nuevo) y crea la preferencia. | integración 6 · navegador (Reservas) |
| No se puede verificar en Mercado Pago durante un reintento | `503 verificando_pago`. No se crea otra preferencia "por las dudas". | código (`prepararPagoConRetencion`) |

Una preferencia cuyo link nunca salió del servidor no la puede pagar nadie: el link solo lo conoce SIM. Además vence a los 30 minutos.

## El navegador

- **Clave del intento** (`lib/intentoCompra.ts`): es la misma para el mismo pedido aunque se recargue la página o se vuelva desde Mercado Pago (`sessionStorage`, solo esa pestaña), y otra en cuanto cambia el pedido.
  - Se guardan la clave y un hash del pedido, **nunca el nombre ni el teléfono**.
  - La casilla de promociones no cuenta como cambio: su token se renueva en cada carga.
  - La clave sola no autoriza nada: el servidor la ata a la huella completa del pedido. El mismo intento con otro pedido recibe `409` sin datos (integración 20).
- **"Tenés un pago iniciado"** (`components/PagoPendiente.tsx`): al volver desde Mercado Pago, la compra sigue pendiente y su turno y su cupón siguen ocupados por ella.
  - La página ofrece **Continuar el pago**, que lleva al mismo link, o **Armar otra compra**.
  - "Armar otra compra" avisa que el código queda apartado hasta que ese link venza.
  - La página de éxito borra el aviso.

## Panel de Códigos

Mismo permiso que el resto del panel (admin).

- **Resumen:** usos consumidos, retenidos (compras en curso) y retenciones a revisar.
- **Tabla:** **Consumidos**, **Retenidos** y **Disponibles**.
  - Disponibles = máximo − consumidos − retenidos. Un código con 0 consumidos pero retenido se ve **"0 · apartado"**; sin límite, **"Sin límite"**.
  - El botón **Revisar (n)** aparece cuando hay retenciones vencidas sin confirmar o pagadas sin cupo.
- **Detalle de un código:** cada retención con su compra (reserva #, estado, fecha y hora, o Gift Cards, estado y cantidad), producto, fechas (retenida, no se revisa antes de, consumida o liberada y por qué), importes, pago, última revisión y su motivo.
  - No muestra el intento, la huella, el link de pago ni datos de la persona (integración 19).
- Sin la migración, el panel lo avisa.

## Compatibilidad del despliegue

Lo prueba `lib/cuponesRetencion.compatibilidad.integration.ts`, que arma en el stack local una base **sin** la migración (con el propio rollback) y después la aplica.

| Situación | Resultado |
|---|---|
| Aplicación nueva + base sin migración | Los cupones limitados **fallan cerrados**: `503 no_disponible`, sin crear compra ni cobrar (A1). Sin cupón y con cupón sin límite, todo igual (A2). Los webhooks siguen el camino de siempre (A3). |
| Compras creadas antes de migrar (sin retención) | Al migrar, cada compra **pendiente** con cupón limitado recibe una retención `legado` con oportunidad de pago (B1): reservas en `pendiente_pago`/`error_pago` y grupos de Gift Cards sin pago en `pendiente_pago`/`rechazado`/`cancelado`. `codigo_retener` repite esa cobertura para el código que retiene. |
| Su link no vence (versión anterior) | La retención queda hasta que Mercado Pago confirme que nada se puede pagar. Hasta entonces el cupón sigue apartado, motivo `preferencia_sin_vencimiento`, para revisar (B2). |
| Webhook de una compra vieja después de migrar | Consume su retención `legado` **una vez**, aunque llegue repetido (B3). |
| Compra vieja sin nada pagable | Se libera después de verificarlo (B4). |
| Una instancia vieja ya contó el uso con la RPC de siempre | La retención queda consumida **sin sumar** (`ya_contado`, deduplicado por pago o reserva en `usos_codigos_descuento`) (B5). |
| Otros módulos | Empresas intacto, sin retenciones ajenas (B6). |

Producción al 21/10/2026 (consulta de solo lectura, solo conteos): 3 códigos de descuento, los 3 con límite y activos, y **0** compras pendientes con esos códigos, así que la cobertura `legado` no crearía ninguna hoy. Ningún código está excedido. Empresas tiene 25 códigos en su propia tabla.

## Despliegue (orden recomendado)

1. **Chequeos previos, de solo lectura, en Producción:**
   - Que `CRON_SECRET` exista en las variables del proyecto de Vercel. Sin él, el cron responde 401 y la conciliación queda en el panel y en la compra siguiente.
   - Contar las compras pendientes con cupón limitado:
     ```sql
     select count(*) from reservas r join codigos_descuento c on c.codigo = r.codigo_descuento
      where c.usos_maximos is not null and r.mercado_pago_payment_id is null and r.estado in ('pendiente_pago','error_pago');
     ```
2. **Desplegar primero la aplicación** (push a `main`). Desde ese momento, y hasta migrar, los cupones **limitados** se rechazan con 503 (fallo cerrado probado en A1): no se cobra nada con ellos y no hay forma de superar el límite. Sin cupón y con cupón sin límite, todo normal. Los webhooks siguen el camino de siempre.
3. **Esperar** a que el dominio sirva el build nuevo (`get_deployment("simexperience.com.ar")`) y unos 5 minutos más, para que ninguna instancia vieja siga creando compras.
4. **Aplicar la migración** `db/cupones-retencion.sql` (MCP `apply_migration`). Cubre en la misma migración las compras pendientes de antes.
5. **Verificar:**
   - El panel de Códigos muestra Retenidos y Disponibles sin el aviso de "no instaladas".
   - `GET /api/admin/cupones/conciliar` sin secreto responde 401.
   - Un cupón limitado de prueba en un checkout responde con link (sin pagar).
6. **Recién después**, y con las decisiones de abajo tomadas, generar y distribuir cupones de campaña.

El orden inverso (migrar primero) deja un rato en el que la aplicación vieja crea compras **sin** retención y su webhook consume con la RPC de siempre. No se cuenta dos veces (B5), pero en ese rato la exclusividad es la de antes.

## Rollback

1. **Volver a desplegar la aplicación anterior** y esperar a que el dominio la sirva.
2. **Revisar las retenciones vigentes** (la consulta está al final de `db/cupones-retencion.rollback.sql`). Si se puede, conciliarlas antes desde el panel.
3. **Correr `db/cupones-retencion.rollback.sql`.** Hace tres cosas:
   - Restaura `consumir_codigo_descuento` (cuerpo de B9).
   - Quita las RPCs nuevas: si quedara alguna instancia nueva, falla cerrada.
   - **Conserva** `codigo_retenciones` como registro de solo lectura.

**Limitación, cuando ya existen operaciones nuevas:** las retenciones en `retenido` dejan de contar.

- Si esas compras se pagan después, el webhook anterior consume con el contador de siempre.
- Si el cupón ya llegó a su máximo, ese uso **no** se cuenta y la compra igual queda paga: es el comportamiento previo a esta versión.
- Las preferencias creadas por la versión nueva siguen venciendo a los 30 minutos (eso lo aplica Mercado Pago).

Volver atrás **solo la aplicación** (sin el SQL) no se recomienda: las retenciones no se resolverían nunca y el cupón quedaría apartado.

## Mercado Pago: lo verificado en la documentación oficial

| Capacidad | Qué dice la documentación | Uso |
|---|---|---|
| Vencimiento de la preferencia | `expires`, `expiration_date_from` y `expiration_date_to` definen el "límite máximo de pago" ([Configurar vigencia](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/additional-settings/term-of-preference)). | 30 min con cupón limitado |
| Pagos offline | `date_of_expiration`. Un pago hecho después se devuelve ([Fecha de vencimiento](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/expiration-date.md)). | No se cambió; un pago offline pendiente mantiene la retención |
| Buscar en preferencias | Filtra por `external_reference`, cubre los últimos 90 días y pagina con `next_offset`/`total` ([referencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/search-preferences/get)). | Recuperar y verificar |
| Obtener preferencia | Devuelve `init_point` y su vencimiento ([referencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-preference/get)). | Recuperar el link |
| Buscar en pagos | Filtra por `external_reference` y cubre 12 meses ([referencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/search-payments/get)). Máximo 50 por página y `paging.total` ([Gestión de pagos](https://mercadopago.com.ar/developers/en/docs/subscriptions/additional-content/payment-management)). | Verificar con todas las páginas |
| Cancelación | `PUT /v1/payments/{id}` con `cancelled`, solo sobre `pending`, `in_process` o `authorized` ([Cancelaciones](https://www.mercadopago.com.ar/developers/en/reference/chargebacks/_payments_payment_id/put)). | No se usa |
| Idempotencia | `X-Idempotency-Key` está documentado para crear pagos ([Idempotencia](https://www.mercadopago.com.ar/developers/es/docs/wallet-connect/payment-flow/idempotency.md)), no para preferencias. | No se usa para deduplicar |

El SDK (v2.12.0) reintenta dos veces los errores 5xx y los cortes, con la misma clave. Por eso el turno de preparación cubre 45 segundos.

## Varias Gift Cards en una compra

Es la regla de siempre y **no cambió**:

- El código se valida y se descuenta **una vez sobre el total** (precio × cantidad, hasta 10).
- Con tarjetas separadas, el descuento se reparte entre ellas; con tarjetas juntas, va entero en la única fila.
- La compra cuenta **un uso**, sean 1 o 10 tarjetas, y tiene una sola retención.

## Decisiones pendientes (antes de distribuir códigos)

1. **Condiciones comerciales de la campaña:**
   - Tipo y valor del descuento: el 15 % es una propuesta, no está aprobado.
   - Vigencia: los 7 días son una propuesta.
   - Si un cupón puede aplicarse a varias Gift Cards. Con la regla actual, un cupón del 100 % cubre hasta 10 tarjetas con un solo uso. Las opciones son limitar la cantidad para cupones de campaña o usar `monto_fijo` con tope.
2. **Confirmación del control del teléfono:**
   - El cupón no está atado a un teléfono: quien lo recibe puede reenviarlo, y el primero que lo retiene lo usa.
   - El alta de promociones por la web tampoco verifica que la persona controle ese número (no hay doble opt-in).
   - Hay que decidir si se exige esa confirmación (por ejemplo, un código por WhatsApp) antes de enviar cupones.

## Pruebas

| Comando | Qué prueba |
|---|---|
| `node scripts/pruebas/cupones-retencion.mjs` | Las RPCs en SQL, 18 casos (turno, legado, conteo único y registro de revisión incluidos). La transacción se deshace. |
| `npx tsx lib/cuponesRetencion.test.ts` | Reintentos, turno, fallo cerrado, marca de revisión, clave del navegador (sin datos personales) y guarda del simulador. |
| `node scripts/pruebas/correr-mutantes.mjs lib/cuponesRetencion.integration.ts` | Rutas reales con **concurrencia real** y Mercado Pago interceptado, 21 bloques. Desde el 16: recuperación, consultas inciertas, cron y panel, API del panel e intento ajeno. |
| `node scripts/pruebas/correr-mutantes.mjs lib/cuponesRetencion.compatibilidad.integration.ts` | Despliegue: base sin migración, compras previas, migración, dedupe y Empresas. Cambia el esquema local: correrla sola; deja la migración aplicada. |
| `node scripts/pruebas/next-local.mjs dev --port 3110 --mp-simulado` (o `cupones-local` en `.claude/launch.json`) | El sitio local con **Mercado Pago simulado** (`/pruebas/mercadopago`, 404 fuera del entorno local de pruebas) para probar en el navegador. |

La corrida de control con el código anterior falla en el caso 1: las 5 reservas simultáneas pagan con el mismo cupón de un uso.

### Prueba en el navegador

Se hizo el 21/10/2026, con datos sintéticos y el simulador. Las capturas están en `docs/marketing/capturas-cupones/`.

**Reservas, en escritorio:**
- Cupón aplicado (01) y pago simulado (02).
- Doble clic: una sola preferencia.
- Otro pedido con el cupón apartado: mensaje claro (03).
- Mercado Pago caído (04), y el reintento revive la **misma** reserva.
- Al volver: "Tenés un pago iniciado", que continúa al mismo link (05).
- Pago aprobado, webhook firmado, reserva activa y cupón consumido una vez (06).

**Gift Cards, en celular:**
- Respuesta perdida: el reintento recupera la misma preferencia.
- Pago simulado (07), aviso al volver (08) y "Armar otra compra" (09).
- Un pedido distinto (2 tarjetas) con el mismo cupón: apartado, nunca la compra anterior (10).
- Bonificada al 100 %, consumida una vez (11).
- Sin cupón: preferencia sin vencimiento, como siempre.

**Panel:**
- Resumen (12) y tabla con consumidos, retenidos y disponibles (13).
- Detalle "a revisar" (14).
- "Revisar estado": liberada, motivo "Venció sin pagos", con la revisión registrada (15).
