# Política de Privacidad — cambios propuestos (BORRADOR)

> **Estado: borrador para revisión legal. NO está publicado.** La página vigente
> (`app/legales/privacidad/page.tsx`, actualizada el 3 de julio de 2026) no se modificó.
> El texto de consentimiento `promos-v1` también sigue como **borrador** en la base: no se
> publica hasta que un abogado valide este documento y ese texto.

Este documento compara la política publicada con los datos y finalidades que **realmente
implementa** el sistema (commits `4721572` y siguientes de la rama
`marketing-etapa1-simulacion`). No agrega proveedores, datos empresariales ni tratamientos
que no existan. Lo que todavía no existe se marca como **pendiente**.

## 1. Qué trata hoy el sistema y la política no dice

| Tratamiento | Dónde | Datos | ¿Lo cubre la política actual? |
|---|---|---|---|
| Turnos en el stand (Turnero) | `turnos_stand` | nombre y teléfono para gestionar el turno, fecha, hora, pago | **No**: §2 solo nombra reservas, gift cards y campeonatos |
| Registro de interacciones del stand | `interacciones_stand` | sin datos personales (grupo, edades por rango, resultado) | No hace falta: no hay datos personales |
| Consentimiento para promociones | `mkt_consentimiento_eventos` | teléfono, nombre y localidad **opcionales**, texto y versión aceptados, momento en que se mostró el texto y en que se registró, origen (formulario web, casilla en Reservas o Gift Cards, carga del panel con evidencia escrita), página, **huella** de la IP (HMAC; la IP no se guarda), identificador de la compra cuando se aceptó en el checkout | **No**: §4 habla de comunicaciones comerciales sin pedir consentimiento |
| Bajas de promociones | `mkt_consentimiento_eventos` | teléfono, canal por el que se pidió (formulario, stand, WhatsApp, teléfono, email), nota del personal | Parcial: §4 menciona que se puede pedir, sin decir cómo |
| Segmentación por indicativo | `lib/marketing/indicativo.ts` | el indicativo del teléfono (tabla oficial de ENACOM) como aproximación geográfica | **No** |

Lo que **no existe todavía** y no debe figurar como hecho: envío de mensajes por WhatsApp
Business (la Cloud API no está conectada), cupones de campaña, métricas de campaña.

## 2. Cambios propuestos, sección por sección

### §2 Datos que recopilamos — agregar

> - **Turnos en el stand:** nombre y teléfono, para gestionar y registrar tu turno.
> - **Promociones por WhatsApp (solo si las aceptás):** tu teléfono y, si querés, tu nombre y
>   localidad. Guardamos también el texto exacto que aceptaste, su versión, cuándo te lo
>   mostramos, desde dónde lo aceptaste y una huella técnica de la conexión que no permite
>   conocer tu dirección IP. Si pedís la baja, guardamos tu teléfono para no volver a
>   escribirte.

### §3 Finalidad del tratamiento — agregar

> - Enviarte promociones, descuentos y novedades de SIM Argentina por WhatsApp, **solo si lo
>   aceptaste** de forma separada y voluntaria, y dejar de hacerlo cuando lo pidas.
> - Elegir a quién ofrecer cada promoción según tus visitas y la característica (indicativo)
>   de tu teléfono, que usamos como una aproximación geográfica y no como dato de domicilio.

### §4 Comunicaciones comerciales — reemplazar

El texto actual dice que SIM *podrá utilizar los datos de contacto proporcionados por el
usuario* para enviar promociones por WhatsApp y otros canales. Eso **no coincide** con lo
implementado, que solo considera habilitado a quien aceptó expresamente. Propuesta:

> Solo te enviamos promociones por WhatsApp si lo aceptaste expresamente: en
> simexperience.com.ar/promos, con la casilla opcional al reservar o comprar una Gift Card, o
> por escrito. Comprar, reservar o darnos tu teléfono para un turno **no** implica aceptarlas.
> Podés dejar de recibirlas cuando quieras, sin dar explicaciones, en
> simexperience.com.ar/promos/baja o pidiéndolo por WhatsApp o en el stand. La baja no afecta
> los avisos necesarios para tus reservas, pagos, gift cards o inscripciones.

### §5 Cesión y encargados — pendiente

Cuando se conecte la API oficial de WhatsApp Business, **Meta Platforms** pasará a tratar los
números y los mensajes como proveedor. Hoy no ocurre, así que **no** se agrega todavía. Al
conectarla hay que agregarlo y revisar la transferencia internacional de datos.

### §6 Conservación — agregar (requiere definir el plazo)

> Conservamos el registro de tu aceptación o de tu baja mientras exista la relación y durante
> [PLAZO A DEFINIR], para poder demostrar que nos autorizaste o que pediste no recibir más
> promociones. Si pediste la baja, conservamos tu teléfono en una lista de exclusión para no
> volver a escribirte.

### §7 Derechos del titular — agregar

> Para dejar de recibir promociones (derecho de retiro o bloqueo, art. 27 inc. 3 de la Ley
> 25.326) entrá a simexperience.com.ar/promos/baja o escribinos por WhatsApp.

## 3. Puntos que requieren definición o revisión antes de publicar

1. **Revisión legal** de este documento y del texto de consentimiento `promos-v1`, que sigue
   en borrador. Publicar el texto desde el panel solo después de esa revisión.
2. **§4 vigente:** confirmar que se reemplaza. Hoy autoriza promociones sin consentimiento y
   contradice el criterio adoptado (teléfono para un turno ≠ aceptación).
3. **Plazo de conservación** del registro de aceptaciones, bajas y evidencia (incluida la
   huella de IP).
4. **Datos del responsable:** el repo tiene nombre comercial, domicilio, email y WhatsApp
   (`data/legal.ts`). No tiene razón social, CUIT ni constancia de inscripción de la base en el
   Registro Nacional de Bases de Datos. Definir si corresponde agregarlos; no se inventaron.
5. **Registro Nacional No Llame (Ley 26.951):** la AAIP indica que alcanza a WhatsApp.
   Definir el procedimiento y confirmar que el consentimiento expreso registrado cubre la
   excepción.
6. **Menores de edad:** el stand atiende menores (§8 vigente). Definir si pueden aceptar
   promociones y con qué autorización.
7. **Mensajes promocionales:** cuando existan plantillas, cada mensaje debe ofrecer la baja de
   forma expresa y destacada (Decreto 1558/01, art. 27, y Disposición DNPDP 4/2009). Validar
   el texto de la baja de las plantillas.
8. **Proveedor de WhatsApp** (§5) y transferencia internacional, al conectar la Cloud API.
9. **Fecha de actualización:** actualizar `legalConfig.ultimaActualizacion` al publicar.
10. **Consentimiento del panel:** la carga de un alta con evidencia escrita (planilla firmada,
    mensaje o email del titular) es solo de admin y no revierte una baja. Confirmar que ese
    criterio es suficiente como prueba.
