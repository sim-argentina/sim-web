# WhatsApp Cloud API: integración preparada y guía de conexión

La integración oficial con WhatsApp Cloud API (Meta) quedó **implementada y probada con transporte simulado**. Los envíos reales siguen **bloqueados**: ninguna prueba ni campaña sale a la red. No se registró, migró ni desconectó ningún número, y no se tocó ninguna cuenta externa.

- **Rama:** `marketing-etapa1-simulacion`.
- **Migraciones:** `db/marketing-whatsapp.sql` (13f), más los cambios en `db/marketing-consentimiento.sql` y `db/marketing-campanias.sql`. **No** están aplicadas en Producción.
- **Fuentes:** la documentación oficial de Meta consultada el 27/10/2026 (enlaces al final). En cada punto se marca qué está **documentado** y qué está **comprobado para la cuenta de SIM**. Hasta hoy no se comprobó nada contra la cuenta de SIM: no hay credenciales cargadas en este entorno.

## Qué hay en el código

| Pieza | Archivo | Qué hace |
|---|---|---|
| Adaptador de envío | `lib/marketing/whatsappCloud.ts` | Ver el detalle debajo de esta tabla. |
| Bloqueo de envíos reales | `evaluarEnvioReal` | **Apagado por defecto.** Ver el detalle debajo de esta tabla. |
| Webhook | `app/api/whatsapp/webhook/route.ts` y `lib/marketing/whatsappWebhook.ts` | Ver la sección "Webhook". |
| Bandeja persistente | `db/marketing-whatsapp.sql` | Ver la sección "Webhook". |
| Bajas por WhatsApp | `mkt_wa_registrar_baja` (en `db/marketing-consentimiento.sql`) | Fuente `whatsapp`, solo de baja. Ver la sección "Bajas por WhatsApp". |
| Intentos y estados | `mkt_whatsapp_envios` (en `db/marketing-campanias.sql`) | Ver la sección "Estados de entrega". |
| Diagnóstico | Admin → Marketing → **WhatsApp** (`/api/admin/marketing/whatsapp`) | Ver la sección "Diagnóstico en Admin". |
| Disparador de servidor | `db/marketing-campanias-cron.plantilla.sql` y `POST /api/admin/marketing/campanias/ejecutar` | Ver la sección "Ejecución independiente". |

### Adaptador de envío

- Envía plantillas por `POST https://graph.facebook.com/<VERSIÓN>/<PHONE_NUMBER_ID>/messages`, con `Authorization: Bearer`.
- La versión es **explícita** (`WHATSAPP_GRAPH_VERSION`) y el tiempo máximo es de 10 s.
- Valida los parámetros antes de salir y clasifica los errores.
- Registra el `wamid`.
- **Nunca** marca algo como entregado: eso llega después por webhook.

### Bloqueo de envíos reales

- Solo se abre con `MARKETING_WHATSAPP_ENVIOS_REALES="true"` (el literal), más la configuración y la plantilla completas.
- Se comprueba en **cada** envío, antes de armar el pedido.
- Tener las credenciales cargadas no habilita nada por sí solo.
- Además, en esta etapa ninguna campaña puede usar el adaptador: la base solo admite `modo = 'simulacion'`.

### Garantías del envío

**La idempotencia es solo local.** La clave `campaña:teléfono` evita que SIM pida dos veces en el flujo normal, pero Meta **no documenta** una clave de idempotencia para `/messages`.

**Cuándo un envío queda incierto.** Si no hay respuesta legible, el resultado queda **incierto** y se conserva así. Pasa con:
- tiempo agotado;
- un corte de red;
- un 5xx sin código;
- un 200 sin id.

No se reenvía suponiendo que falló. Lo decide un admin desde el panel, con la advertencia del posible duplicado.

**Clasificación de errores** ([códigos de error](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)):

| Código | Tratamiento |
|---|---|
| 2, 4, 130429, 131000, 131016, 131056 | Transitorios: se reintenta con espera, hasta 3 intentos. |
| 131049 | Se puede reintentar recién a las 24 h; para la campaña es definitivo. |
| 131050 | La persona frenó el marketing: definitivo, y **además registra la baja**. |
| 1, o un 5xx sin código | Incierto. |
| El resto | Definitivo. |

