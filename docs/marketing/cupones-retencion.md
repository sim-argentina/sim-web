# Cupones de uso limitado: retención, consumo y liberación

Garantiza que un cupón con `usos_maximos` (por ejemplo, el cupón individual de la campaña del stand con `usos_maximos = 1`) no se use más veces que su límite entre **Reservas** y **Gift Cards**, aunque haya compras simultáneas, reintentos o notificaciones repetidas.

- **Base:** `db/cupones-retencion.sql` (en `db/orden.txt`, sección 13d).
- **Aplicación:** `lib/cuponesRetencion.ts`.
- **Estado:** en la rama `marketing-etapa1-simulacion`. La migración **no** está aplicada en Producción.

El cupón de campaña (`codigos_descuento`) no es el `codigo_unico` de una Gift Card. Ese otro código es el voucher que se canjea en el local, y este módulo no lo toca. Empresas (`empresa_codigos`) y Mensualidades (`MEN-…`) siguen con sus reglas.

## El ciclo

| Paso | Qué pasa | Dónde |
|---|---|---|
| **1. Retener** | Se hace antes de crear la compra y de habilitar cualquier pago con descuento. La base bloquea la fila del código (`FOR UPDATE`), cuenta usos y retenciones activas, y crea una retención para el intento. Si no hay cupo, responde `409 en_uso`. | `codigo_retener` |
| **2. Recalcular** | El descuento se vuelve a calcular sobre la fila bloqueada. Si no coincide con lo validado (porque alguien editó el código en el medio), se libera y no se cobra nada. | `evaluarCodigoDescuento` |
| **3a. Con pago** | La oportunidad de pago y su vencimiento quedan en la retención antes de llamar a Mercado Pago. La preferencia se crea con `expires` y `expiration_date_to` (30 minutos), y su link se guarda en la retención. | `codigo_retencion_vincular` |
| **3b. Sin pago** (100 % bonificada) | Se consume en el mismo pedido. Si falla, se deshace la compra y la retención se libera. | `codigo_retencion_consumir` |
| **4. Consumir** | Ocurre con un pago **aprobado** en el webhook, aunque la reserva termine en `conflicto_pago`, porque el descuento ya se cobró. Es idempotente: las notificaciones repetidas o simultáneas cuentan un solo uso. El uso queda en `usos_codigos_descuento`, en la misma transacción. | webhooks |
| **5. Liberar** | Ver la sección siguiente. | `codigo_retencion_liberar` + `resolverRetencion` |

Un **rechazo** o una **cancelación** no liberan nada. Mientras la preferencia no vence, la persona puede volver a intentar con otro medio de pago.

### Cuándo se puede liberar con seguridad

Una retención solo se libera en dos casos:

1. **Nunca existió una oportunidad de pago** (`sin_oportunidad_de_pago`). Pasa cuando el pedido falló antes de anotar el pago: turno ocupado, error al crear la compra o pedido inválido.
2. **Hubo oportunidad, pero se cumplen las tres condiciones siguientes** (`sin_pago_tras_vencer`):
   - Ya pasó `vence_en`, que es el vencimiento de la preferencia más 5 minutos. La base impide liberar antes.
   - La compra no quedó paga.
   - Mercado Pago (`GET /v1/payments/search?external_reference=…`) no tiene ningún pago aprobado ni abierto para esa compra:
     - Un pago `pending`, `in_process`, `authorized` o con un estado desconocido mantiene la retención.
     - Un pago `approved`, `refunded`, `charged_back` o `in_mediation` la consume.
     - Si Mercado Pago no responde, la retención se mantiene.

No hay temporizador que libere por su cuenta. La verificación la hace la próxima compra que encuentra el cupón ocupado por una retención ya vencida. Una retención abandonada que nadie vuelve a pedir queda como `retenido`, sin daño, porque nadie más quiere ese cupón.

Si igual llega un pago aprobado de una retención ya liberada, el caso se trata así:

- **Si queda cupo:** se consume (`consumida_tras_liberar`).
- **Si no queda cupo:** no se supera el límite. La retención queda anotada como `aprobado_sin_cupo` para revisarla a mano. La compra pagada **no** se bloquea.

### Reintentos

El navegador manda un `intento_id` que se mantiene en cada reintento del mismo pedido y cambia si cambia el pedido.

| Situación | Respuesta |
|---|---|
| Mismo intento, ya con link | El **mismo** link y la misma compra. No se abre otra oportunidad. |
| Mismo intento, el anterior falló (Mercado Pago caído o la respuesta no llegó) | Se rehace la preferencia de la **misma** compra, con la misma `external_reference`. En Reservas se vuelve a verificar el turno. |
| Doble clic (dos pedidos iguales a la vez) | Uno recibe el link y el otro `409 intento_en_curso`. Nunca hay dos links. |
| Mismo intento con otro pedido | `409 intento_con_otro_pedido` |
| Compra ya pagada | `409 compra_ya_pagada` |
| Bonificada ya hecha | Se devuelve la misma compra. |

Si Mercado Pago creó la preferencia pero no recibimos la respuesta, su link nunca salió del servidor, así que nadie puede usarlo. Además vence a los 30 minutos. Mercado Pago no documenta `X-Idempotency-Key` para preferencias (solo para crear pagos), por eso no se usa para deduplicar.

## Varias Gift Cards en una compra

Es la regla de siempre y **no cambió**:

