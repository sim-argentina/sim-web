# Empresas B8 — Código común por pack y un uso por experiencia

**Estado:** implementado y verificado en una instancia local aislada. **Sin migrar en SIM WEB,
sin push, sin merge y sin deploy.** Rama `empresas-codigo-comun`, desde `origin/main` `33ca411`.

## Por qué

La condición comercial vigente (31/10/2026) para los packs corporativos dice:
- un **código común por pack**, compartido por sus tarjetas físicas;
- cada tarjeta es **una experiencia de 20 minutos**;
- el **cupo total** son las experiencias compradas.

El módulo Empresas no tenía una configuración correcta para eso:
- «Generar» creaba `cantidad_contratada` códigos, cada uno con `usos_por_codigo` usos:
  - **1 código × 10 usos** daba el cupo correcto, pero pantalla, informe y CRM mostraban «1 turno
    contratado» y «Restantes 0» después del primer canje;
  - **10 × 10** multiplicaba el cupo (100 experiencias).
- **Un canje sumaba un solo uso** aunque la API pública (`/api/empresas/canje`) aceptara hasta 4
  simuladores. La web manda uno, pero una llamada directa daba 4 experiencias por un uso.
- **Un canje cancelado** liberando el código seguía contando como «utilizado» en métricas,
  listado e informe.
- **Dos «Generar» simultáneos** podían emitir dos tandas de códigos.

## Qué cambia

**Base de datos** (`db/empresas-b8-codigo-comun.sql`, en `db/orden.txt` después de
`empresas-b7-1-fecha.sql`):
- `empresa_campanias.codigo_comun boolean not null default false`. Las campañas existentes
  quedan en falso, así que no cambian.
- **Un canje = un simulador:** `crear_reserva_empresa` (legacy) y `crear_reserva_empresa_v2`
  exigen exactamente uno. Legacy además aceptaba un canje **sin ningún** simulador; ya no.
- **Reprogramar no cambia la cantidad:** `reprogramar_reserva_empresa` y
  `reprogramar_reserva_empresa_v2` exigen los mismos simuladores que tenía la reserva. Una
  reserva anterior de varios se sigue pudiendo mover con la misma cantidad.
- El resto de cada función es idéntico a su definición vigente (lo generó un script que solo
  aplica esos reemplazos). Las definiciones anteriores están en
  `db/empresas-b8-codigo-comun.previo.sql`.

**Servidor** (`lib/empresas.ts`, `lib/empresasServer.ts`):
- `planDeCodigos`:
  - con código común, **un** código con `usos_maximos = cantidad_contratada`;
  - sin él, `cantidad_contratada` códigos de un uso, como antes.
- **El código común se puede generar antes del pago**, para imprimir las tarjetas. El canje sigue
  exigiendo la campaña pagada y su fecha de inicio. Los códigos individuales siguen pidiendo la
  campaña pagada.
- **La generación se reserva** (`codigos_generados` de falso a verdadero) **antes de insertar**:
  dos pedidos simultáneos dan una sola tanda.
- **Ya no se acepta** crear ni pasar a «códigos individuales con varios usos», la configuración
  que multiplicaba el cupo. Una campaña anterior que lo tenga se sigue pudiendo editar.
- **Con los códigos generados**, no se puede cambiar entre común e individuales, ni el cupo de un
  código común.
- **Métricas por experiencia:**
  - «utilizados» = canjes no cancelados;
  - «% uso» = usados ÷ contratados.

  Para campañas de códigos de un uso da lo mismo que antes. El listado y la evolución del
  informe usan el mismo criterio.
- **Un solo simulador por canje**, y al reprogramar la misma cantidad que tenía la reserva, con
  mensajes claros. Las RPC lo vuelven a exigir.

**Pantalla e informe** (`app/admin/(panel)/codigos/EmpresasTab.tsx`, `empresasInforme.ts`):
- **Formulario:**
  - nueva casilla «Código común» («un solo código para todas las tarjetas del pack, con N usos»);
  - «Usos por código» solo aparece en una campaña anterior que no lo tenga en 1;
  - con los códigos generados, la casilla y la cantidad quedan bloqueadas.
- **Detalle de un pack común:**
  - las tarjetas de métricas muestran Contratadas, Usadas, Restantes, % uso y si el código ya se
    generó;
  - el botón dice «Generar código común (N usos)».
- **Listado e informe:** «Usado» y «% uso» cuentan experiencias.
- **Reprogramar:** el aviso dice que la cantidad no cambia.

## Qué no cambia (sigue a cargo del personal)

- **Activación:** el pack se activa al entregar las tarjetas, con el 100% cobrado. Es una acción
  manual: marcar pagada la campaña y poner `fecha_inicio` = día de la entrega. Empresas calcula el
  vencimiento (compra única: 60 días).
- **Tarjeta física:** el sistema no la valida. Quien conoce el código común puede reservar por la
  web hasta agotar el cupo; la revisión en el stand la hace el personal, que puede marcar ausente
  o cancelar.
- **Bloquear el código:** el admin solo puede bloquear un código sin usos (regla anterior). Un
  código común filtrado no se puede bloquear a mitad de uso sin un cambio aparte.
- **Finanzas:** no hay integración automática; tampoco con el CRM.

**Cómo se opera un pack:**
1. Crear la campaña: compra única, 20 minutos, cantidad = experiencias, «Código común».
2. Generar el código e imprimir las tarjetas.
3. Cobrar el 50% al confirmar (en el CRM).
4. Al entregar, con el 100%: marcar pagada y poner `fecha_inicio` = ese día.
5. En el stand, pedir la tarjeta física.