**La respuesta de la API no es una entrega.** La [referencia de envío](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages.md) aclara que la respuesta solo indica que la API **aceptó** el pedido. El campo `message_status` (`accepted`, `held_for_quality_assessment` o `paused`) se guarda tal cual.

**`biz_opaque_callback_data` queda opcional y apagado.** Está documentado en el webhook de estados: vuelve si el envío lo incluyó. Pero no figura en la referencia de envío que se pudo consultar. Se activa con `MARKETING_WHATSAPP_BIZ_OPAQUE=true` después de probarlo con el número de prueba. Si está y llega, permite resolver un envío incierto cuando Meta informa su estado.

## Webhook

### Recepción y validación

- **Verificación de la suscripción (GET):**
  - Compara `hub.verify_token` en tiempo constante y responde `hub.challenge`.
  - Registra la verificación para el diagnóstico.
  - Sin `WHATSAPP_VERIFY_TOKEN` responde 503.
- **Firma (POST):**
  - Se calcula `HMAC-SHA256(app secret)` sobre los **bytes recibidos**, antes de parsear, y se compara con `X-Hub-Signature-256`.
  - **Sin `WHATSAPP_APP_SECRET`, sin el número o sin la cuenta, no se procesa nada:** responde 503.
  - Antes, sin el secreto, el webhook procesaba sin validar la firma; eso se corrigió.
  - Una firma inválida o ausente responde 401.
- **Cuenta y número de SIM:**
  - `entry[].id` tiene que ser `WHATSAPP_BUSINESS_ACCOUNT_ID`.
  - `value.metadata.phone_number_id` tiene que ser `WHATSAPP_PHONE_NUMBER_ID`.
  - Lo ajeno se cuenta como rechazo y no se procesa.
- **Tamaño:** hasta 3 MB, el límite documentado.

### Persistencia e idempotencia

- Cada novedad se **guarda** en `mkt_whatsapp_eventos` antes de responder 200, con una clave única:
  - `estado:<wamid>:<status>`
  - `mensaje:<id>`
  - `preferencia:<wa_id>:<valor>:<timestamp>`
- Meta reintenta hasta 7 días y puede duplicar eventos. Un duplicado no se vuelve a guardar ni a contar.
- Si la base falla, responde **500** y no deja nada a medias: Meta reintenta.

### Procesamiento

- Va aparte y se puede repetir: lo disparan el mismo webhook, cada lote del ejecutor, el disparador de servidor y el botón "Reprocesar pendientes".
- Usa `SKIP LOCKED`, así dos procesos no toman el mismo evento.
- Un evento que falla queda pendiente con su error. A los 5 intentos queda `error`.

### Qué se guarda

- No se guardan textos de conversación. De un mensaje entrante solo queda:
  - si es un pedido **inequívoco** de baja;
  - a qué mensaje responde;
  - el teléfono de WhatsApp (en el panel, enmascarado).
- Finanzas, el MVP de carga por WhatsApp de siempre, sigue igual, pero ahora solo con eventos firmados de la cuenta de SIM.

## Estados de entrega

Los estados (`sent`, `delivered`, `read`, `failed`) se relacionan con el **destinatario y el intento** de `mkt_whatsapp_envios`:
- por `wamid`;
- o por `biz_opaque_callback_data`, cuando el envío quedó incierto y sin `wamid`.

Solo se tienen en cuenta los envíos `real`. Un `wamid` SIMULADO nunca coincide.

**Orden y duplicados.** La documentación no garantiza el orden y aclara que un `delivered` puede faltar si se leyó enseguida. Por eso los estados **no retroceden**:

```
sin_estado → enviado → entregado → leido
'fallido' solo antes de 'entregado'
```

Un estado repetido o tardío deja las fechas que ya había. Los conteos salen de las filas, no de sumar, así que nunca se duplican.

**Costo.** Meta cobra lo **entregado** ([precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)) y lo marca en el webhook de entrega con `pricing.type = "regular"` (cobrable).
- Una aceptación de la API **no** suma costo.
- Para los envíos reales, el costo del panel es un **estimado** (entregados cobrables × tarifa de referencia), no la factura de Meta.
- Simulados y reales van separados por `origen`.

## Bajas por WhatsApp