- El código se valida y se descuenta **una vez sobre el total** (precio × cantidad, hasta 10).
- Con tarjetas separadas, el descuento se reparte entre ellas; con tarjetas juntas, va entero en la única fila.
- La compra cuenta **un uso**, sean 1 o 10 tarjetas, y tiene una sola retención.

> **Decisión pendiente del owner.** Con esta regla, un cupón de campaña del 100 % (o de porcentaje alto) aplicado a 10 Gift Cards descuenta las 10 con un solo uso. Si la campaña no lo quiere, hay que decidirlo antes de distribuir códigos. Las opciones son limitar la cantidad para cupones de campaña, o usar `monto_fijo` con tope. El porcentaje y la vigencia del cupón siguen siendo **propuestas** (el 15 % y los 7 días no están aprobados).

## Mercado Pago: lo verificado en la documentación oficial

| Capacidad | Qué dice la documentación |
|---|---|
| Vencimiento de la preferencia | `expires`, `expiration_date_from` y `expiration_date_to` definen el "límite máximo de pago" ([Configurar vigencia](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/additional-settings/term-of-preference)). |
| Pagos offline | `date_of_expiration`. Un pago hecho después de esa fecha se devuelve ([Fecha de vencimiento](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/expiration-date.md)). No se cambió: queda el valor de Mercado Pago, y mientras un pago offline siga pendiente la retención no se libera. |
| Búsqueda de pagos | `GET /v1/payments/search` filtrado por `external_reference` ([Gestión de pagos](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/payment-management)). |
| Cancelación | `PUT /v1/payments/{id}` con `status: cancelled`, solo sobre pagos `pending`, `in_process` o `authorized` ([Cancelaciones](https://www.mercadopago.com.ar/developers/en/reference/chargebacks/_payments_payment_id/put)). **No se usa:** no se cancela nada automáticamente. |
| Idempotencia | `X-Idempotency-Key` está documentado para crear pagos ([Idempotencia](https://www.mercadopago.com.ar/developers/es/docs/wallet-connect/payment-flow/idempotency.md)), **no** para preferencias. |
| Excluir medios de pago | `payment_methods.excluded_payment_types` existe ([Medios de pago](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/payment-methods.md)). **No se usa:** cambiaría la oferta de pago. |

## Qué cambia para cada caso

- **Códigos sin `usos_maximos`:** sin retención ni vencimiento de la preferencia. Siguen el camino de siempre (`consumir_codigo_descuento` en el webhook).
- **Compras sin código:** igual que siempre.
- **Compras con código limitado:** la preferencia vence a los 30 minutos (`VENTANA_PAGO_CUPON_MIN`). Este cambio de comportamiento es nuevo, y es lo que acota la retención.
- **`consumir_codigo_descuento`:** la RPC de siempre ahora también cuenta retenciones. Ningún camino supera el límite, ni siquiera el de compras creadas antes de esta versión.
- **Devoluciones:** no restauran usos. No hay regla comercial que lo diga.

## Pruebas

| Comando | Qué prueba |
|---|---|
| `node scripts/pruebas/cupones-retencion.mjs` | Las RPCs en SQL, 13 casos. La transacción se deshace. |
| `npx tsx lib/cuponesRetencion.test.ts` | Las decisiones puras: reintentos, huella y vencimiento. |
| `node scripts/pruebas/correr-mutantes.mjs lib/cuponesRetencion.integration.ts` | Las rutas reales contra el stack local, con **concurrencia real** (`Promise.all`) y Mercado Pago interceptado, sin pagos. Detalle abajo. |

La suite de integración cubre:

- Reserva contra Reserva (5), Gift Card contra Gift Card (6), Reserva contra Gift Card (3 + 3) y bonificadas simultáneas.
- Reintentos y doble clic.
- Mercado Pago caído, o preferencia creada sin respuesta.
- Pago pendiente, o Mercado Pago sin responder.
- Rechazo y reintento con otro medio.
- Cuatro notificaciones simultáneas más una tardía.
- Pago aprobado después de vencer y después de liberar.
- Reserva en conflicto.
- Varias Gift Cards en una compra.
- Compras sin código o con código sin límite.

La corrida de control con el código anterior falla en el caso 1: las 5 reservas simultáneas pagan con el mismo cupón de un uso.

## Antes de distribuir códigos

1. Aplicar `db/cupones-retencion.sql` en Producción, con autorización. Reemplaza `consumir_codigo_descuento`; el rollback es `db/codigos-b9-fecha-argentina.sql`.
2. Desplegar las rutas y las páginas juntas. Una pestaña vieja sin `intento_id` funciona igual, pero sus reintentos no reutilizan el intento.
3. Que el owner decida la regla de varias Gift Cards con cupón de campaña (ver arriba), y el tipo, el valor y la vigencia del cupón.
4. **No hay barrido periódico** de retenciones vencidas. Vercel Hobby solo permite crons diarios. No hace falta para la exclusividad, pero el panel de códigos todavía no muestra las retenciones: un código "apartado" se ve con 0 usos.
5. El cupón no está atado a un teléfono: quien lo recibe puede reenviarlo. El primero que lo retiene lo usa.
6. Los pagos offline (Rapipago/Pago Fácil) pueden quedar pendientes días. Mientras tanto la retención se mantiene, que es lo correcto, pero ese cupón queda apartado.