## Producción (consulta de solo lectura, autorizada el 31/10/2026)

`empresa_campanias` agrupada por `usos_por_codigo`, modalidad y estado, sin nombres, códigos ni
beneficiarios. Hay una sola campaña: `usos_por_codigo = 1`, mensual, legacy y cancelada.
Ninguna campaña real usa más de un uso por código, así que el cambio de semántica no altera nada
existente.

## Pruebas (instancia local aislada `sim-web-empresas-local`, cadena de `db/orden.txt` desde cero)

| Prueba | Resultado |
|---|---|
| `db/empresas-b8-codigo-comun.verificacion.sql` (sin huella: se deshace entera), con B8 aplicado dos veces | `OK`: T1 columna; T2 código común v2 (2 simuladores o ninguno no canjean ni consumen; 3 canjes = 3 usos; el 4.º no); T3 legacy; T4–T6 reprogramar; T7 idempotencia |
| La misma verificación con las funciones **anteriores**, en una transacción que se deshace (control) | Falla donde tiene que fallar: 2 simuladores consumen 1 uso (v2 y legacy), legacy canjea sin simulador, una reserva de 2 se mueve con 1 |
| `lib/empresas.test.ts` (puro): plan de códigos, cupo = experiencias, configuración que multiplicaba rechazada, métricas sin cancelados; los casos anteriores sin cambios | OK |
| `lib/empresasCodigoComun.integration.ts` (ruta real, modalidad vigente v2_10): generación única aunque se pida dos veces a la vez y antes del pago; sin canje hasta pagada + inicio; vence a los 60 días; **12 canjes simultáneos → 10**; 2 simuladores rechazados por servidor y RPC; reprogramar; cancelado liberado fuera de métricas, listado e informe y reutilizable; tipo y cupo fijos; individuales como antes | OK |
| La misma integración con las RPC anteriores (control) | Falla en «la RPC tampoco acepta 2 simuladores» |
| Regresión legacy: `lib/empresasCanje.integration.ts` en una copia temporal con simuladores reales y la modalidad legacy forzada en la instancia local | OK, igual que en `main` |
| `lib/empresasFechaArgentina.test.ts`, `lib/guardiaPruebas.test.ts` | OK |
| `lib/empresasB7.test.ts` | Falla en `main` y en esta rama en la misma aserción, que es previa (ver abajo). Con la fecha del fixture alineada, en una copia temporal, pasa entera. |
| `tsc`, `eslint` de los archivos tocados y `next build` | OK |
| Pantalla, servidor de producción local contra la instancia aislada | Casilla «Código común», generación antes del pago, «Códigos (1) · disponible 0/10», métricas por experiencia, casilla y cantidad bloqueadas después de generar |

**Hallazgos previos, no corregidos acá:**
- **`lib/empresasCanje.integration.ts` está desactualizada desde B7:**
  - crea campañas sin `modalidad_vista`, así que con `v2_10` vigente da 409;
  - usa simuladores `ZZ_SIM_*`, que el motor de agenda rechaza.

  Con simuladores reales y la modalidad legacy forzada, pasa entera.
- **`lib/empresasB7.test.ts` es una bomba de tiempo en su fixture:** `fecha_inicio` es fija (antes
  del corte del 30/09) y `fecha_pago` es «hoy − 2». Desde el 30/10 la regla «el inicio entre el pago
  y 30 días después» la rechaza.

## CRM (rama `crm-b0-identidad`), cuando se integre

Ajustes chicos, todavía no hechos (el CRM no está publicado):
- `lib/crmB3Server.ts`: el conteo de canjes, con el mismo filtro (sin cancelados);
- `components/crm/DetalleVenta.tsx`: mostrar «código común» en lugar de «N usos por código»;
- `docs/crm/cierre-mvp.md` §9: pasar el código común a «soportado» una vez publicado B8.

`metricasCampania` acepta los canjes sin estado que le pasa el CRM y los toma como vigentes.

## Publicación (no ejecutada; cada paso con autorización)

1. Comparar `pg_get_functiondef()` de las cuatro funciones en Producción con
   `db/empresas-b8-codigo-comun.previo.sql`: deben coincidir.
2. **Primero el SQL:** aplicar `db/empresas-b8-codigo-comun.sql` en SIM WEB por MCP. Es inocuo con
   el código actual: la columna nace en falso y la web ya manda un simulador. Al revés no: el
   código nuevo escribe `codigo_comun` y fallaría sin la columna.
3. Correr `db/empresas-b8-codigo-comun.verificacion.sql` y exigir `RESULTADO B8|…` sin `FALLA:`.
   Se deshace entera, pero bloquea `reservas` y `reserva_slots` un instante: correrla en un horario
   tranquilo.
4. Recién entonces publicar el código (un push a `main` despliega).
5. Después: crear una campaña de prueba en borrador, verificar la pantalla y archivarla, sin
   cobros ni canjes reales.

**Vuelta atrás:**
- **Código:** promover el despliegue anterior.
- **Base:** aplicar `db/empresas-b8-codigo-comun.previo.sql` (restaura las cuatro funciones). La
  columna no se borra: el código anterior la ignora.
- **Si ya hay un pack común:** su código de N usos sigue funcionando con el cupo correcto, pero
  la pantalla anterior volvería a mostrar «1 turno contratado».