| Origen | Cuándo |
|---|---|
| `texto` | El mensaje **entero** es un pedido inequívoco: BAJA, STOP, UNSUBSCRIBE, DESUSCRIBIRME, "NO QUIERO (MÁS) PROMOCIONES", "DARME DE BAJA"… (sin tildes, mayúsculas ni puntuación). "Baja el precio", "cancelar" o "no, gracias" **no** son bajas. |
| `boton` | El botón de baja de la plantilla. Meta lo manda como `type: "button"`; `button.payload` lleva la etiqueta. Etiquetas reconocidas: "No quiero promociones", "Stop promotions", "Unsubscribe from Promos"…, más la propia de SIM en `MARKETING_WHATSAPP_BOTON_BAJA`. |
| `preferencia_meta` | El webhook `user_preferences` con `value: "stop"` ([referencia](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/user_preferences)). |
| `error_131050` | Meta informa que la persona frenó el marketing, en el envío o en el estado `failed`. |

### Reglas

- La baja entra al **historial existente** con la fecha que informa Meta.
- Un trigger excluye **en el acto** a sus destinatarios pendientes de toda campaña, aunque los envíos estén apagados. La baja recibida después de preparar y antes del envío está probada (integración C, SQL W7 y K16).
- **Eventos viejos:** una baja vieja que llega tarde no pisa un alta posterior del propio titular, por las reglas de fechas de la vista. Nada de esta integración da un alta.
- **Un mensaje común no es autorización promocional:** se ignora.

### "Resume" de Meta

Una reanudación de Meta (`user_preferences` con `value: "resume"`) queda **registrada aparte**: la vista `mkt_whatsapp_preferencia_meta` muestra la última preferencia de Meta al lado del estado local.

**No borra ni revierte la baja local.** Solo el titular puede volver a anotarse desde el formulario web o la casilla del checkout, como en el resto del registro.

Si alguien reanudó en WhatsApp pero tiene una baja en SIM, sigue sin recibir campañas. El panel lo muestra para que, si corresponde, la persona se anote de nuevo.

## Diagnóstico en Admin

**Admin → Marketing → WhatsApp** (solo admin) muestra:

| Dato | Detalle |
|---|---|
| Estado | **Sin configurar**, **configuración incompleta** (qué variables faltan o son inválidas, **por nombre**), **presente sin verificar** o **verificada**. |
| Envíos reales | Bloqueados o abiertos, y el motivo. |
| Versión y números | La versión de la API y los últimos 4 dígitos del número y de la cuenta. |
| Rechazos por motivo | Firma inválida, sin configuración, cuenta o número ajenos, cuerpo inválido. |
| Bandeja | Pendientes y con error, más los últimos 25 eventos: teléfono enmascarado, resultado, intentos y error, sin textos. |
| Otros conteos | Reanudaciones de Meta registradas y envíos simulados frente a reales. |

"Verificada" exige que **Meta haya llamado**: que pasara la verificación del webhook o que llegara un evento firmado de la cuenta de SIM. Que existan las variables no alcanza. Sin la plantilla configurada, la integración figura como incompleta aunque lleguen eventos.

## Ejecución independiente

**Comprobado en solo lectura el 27/10/2026, en Producción (SIM WEB):**
- Postgres **17.6**.
- `pg_cron` 1.6.4 y `pg_net` 0.20.0 **disponibles y no instalados** (no existen los esquemas `cron` ni `net`).
- `supabase_vault` 0.3.1 **instalado**.

**Qué quedó preparado:**
- `db/marketing-campanias-cron.plantilla.sql`, que **no** está en `db/orden.txt` y no programa nada. Crea `mkt_campanias_disparar()`, que:
  - lee la URL y el secreto de **Vault**;
  - llama con `pg_net` a `POST /api/admin/marketing/campanias/ejecutar` con `Authorization: Bearer <CRON_SECRET>`.
- El endpoint procesa primero la bandeja de WhatsApp y después corre **un lote breve** por campaña.
- Fuera de la base local, las campañas se omiten (200 con `campanias_omitidas`), pero las bajas igual se procesan.
- La activación queda en pasos comentados (instalar las extensiones, guardar los secretos, probar y `cron.schedule`). Es decisión del owner.

**Probado en local**, dentro de una transacción deshecha:
- sin secretos, la función falla con `disparador_sin_configurar`;
- con secretos de prueba, encola un pedido que no sale (rollback).

## Preparación de la conexión externa

### 1. Cuentas y piezas necesarias

| Pieza | Dónde | Para qué |
|---|---|---|
| Cuenta de desarrollador de Meta | developers.facebook.com | Crear la app. |
| Portfolio comercial (Business Manager) de SIM | business.facebook.com | Dueño de la app, la cuenta de WhatsApp y el número. Conviene verificarlo: sin verificar, la cuenta admite hasta 250 plantillas (documentado). |
| App de Meta con el caso de uso "Connect with customers through WhatsApp" | App Dashboard → Create App | Da el número de prueba y el webhook. |
| Cuenta de WhatsApp Business (WABA) | Se crea con la app | `WHATSAPP_BUSINESS_ACCOUNT_ID`. |
| Número de empresa registrado en la Cloud API | WhatsApp Manager | `WHATSAPP_PHONE_NUMBER_ID`, que no es el número de teléfono. |
| Usuario del sistema con token | Business Settings → System users | `WHATSAPP_ACCESS_TOKEN`, con permisos `whatsapp_business_messaging`, `whatsapp_business_management` y `business_management` ([tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens.md)). |
| Método de pago en la WABA | WhatsApp Manager | Para las plantillas de marketing, que se cobran por entregado. La moneda se elige al crear la cuenta y no se puede cambiar (documentado). |

### 2. Variables (Vercel, **solo servidor**)

Los valores se cargan en Vercel; **nunca** se pegan en el chat ni en el repo.

| Variable | Valor | Estado hoy |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Token del usuario del sistema | Pendiente |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número (WhatsApp Manager / API Setup) | Pendiente |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID de la WABA | Pendiente (variable **nueva**) |
| `WHATSAPP_APP_SECRET` | App Dashboard → Settings → Basic | Pendiente. **Obligatorio:** sin él el webhook no procesa |
| `WHATSAPP_VERIFY_TOKEN` | Un valor al azar que elige SIM | Pendiente |
| `WHATSAPP_GRAPH_VERSION` | La versión vigente, p. ej. `v26.0` (la de los ejemplos actuales de Meta) | Pendiente (variable **nueva**) |
| `MARKETING_WHATSAPP_PLANTILLA` / `MARKETING_WHATSAPP_IDIOMA` | Nombre y código de idioma (`es_AR`) de la plantilla **aprobada** | Pendiente |
| `MARKETING_WHATSAPP_BOTON_BAJA` | Etiqueta exacta del botón de baja de la plantilla | Opcional |
| `MARKETING_WHATSAPP_BIZ_OPAQUE` | `true` después de probarlo con el número de prueba | Opcional, apagado |
| `MARKETING_WHATSAPP_ENDPOINT` | `messages` (Cloud API, por defecto) o `marketing_messages` (Marketing Messages API, después del onboarding y los términos de Meta) | Opcional. Meta deja de admitir marketing por `/messages` el 13/10/2027 |
| `MARKETING_WHATSAPP_ENVIOS_REALES` | **No cargar** hasta autorizar la campaña real | Apagado |
| `CRON_SECRET` | Ya existe en Vercel para los otros crons | Revisar que esté |

### 3. Webhook

1. App Dashboard → WhatsApp → Configuration (o Use cases → Customize → Configuration).
2. **Callback URL:** `https://simexperience.com.ar/api/whatsapp/webhook`. **Verify token:** el mismo `WHATSAPP_VERIFY_TOKEN`.
3. Suscribir los campos **`messages`** (mensajes entrantes y estados de los enviados) y **`user_preferences`** (stop/resume de marketing).
4. Comprobación: en Admin → Marketing → WhatsApp tiene que aparecer "Verificación del webhook" con fecha y, al llegar el primer evento, "Último evento firmado".

**Ojo, Finanzas ya usa este mismo webhook.** El código conserva el flujo de Finanzas, pero ahora exige `WHATSAPP_APP_SECRET` y `WHATSAPP_BUSINESS_ACCOUNT_ID`.

### 4. Plantilla de marketing (requiere aprobación de Meta)

Contrato que espera el código (`PARAMETROS_PLANTILLA` en `lib/marketing/campanias.ts`):
- **Categoría:** MARKETING.
- **Idioma:** `es_AR`.
- **Cuerpo**, hasta 1024 caracteres, con 4 parámetros posicionales en este orden:
  - `{{1}}` saludo ("Hola Ana" o "Hola");
  - `{{2}}` beneficio ("15 % de descuento");
  - `{{3}}` vence (dd/mm);
  - `{{4}}` productos ("reservas web y Gift Cards").
- **Botón 0:** COPY_CODE, con el cupón (hasta 20 caracteres).
- **Botón 1:** QUICK_REPLY de baja, p. ej. "No quiero promociones". Su etiqueta va en `MARKETING_WHATSAPP_BOTON_BAJA` si no es una de las reconocidas.
- **Pie de página:** se recomienda decir cómo dejar de recibir promociones.

Ejemplo para la solicitud (los valores comerciales son **ejemplos**, no aprobados):

> {{1}}! Te extrañamos en SIM. Tenés {{2}} para volver a correr, válido hasta el {{3}} para {{4}}. Usá el código de abajo en simexperience.com.ar.

**Para la aprobación hacen falta:**
- las condiciones comerciales definitivas (tipo, valor y vigencia del beneficio);
- el texto final;
- las muestras de cada parámetro;
- la etiqueta del botón de baja.

La plantilla debe estar `APPROVED` para enviarse ([plantillas](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview.md)). Si cambia de estado (pausada o deshabilitada), Meta responde 132015 o 132016 y el envío es definitivo.

### 5. Usar primero un número de prueba

1. En la app nueva, API Setup ofrece un número de prueba de Meta y un token temporal ([primeros pasos](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started.md)).
2. Agregar como destinatarios **solo** números propios del equipo.
3. Configurar el webhook (paso 3) con las variables del número de prueba **en un entorno de Preview**, no en Producción.
4. Probar la verificación del webhook (GET), un mensaje entrante "BAJA" desde un número propio, el botón de baja, y un `stop`/`resume` desde el WhatsApp del celular de prueba.
5. Recién con la plantilla aprobada, una campaña de prueba hacia números propios. Antes hace falta habilitar el modo real de campañas (otra etapa) y abrir el bloqueo solo en ese entorno.

La documentación no dice si el número de prueba tiene costo ni cuántos destinatarios admite: hay que verlo en el App Dashboard.

### 6. Conservar el número actual y su atención desde la app Business

| Opción | Qué dice la documentación | Para SIM |
|---|---|---|
| **Coexistencia** (el mismo número en la app WhatsApp Business y en la Cloud API) ([documentación](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md)) | Ver el detalle debajo de esta tabla. | **No comprobado.** No se sabe la versión de la app ni si hay un proveedor. Conviene confirmar con Meta o con el proveedor que la coexistencia admite plantillas de marketing por la Cloud API antes de elegirla. |
| **Número nuevo solo para la Cloud API** | Se registra un número que no esté en la app (o se desconecta de ella). Ese número deja de usarse en la app WhatsApp Business. | La atención actual sigue en su número y las campañas salen de otro. Es la opción más simple y no toca el número actual. |
| **Migrar el número actual a la Cloud API** | El número deja de funcionar en la app. | **No se hizo ni se recomienda sin decisión del owner:** se perdería la atención desde la app. |

**Qué dice la documentación sobre la coexistencia:**
- Hay que hacerla con Embedded Signup y con un **Solution Partner o Tech Provider**.
- La app WhatsApp Business debe ser la 2.24.17 o posterior.
- El número queda con un tope de 20 mensajes por segundo.
- Se sincronizan contactos e historial (6 meses) y llegan "echoes" de lo que se manda desde la app.
- Se desactivan las listas de difusión, los mensajes temporales y "ver una vez".
- **La lista de funciones no soportadas incluye "marketing messages".**

**Decisión pendiente:** número nuevo para campañas o coexistencia con un proveedor.

### 7. Datos pendientes (lista precisa)

1. ID de la WABA, ID del número, app secret y token del usuario del sistema. Se cargan en Vercel, no se pegan.
2. La versión de la Graph API que se va a fijar.
3. La plantilla aprobada: nombre, idioma y etiqueta del botón de baja.
4. La decisión de número (nuevo o coexistencia) y, si es coexistencia, el proveedor.
5. Las condiciones comerciales de la campaña (tipo, valor y vigencia; el 15 % y los 7 días son propuesta) y si un cupón puede cubrir varias Gift Cards.
6. La confirmación del control del teléfono antes de enviar: hoy el consentimiento se registra, pero no se verifica que la persona controle el número.
7. La activación de Supabase Cron (extensiones, Vault y el job), con la etapa real.
8. Habilitar el modo real de campañas en la base (otra etapa) y recién entonces abrir el bloqueo.

## Pruebas

| Comando | Qué prueba |
|---|---|
| `node scripts/pruebas/marketing-whatsapp.mjs` | 13 casos SQL (W1–W13) de la bandeja: idempotencia, estados en orden y fuera de orden, `failed` tardío, incierto resuelto por `biz_opaque`, `wamid` ajeno, 131050 con baja, bajas por texto y botón (una vez), mensaje común ignorado, número extranjero, `stop`/`resume`, baja vieja frente a alta posterior, reintentos hasta `error`, diagnóstico y permisos. |
| `node scripts/pruebas/marketing-campanias.mjs` | Campañas (16 casos), incluidos K15 (intentos) y K16 (una baja excluye los pendientes de todas las campañas). |
| `node scripts/pruebas/marketing-consentimiento.mjs` | El registro de consentimiento con la fuente `whatsapp` (25 casos). |
| `npx tsx lib/marketing/whatsapp.test.ts` | Ver el detalle debajo de esta tabla. |
| `node scripts/pruebas/correr-mutantes.mjs lib/marketing/whatsapp.integration.ts` | Ver el detalle debajo de esta tabla. |

**`whatsapp.test.ts`** (red bloqueada):
- bloqueo apagado por defecto, también con credenciales;
- ningún pedido con el bloqueo cerrado, y el corte inmediato al cerrarlo;
- URL, encabezados y cuerpo exactos del pedido;
- validación local;
- clasificación: transitorios, definitivos e inciertos por tiempo, red, 5xx o 200 ilegible;
- configuración sin valores;
- firma sobre los bytes y token de verificación;
- lectura del webhook: cuenta y número ajenos, bajas inequívocas, preferencias, sin textos.

**`whatsapp.integration.ts`** (la ruta real con todo pedido a Meta interceptado):
- **A:** verificación de la suscripción;
- **B:** sin configuración, firma inválida, ausente o alterada, cuenta y número ajenos, 3 MB;
- **C:** "BAJA" después de preparar y antes del envío: no se le envía;
- **D:** duplicados y mensaje común;
- **E:** estados fuera de orden de un envío real;
- **F:** falla de la base, 500 y reintento;
- **G:** recuperación por el disparador;
- **H:** `stop`/`resume`;
- **I:** incierto del proveedor que no se reenvía;
- **J:** Finanzas intacto;
- **K:** diagnóstico sin secretos.

### Capturas (`docs/marketing/capturas-whatsapp/`, base local con eventos sintéticos)

| # | Pantalla |
|---|---|
| 01 | Escritorio: diagnóstico "Sin configurar", envíos reales bloqueados, variables faltantes por nombre, un rechazo por firma inválida y los últimos eventos: mensaje común ignorado, baja registrada, reanudación de Meta que no revierte y estado sin envío real asociado. |
| 02 | Celular: el mismo diagnóstico. |

## Enlaces oficiales consultados (27/10/2026)

- Webhooks:
  - [componentes](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
  - [estados](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/messages/status)
  - [botón](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/messages/button)
  - [user_preferences](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/user_preferences)
  - [crear el endpoint (firma)](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint.md)
  - [configurar (reintentos 7 días, 3 MB, campos)](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
  - [Graph API webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- Envío:
  - [enviar mensajes](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages.md)
  - [referencia de la Message API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api.md)
  - [plantillas](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview.md)
  - [componentes de plantilla](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md)
  - [cupones](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/coupon-templates.md)
  - [códigos de error](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)
- Marketing:
  - [Marketing Messages API](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview.md). Meta indica que la Cloud API dejará de admitir mensajes de marketing el **13/10/2027** y que el camino es la MM API (`/marketing_messages`, mismo esquema y los mismos webhooks de estado); [envío por MM API](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/send-marketing-messages.md).
  - [opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in.md)
  - [precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)
- Cuenta:
  - [primeros pasos](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started.md)
  - [tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens.md)
  - [coexistencia](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md)
- Supabase:
  - [Cron](https://supabase.com/docs/guides/cron)
  - [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
